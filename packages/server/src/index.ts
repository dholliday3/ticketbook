import { resolve, join } from "node:path";
import { stat } from "node:fs/promises";
import { createRoutes, matchRoute, handleError, broadcastEvent } from "./api.js";
import { createWatcher } from "./watcher.js";
import { BunPtyHeadlessBackend, type TerminalSession } from "./terminal/index.js";
import { listTerminalTabs, upsertTerminalTab, getNextTabNumber, deleteTerminalTab } from "./db.js";
import { createDebug } from "./debug.js";
import { CopilotManager, type CopilotMessagePart } from "./copilot/index.js";
import { StubCopilotProvider } from "./copilot/stub-provider.js";
import { getConfig } from "@ticketbook/core";
import type { ServerMessage } from "@ticketbook/core";

const dbgWs = createDebug("ws");
const dbgApi = createDebug("api");
const dbgCop = createDebug("copilot");

export interface ServerConfig {
  ticketsDir: string;
  plansDir: string;
  port: number;
  staticDir?: string;
  /**
   * Absolute path to the bin/ticketbook.ts entry script. When set, the
   * copilot manager generates a per-session MCP config that points the
   * spawned `claude` CLI back at this same script in --mcp mode, so the
   * copilot has read/write access to the user's tickets and plans for free.
   * If omitted, the copilot still works but without ticketbook tool access.
   */
  binPath?: string;
}

export interface ServerHandle {
  port: number;
  close: () => void;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (origin && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function addCors(response: Response, origin: string | null): Response {
  const headers = corsHeaders(origin);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

function sendMsg(ws: { send(data: string): void }, msg: ServerMessage): void {
  try { ws.send(JSON.stringify(msg)); } catch { /* ws closed */ }
}

export function startServer(config: ServerConfig): ServerHandle {
  const { ticketsDir, plansDir, port, staticDir, binPath } = config;

  // Terminal session backend (owns PTYs, grace timers, and DB cleanup on destroy)
  const terminalBackend = new BunPtyHeadlessBackend(ticketsDir);

  // Copilot session manager — wraps the Claude Code provider, owns per-session
  // MCP config files. Pass binPath through so the spawned CLI can call back
  // into ticketbook's own MCP server.
  // E2E tests set COPILOT_PROVIDER=stub to inject a fake provider that
  // streams scripted responses without spawning real `claude` (no LLM cost,
  // no install requirement).
  const useStub = process.env.COPILOT_PROVIDER === "stub";
  const copilot = new CopilotManager({
    ticketsDir,
    binPath,
    provider: useStub ? new StubCopilotProvider() : undefined,
  });

  const routes = createRoutes(ticketsDir, plansDir, copilot);

  // Track active WebSocket connections per session for graceful teardown.
  // Used by both terminal and copilot WS bridges.
  const wsConnections = new Map<string, { close(code?: number, reason?: string): void }>();

  // Track the per-WS listener dispose functions so close() can clean up cleanly
  const wsDisposers = new Map<string, Array<() => void>>();

  /** Read terminalScrollback from .tickets/.config.yaml; falls back to schema default (5000). */
  async function readScrollback(): Promise<number> {
    try {
      const cfg = await getConfig(ticketsDir);
      return cfg.terminalScrollback;
    } catch {
      return 5000;
    }
  }

  async function tryServeStatic(pathname: string): Promise<Response | null> {
    if (!staticDir) return null;

    // Prevent directory traversal
    const filePath = resolve(staticDir, pathname.replace(/^\/+/, ""));
    if (!filePath.startsWith(staticDir)) return null;

    try {
      const fileStat = await stat(filePath);
      if (fileStat.isFile()) {
        return new Response(Bun.file(filePath));
      }
    } catch {
      // File doesn't exist
    }

    // SPA fallback: try serving index.html for non-file paths
    try {
      const indexPath = join(staticDir, "index.html");
      const indexStat = await stat(indexPath);
      if (indexStat.isFile()) {
        return new Response(Bun.file(indexPath));
      }
    } catch {
      // No index.html
    }

    return null;
  }

  type WsData =
    | { kind: "terminal"; sessionId: string; ticketsDir: string }
    | { kind: "copilot"; sessionId: string };

  const server = Bun.serve<WsData>({
    port,
    idleTimeout: 255, // max; prevents Bun from killing WebSocket upgrade requests
    async fetch(req, server) {
      const origin = req.headers.get("Origin");

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        return addCors(new Response(null, { status: 204 }), origin);
      }

      const url = new URL(req.url);

      // Terminal tab management
      if (url.pathname === "/api/terminal/sessions") {
        if (req.method === "GET") {
          // Return persisted tabs with alive status from the backend
          const tabs = listTerminalTabs(ticketsDir);
          const aliveSet = new Set(terminalBackend.list());
          const sessions = tabs.map((t) => ({ id: t.id, title: t.title, sortOrder: t.sort_order, tabNumber: t.tab_number, alive: aliveSet.has(t.id) }));
          return addCors(new Response(JSON.stringify({ sessions }), { headers: { "Content-Type": "application/json" } }), origin);
        }
        if (req.method === "POST") {
          // Server assigns id, title, and tab number
          const body = await req.json() as { sortOrder?: number };
          const tabNumber = getNextTabNumber(ticketsDir);
          const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const title = `Terminal ${tabNumber}`;
          const sortOrder = body.sortOrder ?? 0;
          upsertTerminalTab(ticketsDir, id, title, sortOrder, tabNumber);
          dbgApi("tabCreate", { id, title, tabNumber, sortOrder });
          return addCors(new Response(JSON.stringify({ id, title, tabNumber, sortOrder }), { headers: { "Content-Type": "application/json" } }), origin);
        }
        if (req.method === "DELETE") {
          const body = await req.json() as { id?: string };
          if (!body.id) return addCors(new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: { "Content-Type": "application/json" } }), origin);

          // Close WebSocket first (gracefully) to prevent ECONNRESET
          const existingWs = wsConnections.get(body.id);
          const hadWs = !!existingWs;
          if (existingWs) {
            try { existingWs.close(1000, "session destroyed"); } catch { /* already closed */ }
            wsConnections.delete(body.id);
          }

          dbgApi("tabDelete", { id: body.id, hadWs });
          // Destroy the session if it exists; the backend handles DB row cleanup
          // via its onFullyDestroyed callback. If no session exists (e.g. server
          // restarted), still remove the DB row.
          const session = terminalBackend.get(body.id);
          if (session) {
            session.destroy();
          } else {
            deleteTerminalTab(ticketsDir, body.id);
          }
          return addCors(new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } }), origin);
        }
      }

