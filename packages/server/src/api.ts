import {
  listTasks,
  getTask,
  getProjects,
  getEpics,
  getSprints,
  getTags,
  createTask,
  updateTask,
  deleteTask,
  restoreTask,
  toggleSubtask,
  addSubtask,
  reorderTask,
  sortTasks,
  getConfig,
  updateConfig,
  CreateTaskInputSchema,
  TaskPatchSchema,
  TaskFiltersSchema,
  RelayConfigSchema,
  listPlans,
  getPlan,
  getPlanProjects,
  getPlanTags,
  createPlan,
  updatePlan,
  deletePlan,
  restorePlan,
  cutTasksFromPlan,
  CreatePlanInputSchema,
  PlanPatchSchema,
  PlanFiltersSchema,
  listDocs,
  getDoc,
  getDocProjects,
  getDocTags,
  createDoc,
  updateDoc,
  deleteDoc,
  restoreDoc,
  CreateDocInputSchema,
  DocPatchSchema,
  DocFiltersSchema,
} from "@relay/core";
import { createDebug } from "./debug.js";
import type { TaskChangeEvent } from "./watcher.js";
import type { CopilotManager, CopilotProviderId } from "./copilot/index.js";

const dbgApi = createDebug("api");

type RouteHandler = (
  req: Request,
  params: Record<string, string>,
) => Promise<Response>;

