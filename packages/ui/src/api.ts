import type {
  Task,
  TaskPatch,
  Meta,
  RelayConfig,
  CreateTaskInput,
  Plan,
  PlanPatch,
  CreatePlanInput,
  PlanMeta,
  Doc,
  DocPatch,
  CreateDocInput,
  DocMeta,
} from "./types";

const BASE = "/api";

export async function fetchTasks(): Promise<Task[]> {
  const res = await fetch(`${BASE}/tasks`);
  if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`);
  return res.json();
}

export async function fetchTask(id: string): Promise<Task> {
  const res = await fetch(`${BASE}/tasks/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to fetch task: ${res.status}`);
  return res.json();
}

export async function patchTask(id: string, patch: TaskPatch): Promise<Task> {
  const res = await fetch(`${BASE}/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to patch task: ${res.status}`);
  return res.json();
}

export async function patchTaskBody(id: string, body: string): Promise<Task> {
  const res = await fetch(`${BASE}/tasks/${encodeURIComponent(id)}/body`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`Failed to patch task body: ${res.status}`);
  return res.json();
}

export async function fetchMeta(): Promise<Meta> {
  const res = await fetch(`${BASE}/meta`);
  if (!res.ok) throw new Error(`Failed to fetch meta: ${res.status}`);
  return res.json();
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const res = await fetch(`${BASE}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create task: ${res.status}`);
  return res.json();
}

export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`${BASE}/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete task: ${res.status}`);
}

export async function fetchConfig(): Promise<RelayConfig> {
  const res = await fetch(`${BASE}/config`);
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.status}`);
  return res.json();
}

export async function patchConfig(patch: Partial<RelayConfig>): Promise<RelayConfig> {
  const res = await fetch(`${BASE}/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to update config: ${res.status}`);
  return res.json();
}

export async function reorderTask(
  id: string,
  afterId: string | null,
  beforeId: string | null,
): Promise<Task> {
  const res = await fetch(`${BASE}/tasks/${encodeURIComponent(id)}/reorder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ afterId, beforeId }),
  });
  if (!res.ok) throw new Error(`Failed to reorder task: ${res.status}`);
  return res.json();
}

// --- Plans ---

export async function fetchPlans(): Promise<Plan[]> {
  const res = await fetch(`${BASE}/plans`);
  if (!res.ok) throw new Error(`Failed to fetch plans: ${res.status}`);
  return res.json();
}

export async function fetchPlan(id: string): Promise<Plan> {
  const res = await fetch(`${BASE}/plans/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to fetch plan: ${res.status}`);
  return res.json();
}

export async function patchPlan(id: string, patch: PlanPatch): Promise<Plan> {
  const res = await fetch(`${BASE}/plans/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to patch plan: ${res.status}`);
  return res.json();
}

export async function patchPlanBody(id: string, body: string): Promise<Plan> {
  const res = await fetch(`${BASE}/plans/${encodeURIComponent(id)}/body`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`Failed to patch plan body: ${res.status}`);
  return res.json();
}

export async function createPlan(input: CreatePlanInput): Promise<Plan> {
  const res = await fetch(`${BASE}/plans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create plan: ${res.status}`);
  return res.json();
}

export async function deletePlan(id: string): Promise<void> {
  const res = await fetch(`${BASE}/plans/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete plan: ${res.status}`);
}

export async function fetchPlanMeta(): Promise<PlanMeta> {
  const res = await fetch(`${BASE}/plans/meta`);
  if (!res.ok) throw new Error(`Failed to fetch plan meta: ${res.status}`);
  return res.json();
}

export async function cutTasksFromPlan(planId: string): Promise<{ plan: Plan; createdTasks: any[]; count: number }> {
  const res = await fetch(`${BASE}/plans/${encodeURIComponent(planId)}/cut-tasks`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Failed to cut tasks: ${res.status}`);
  return res.json();
}

export function subscribeSSE(onEvent: (event: { type: string; taskId?: string; source?: string }) => void): () => void {
  let es: EventSource | null = new EventSource(`${BASE}/events`);

  es.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);
      onEvent(data);
    } catch {
      // ignore malformed events
    }
  };

  es.onerror = () => {
    // EventSource auto-reconnects by default
  };

  return () => {
    if (es) {
      es.close();
      es = null;
    }
  };
}

export async function fetchDocs(): Promise<Doc[]> {
  const res = await fetch(`${BASE}/docs`);
  if (!res.ok) throw new Error(`Failed to fetch docs: ${res.status}`);
  return res.json();
}

export async function fetchDoc(id: string): Promise<Doc> {
  const res = await fetch(`${BASE}/docs/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to fetch doc: ${res.status}`);
  return res.json();
}

export async function patchDoc(id: string, patch: DocPatch): Promise<Doc> {
  const res = await fetch(`${BASE}/docs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to patch doc: ${res.status}`);
  return res.json();
}

export async function patchDocBody(id: string, body: string): Promise<Doc> {
  const res = await fetch(`${BASE}/docs/${encodeURIComponent(id)}/body`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`Failed to patch doc body: ${res.status}`);
  return res.json();
}

export async function createDoc(input: CreateDocInput): Promise<Doc> {
  const res = await fetch(`${BASE}/docs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create doc: ${res.status}`);
  return res.json();
}

export async function deleteDoc(id: string): Promise<void> {
  const res = await fetch(`${BASE}/docs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete doc: ${res.status}`);
}

export async function fetchDocMeta(): Promise<DocMeta> {
  const res = await fetch(`${BASE}/docs/meta`);
  if (!res.ok) throw new Error(`Failed to fetch doc meta: ${res.status}`);
  return res.json();
}