      // WebSocket upgrade for terminal
      const termMatch = url.pathname.match(/^\/api\/terminal\/(.+)$/);
      if (termMatch && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const sessionId = decodeURIComponent(termMatch[1]);
        const success = server.upgrade(req, {
          data: { kind: "terminal", sessionId, ticketsDir } satisfies WsData,
        });
        if (success) return undefined as unknown as Response;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      // WebSocket upgrade for copilot — one-way stream of message parts and
      // done events for a single copilot session. Client subscribes by
      // connecting to /api/copilot/<sessionId> right after creating the
      // session via REST.
      const copMatch = url.pathname.match(/^\/api\/copilot\/(.+)$/);
      if (copMatch && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const sessionId = decodeURIComponent(copMatch[1]);
        const success = server.upgrade(req, {
          data: { kind: "copilot", sessionId } satisfies WsData,
        });
        if (success) return undefined as unknown as Response;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      // API routes
      if (url.pathname.startsWith("/api")) {
        const matched = matchRoute(routes, req);
        if (!matched) {
          return addCors(
            new Response(JSON.stringify({ error: "Not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }),
            origin,
          );
        }

        try {
          const response = await matched.handler(req, matched.params);
          return addCors(response, origin);
        } catch (err) {
          return addCors(handleError(err), origin);
        }
      }

      // Static file serving for UI
      const staticResponse = await tryServeStatic(url.pathname);
      if (staticResponse) return staticResponse;

      return new Response("Not found", { status: 404 });
    },
    websocket: {
      idleTimeout: 0, // disable — terminal sessions can be idle indefinitely
      open(ws) {
        const { sessionId, kind } = ws.data;
        // Just track the connection — PTY creation is deferred until "init" handshake
        wsConnections.set(sessionId, ws);
        dbgWs("open", { sessionId, kind });

        // Copilot WS is push-only: subscribe to manager events for this
        // session and forward them as JSON frames. The client doesn't send
        // any input on this socket — it uses POST /api/copilot/sessions/:id/messages.
        if (kind === "copilot") {
          const dispose = copilot.subscribe({
            stream: (sid: string, part: CopilotMessagePart, messageId: string) => {
              if (sid !== sessionId) return;
              try {
                ws.send(JSON.stringify({ type: "copilot.stream", sessionId: sid, messageId, part }));
              } catch {
                /* socket closed */
              }
            },
            done: (sid: string) => {
              if (sid !== sessionId) return;
              try {
                ws.send(JSON.stringify({ type: "copilot.done", sessionId: sid }));
              } catch {
                /* socket closed */
              }
            },
          });
          const existing = wsDisposers.get(sessionId) ?? [];
          existing.push(dispose);
          wsDisposers.set(sessionId, existing);
          dbgCop("subscribed", { sessionId });
          // Send a ready frame so the client knows the bridge is live.
          try { ws.send(JSON.stringify({ type: "ready" })); } catch { /* closed */ }
        }
      },
      async message(ws, message) {
        if (ws.data.kind === "copilot") {
          // Copilot WS is push-only — ignore inbound frames.
          return;
        }
        const { sessionId, ticketsDir: cwd } = ws.data;
        try {
          const msg = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));

          if (msg.type === "init" && typeof msg.cols === "number" && typeof msg.rows === "number") {
            // Handshake: client sends its actual dimensions
            let session: TerminalSession | undefined = terminalBackend.get(sessionId);
            const mode = session?.alive ? "reattach" : "spawn";
            dbgWs("init", { sessionId, mode, cols: msg.cols, rows: msg.rows });

            if (session?.alive) {
              // Reattach flow: cancel grace timer, resize both the PTY and
              // the headless mirror, then send the mirror's serialized state
              // as a single replay message. No more Ctrl-L hack — the client
              // gets exactly what the server had on screen.
              session.reattach();
              session.resize(msg.cols, msg.rows);
              sendMsg(ws, { type: "replay", data: session.serialize() });
            } else {
              // New session: spawn PTY with correct dimensions
              const scrollback = await readScrollback();
              session = terminalBackend.create({
                id: sessionId,
                cwd: resolve(cwd, ".."),
                cols: msg.cols,
                rows: msg.rows,
                scrollback,
              });
            }

            // Wire output + exit listeners. onData returns a dispose fn so
            // that when this WebSocket closes we can unregister cleanly
            // without touching other listeners on the same session.
            const disposeData = session.onData((data: string) => sendMsg(ws, { type: "output", data }));
            const disposeExit = session.onExit(() => { try { ws.close(); } catch { /* already closed */ } });

            // Stash the disposers keyed by sessionId so the close handler finds them
            const existing = wsDisposers.get(sessionId) ?? [];
            existing.push(disposeData, disposeExit);
            wsDisposers.set(sessionId, existing);

            sendMsg(ws, { type: "ready" });
            return;
          }

          const session = terminalBackend.get(sessionId);
          if (!session) return;
          if (msg.type === "input" && typeof msg.data === "string") {
            session.write(msg.data);
          } else if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
            session.resize(msg.cols, msg.rows);
          }
        } catch {
          // ignore malformed messages
        }
      },
      close(ws, code, reason) {
        const { sessionId, kind } = ws.data;
        dbgWs("close", { sessionId, kind, code, reason });
        wsConnections.delete(sessionId);
        // Drop this connection's listeners (terminal output forwarders or
        // copilot stream subscribers, depending on kind).
        const disposers = wsDisposers.get(sessionId);
        if (disposers) {
          for (const d of disposers) {
            try { d(); } catch { /* ignore */ }
          }
          wsDisposers.delete(sessionId);
        }
        if (kind === "terminal") {
          // Don't destroy — start grace timer for reconnection
          const session = terminalBackend.get(sessionId);
          session?.detach();
        }
        // Copilot sessions are short-lived and explicit — they're stopped via
        // DELETE /api/copilot/sessions/:id, not by closing the WebSocket.
      },
    },
  });

  // Start file watchers for live SSE updates
  const ticketWatcher = createWatcher(ticketsDir, (event) =>
    broadcastEvent({ ...event, source: "ticket" }),
  );
  const planWatcher = createWatcher(plansDir, (event) =>
    broadcastEvent({ ...event, source: "plan" }),
  );

  const shutdown = () => {
    terminalBackend.destroyAll();
    void copilot.stopAll();
    ticketWatcher.close();
    planWatcher.close();
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return {
    port: server.port ?? port,
    close() {
      terminalBackend.destroyAll();
      void copilot.stopAll();
      ticketWatcher.close();
      planWatcher.close();
      server.stop();
    },
  };
}

// Direct execution
if (import.meta.main) {
  const ticketsDir = resolve(process.env.TICKETS_DIR ?? ".tickets");
  const plansDir = resolve(process.env.PLANS_DIR ?? ".plans");
  const port = parseInt(process.env.PORT ?? "4242", 10);
  const staticDir = resolve(
    process.env.STATIC_DIR ?? join(import.meta.dir, "../../ui/dist"),
  );

  const handle = startServer({ ticketsDir, plansDir, port, staticDir });
  console.log(`Ticketbook server listening on http://localhost:${handle.port}`);
  console.log(`Tickets directory: ${ticketsDir}`);
  console.log(`Plans directory: ${plansDir}`);
}