interface Route {
  method: string;
  path: string;
  paramNames: string[];
  regex: RegExp;
  handler: RouteHandler;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

// --- SSE client management ---
const sseClients = new Set<ReadableStreamDefaultController>();

export function broadcastEvent(event: TaskChangeEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const controller of sseClients) {
    try {
      controller.enqueue(new TextEncoder().encode(data));
    } catch {
      sseClients.delete(controller);
    }
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

function isZodError(err: unknown): err is { errors: unknown[] } {
  return (
    err != null &&
    typeof err === "object" &&
    "errors" in err &&
    Array.isArray((err as { errors: unknown[] }).errors) &&
    "name" in err &&
    (err as { name: string }).name === "ZodError"
  );
}

export function handleError(err: unknown): Response {
  if (isZodError(err)) {
    return json({ error: "Validation error", details: err.errors }, 400);
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.toLowerCase().includes("not found")) {
    return errorResponse(message, 404);
  }
  return errorResponse(message, 500);
}

async function readJsonBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  return JSON.parse(text);
}

function buildRouteRegex(path: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const pattern = path.replace(/:([a-zA-Z]+)/g, (_match, name: string) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${pattern}$`), paramNames };
}

export function createRoutes(
  rootDir: string,
  tasksDir: string,
  plansDir?: string,
  docsDir?: string,
  copilot?: CopilotManager,
): Route[] {
  const base = "/api";
  const routes: Route[] = [];

  function route(method: string, path: string, handler: RouteHandler) {
    const fullPath = `${base}${path}`;
    const { regex, paramNames } = buildRouteRegex(fullPath);
    routes.push({ method, path: fullPath, paramNames, regex, handler });
  }

  // GET /api/events — SSE endpoint for live updates
  route("GET", "/events", async () => {
    const stream = new ReadableStream({
      start(controller) {
        sseClients.add(controller);
        // Send initial keepalive so the client knows the connection is live
        controller.enqueue(new TextEncoder().encode(": connected\n\n"));
      },
      cancel(controller) {
        sseClients.delete(controller);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  // GET /api/tasks — list with optional filters
  route("GET", "/tasks", async (req) => {
    const url = new URL(req.url);
    const rawFilters: Record<string, unknown> = {};

    const status = url.searchParams.getAll("status");
    if (status.length === 1) rawFilters.status = status[0];
    else if (status.length > 1) rawFilters.status = status;

    const priority = url.searchParams.getAll("priority");
    if (priority.length === 1) rawFilters.priority = priority[0];
    else if (priority.length > 1) rawFilters.priority = priority;

    for (const key of ["project", "epic", "sprint", "search"] as const) {
      const val = url.searchParams.get(key);
      if (val) rawFilters[key] = val;
    }

    const tagsParam = url.searchParams.getAll("tags");
    if (tagsParam.length > 0) rawFilters.tags = tagsParam;

    const filters = TaskFiltersSchema.parse(rawFilters);
    const tasks = await listTasks(tasksDir, filters);
    return json(sortTasks(tasks));
  });

  // GET /api/tasks/:id
  route("GET", "/tasks/:id", async (_req, params) => {
    const task = await getTask(tasksDir, params.id);
    if (!task) return errorResponse(`Task not found: ${params.id}`, 404);
    return json(task);
  });

  // POST /api/tasks
  route("POST", "/tasks", async (req) => {
    const body = await readJsonBody(req);
    const input = CreateTaskInputSchema.parse(body);
    const task = await createTask(tasksDir, input);
    dbgApi(`taskCreate  ${task.id}  "${task.title}"`);
    return json(task, 201);
  });

  // PATCH /api/tasks/:id — update frontmatter fields
  route("PATCH", "/tasks/:id", async (req, params) => {
    const body = await readJsonBody(req);
    const patch = TaskPatchSchema.parse(body);
    const task = await updateTask(tasksDir, params.id, patch);
    dbgApi(`taskPatch   ${params.id}  [${Object.keys(patch).join(",")}]`);
    return json(task);
  });

  // PATCH /api/tasks/:id/body — update task body only
  route("PATCH", "/tasks/:id/body", async (req, params) => {
    const body = (await readJsonBody(req)) as { body?: string };
    if (typeof body.body !== "string") {
      return errorResponse("Missing 'body' field", 400);
    }
    const task = await updateTask(tasksDir, params.id, {
      body: body.body,
    });
    dbgApi(`taskBody    ${params.id}`);
    return json(task);
  });

  // DELETE /api/tasks/:id
  route("DELETE", "/tasks/:id", async (_req, params) => {
    dbgApi(`taskDelete  ${params.id}`);
    await deleteTask(tasksDir, params.id);
    return json({ ok: true });
  });

  // POST /api/tasks/:id/restore
  route("POST", "/tasks/:id/restore", async (_req, params) => {
    const task = await restoreTask(tasksDir, params.id);
    dbgApi(`taskRestore ${params.id}`);
    return json(task);
  });

  // PATCH /api/tasks/:id/reorder
  route("PATCH", "/tasks/:id/reorder", async (req, params) => {
    const body = (await readJsonBody(req)) as {
      afterId?: string | null;
      beforeId?: string | null;
    };
    const task = await reorderTask(
      tasksDir,
      params.id,
      body.afterId ?? null,
      body.beforeId ?? null,
    );
    dbgApi(`taskReorder ${params.id}  after=${body.afterId ?? "null"}`);
    return json(task);
  });

  // PATCH /api/tasks/:id/subtask
  route("PATCH", "/tasks/:id/subtask", async (req, params) => {
    const body = (await readJsonBody(req)) as {
      action?: string;
      index?: number;
      text?: string;
    };

    if (body.action === "add") {
      if (typeof body.text !== "string" || !body.text.trim()) {
        return errorResponse("Missing 'text' field for add action", 400);
      }
      const task = await addSubtask(tasksDir, params.id, body.text);
      dbgApi(`subtaskAdd  ${params.id}  "${body.text}"`);
      return json(task);
    }

    // Default: toggle
    if (typeof body.index !== "number") {
      return errorResponse("Missing 'index' field", 400);
    }
    const task = await toggleSubtask(tasksDir, params.id, body.index);
    dbgApi(`subtaskToggle ${params.id}  [${body.index}]`);
    return json(task);
  });

  // GET /api/meta — aggregate metadata
  route("GET", "/meta", async () => {
    const [projects, epics, sprints, tags] = await Promise.all([
      getProjects(tasksDir),
      getEpics(tasksDir),
      getSprints(tasksDir),
      getTags(tasksDir),
    ]);
    return json({ projects, epics, sprints, tags });
  });

  // GET /api/config
  route("GET", "/config", async () => {
    const config = await getConfig(rootDir);
    return json(config);
  });

  // PATCH /api/config
  route("PATCH", "/config", async (req) => {
    const body = await readJsonBody(req);
    const patch = RelayConfigSchema.partial().parse(body);
    const config = await updateConfig(rootDir, patch);
    return json(config);
  });

  // --- Plan routes ---
  if (plansDir) {
    // GET /api/plans/meta — aggregate plan metadata (before :id to avoid matching "meta")
    route("GET", "/plans/meta", async () => {
      const [projects, tags] = await Promise.all([
        getPlanProjects(plansDir),
        getPlanTags(plansDir),
      ]);
      return json({ projects, tags });
    });

    // GET /api/plans — list with optional filters
    route("GET", "/plans", async (req) => {
      const url = new URL(req.url);
      const rawFilters: Record<string, unknown> = {};

      const status = url.searchParams.getAll("status");
      if (status.length === 1) rawFilters.status = status[0];
      else if (status.length > 1) rawFilters.status = status;

      for (const key of ["project", "search"] as const) {
        const val = url.searchParams.get(key);
        if (val) rawFilters[key] = val;
      }

      const tagsParam = url.searchParams.getAll("tags");
      if (tagsParam.length > 0) rawFilters.tags = tagsParam;

      const filters = PlanFiltersSchema.parse(rawFilters);
      const plans = await listPlans(plansDir, filters);
      return json(plans);
    });

    // GET /api/plans/:id
    route("GET", "/plans/:id", async (_req, params) => {
      const plan = await getPlan(plansDir, params.id);
      if (!plan) return errorResponse(`Plan not found: ${params.id}`, 404);
      return json(plan);
    });

    // POST /api/plans
    route("POST", "/plans", async (req) => {
      const body = await readJsonBody(req);
      const input = CreatePlanInputSchema.parse(body);
      const plan = await createPlan(rootDir, plansDir, input);
      dbgApi(`planCreate  ${plan.id}  "${plan.title}"`);
      return json(plan, 201);
    });

    // PATCH /api/plans/:id — update frontmatter fields
    route("PATCH", "/plans/:id", async (req, params) => {
      const body = await readJsonBody(req);
      const patch = PlanPatchSchema.parse(body);
      const plan = await updatePlan(plansDir, params.id, patch);
      dbgApi(`planPatch   ${params.id}  [${Object.keys(patch).join(",")}]`);
      return json(plan);
    });

    // PATCH /api/plans/:id/body — update plan body only
    route("PATCH", "/plans/:id/body", async (req, params) => {
      const body = (await readJsonBody(req)) as { body?: string };
      if (typeof body.body !== "string") {
        return errorResponse("Missing 'body' field", 400);
      }
      const plan = await updatePlan(plansDir, params.id, { body: body.body });
      dbgApi(`planBody    ${params.id}`);
      return json(plan);
    });

    // DELETE /api/plans/:id
    route("DELETE", "/plans/:id", async (_req, params) => {
      dbgApi(`planDelete  ${params.id}`);
      await deletePlan(rootDir, plansDir, params.id);
      return json({ ok: true });
    });

    // POST /api/plans/:id/restore
    route("POST", "/plans/:id/restore", async (_req, params) => {
      const plan = await restorePlan(plansDir, params.id);
      dbgApi(`planRestore ${params.id}`);
      return json(plan);
    });

    // POST /api/plans/:id/cut-tasks — create tasks from unchecked checkboxes
    route("POST", "/plans/:id/cut-tasks", async (_req, params) => {
      const result = await cutTasksFromPlan(rootDir, plansDir, params.id);
      dbgApi(`planCutTasks ${params.id}  ${result.createdTasks.length} tasks`);
      return json({
        plan: result.plan,
        createdTasks: result.createdTasks,
        count: result.createdTasks.length,
      });
    });
  }

  if (docsDir) {
    route("GET", "/docs/meta", async () => {
      const [projects, tags] = await Promise.all([
        getDocProjects(docsDir),
        getDocTags(docsDir),
      ]);
      return json({ projects, tags });
    });

    route("GET", "/docs", async (req) => {
      const url = new URL(req.url);
      const rawFilters: Record<string, unknown> = {};

      for (const key of ["project", "search"] as const) {
        const value = url.searchParams.get(key);
        if (value) rawFilters[key] = value;
      }

      const tagsParam = url.searchParams.getAll("tags");
      if (tagsParam.length > 0) rawFilters.tags = tagsParam;

      const filters = DocFiltersSchema.parse(rawFilters);
      const docs = await listDocs(
        docsDir,
        Object.keys(rawFilters).length > 0 ? filters : undefined,
      );
      return json(docs);
    });

    route("GET", "/docs/:id", async (_req, params) => {
      const doc = await getDoc(docsDir, params.id);
      if (!doc) return errorResponse(`Doc not found: ${params.id}`, 404);
      return json(doc);
    });

    route("POST", "/docs", async (req) => {
      const body = await readJsonBody(req);
      const input = CreateDocInputSchema.parse(body);
      const doc = await createDoc(rootDir, docsDir, input);
      dbgApi(`docCreate   ${doc.id}  "${doc.title}"`);
      return json(doc, 201);
    });

    route("PATCH", "/docs/:id", async (req, params) => {
      const body = await readJsonBody(req);
      const patch = DocPatchSchema.parse(body);
      const doc = await updateDoc(docsDir, params.id, patch);
      dbgApi(`docPatch    ${params.id}  [${Object.keys(patch).join(",")}]`);
      return json(doc);
    });

    route("PATCH", "/docs/:id/body", async (req, params) => {
      const body = (await readJsonBody(req)) as { body?: string };
      if (typeof body.body !== "string") {
        return errorResponse("Missing 'body' field", 400);
      }
      const doc = await updateDoc(docsDir, params.id, { body: body.body });
      dbgApi(`docBody     ${params.id}`);
      return json(doc);
    });

    route("DELETE", "/docs/:id", async (_req, params) => {
      dbgApi(`docDelete   ${params.id}`);
      await deleteDoc(rootDir, docsDir, params.id);
      return json({ ok: true });
    });

    route("POST", "/docs/:id/restore", async (_req, params) => {
      const doc = await restoreDoc(docsDir, params.id);
      dbgApi(`docRestore  ${params.id}`);
      return json(doc);
    });
  }

  // ─── Copilot routes ─────────────────────────────────────────────
  // Mounted only if a CopilotManager was passed in. Streaming output is
  // delivered over the WebSocket bridge in index.ts (frames `copilot.stream`
  // and `copilot.done`); these REST routes only handle session lifecycle.
  if (copilot) {
    route("GET", "/copilot/providers", async () => {
      const providers = await copilot.listProviderHealth();
      return json({
        defaultProviderId: copilot.getDefaultProviderId(),
        providers,
      });
    });

    route("GET", "/copilot/sessions", async () => {
      return json({ sessions: copilot.listSessions() });
    });

    route("POST", "/copilot/sessions", async (req) => {
      const body = (await readJsonBody(req).catch(() => ({}))) as {
        providerId?: string;
        conversationId?: string;
      };
      const providerId =
        body.providerId === "claude-code" || body.providerId === "codex"
          ? body.providerId
          : undefined;
      const conversationId = typeof body.conversationId === "string" ? body.conversationId : undefined;
      const result = await copilot.startSession({ providerId, conversationId });
      const meta = copilot.getSession(result.sessionId);
      dbgApi(`copilotSessionStart  ${result.sessionId}  ${meta?.providerId ?? "default"}${conversationId ? `  conv=${conversationId}` : ""}`);
      return json({ sessionId: result.sessionId, session: meta }, 201);
    });

    route("GET", "/copilot/conversations", async (req) => {
      const url = new URL(req.url);
      const providerId = url.searchParams.get("providerId");
      const parsedProviderId: CopilotProviderId | undefined =
        providerId === "claude-code" || providerId === "codex" ? providerId : undefined;
      return json({ conversations: copilot.listConversations(parsedProviderId) });
    });

    route("GET", "/copilot/conversations/:id/messages", async (_req, params) => {
      const messages = await copilot.loadConversationMessages(params.id);
      return json({ messages });
    });

    route("DELETE", "/copilot/conversations/:id", async (_req, params) => {
      dbgApi(`copilotConvDelete  ${params.id}`);
      copilot.deleteConversation(params.id);
      return json({ ok: true });
    });

    // Send a turn — fire and forget; output streams over the WebSocket bridge.
    route("POST", "/copilot/sessions/:id/messages", async (req, params) => {
      const body = (await readJsonBody(req)) as {
        text?: string;
        model?: string;
        reasoningEffort?: string;
      };
      if (typeof body.text !== "string" || !body.text.trim()) {
        return errorResponse("Missing 'text' field", 400);
      }
      const sendOpts = {
        model: typeof body.model === "string" && body.model.trim() ? body.model : undefined,
        reasoningEffort:
          typeof body.reasoningEffort === "string" && body.reasoningEffort.trim()
            ? body.reasoningEffort
            : undefined,
      };
      // Log provider + model + effort alongside the existing session/length
      // fields so it's obvious from the server log exactly which CLI
      // configuration each turn will use. "default" means the CLI's own
      // built-in default is in effect (no flag override passed).
      const sessionMeta = copilot.getSession(params.id);
      dbgApi(
        `copilotMessage  ${params.id}  ${body.text.length}ch  provider=${sessionMeta?.providerId ?? "?"}  model=${sendOpts.model ?? "default"}  effort=${sendOpts.reasoningEffort ?? "default"}`,
      );
      try {
        await copilot.sendMessage(params.id, body.text, sendOpts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("not found")) {
          return errorResponse(msg, 404);
        }
        throw err;
      }
      return json({ ok: true });
    });

    route("DELETE", "/copilot/sessions/:id", async (_req, params) => {
      dbgApi(`copilotSessionStop  ${params.id}`);
      await copilot.stopSession(params.id);
      return json({ ok: true });
    });
  }

  return routes;
}

export function matchRoute(
  routes: Route[],
  req: Request,
): { handler: RouteHandler; params: Record<string, string> } | null {
  const url = new URL(req.url);
  const pathname = url.pathname;

  for (const route of routes) {
    if (req.method !== route.method) continue;
    const match = pathname.match(route.regex);
    if (match) {
      const params: Record<string, string> = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        params[route.paramNames[i]] = decodeURIComponent(match[i + 1]);
      }
      return { handler: route.handler, params };
    }
  }
  return null;
}
