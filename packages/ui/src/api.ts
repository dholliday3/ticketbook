import type { Ticket, TicketPatch, Meta, TicketbookConfig, CreateTicketInput } from "./types";

const BASE = "/api";

export async function fetchTickets(): Promise<Ticket[]> {
  const res = await fetch(`${BASE}/tickets`);
  if (!res.ok) throw new Error(`Failed to fetch tickets: ${res.status}`);
  return res.json();
}

export async function fetchTicket(id: string): Promise<Ticket> {
  const res = await fetch(`${BASE}/tickets/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to fetch ticket: ${res.status}`);
  return res.json();
}

export async function patchTicket(id: string, patch: TicketPatch): Promise<Ticket> {
  const res = await fetch(`${BASE}/tickets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to patch ticket: ${res.status}`);
  return res.json();
}

export async function patchTicketBody(id: string, body: string): Promise<Ticket> {
  const res = await fetch(`${BASE}/tickets/${encodeURIComponent(id)}/body`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`Failed to patch ticket body: ${res.status}`);
  return res.json();
}

export async function fetchMeta(): Promise<Meta> {
  const res = await fetch(`${BASE}/meta`);
  if (!res.ok) throw new Error(`Failed to fetch meta: ${res.status}`);
  return res.json();
}

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const res = await fetch(`${BASE}/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create ticket: ${res.status}`);
  return res.json();
}

export async function deleteTicket(id: string): Promise<void> {
  const res = await fetch(`${BASE}/tickets/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete ticket: ${res.status}`);
}

export async function fetchConfig(): Promise<TicketbookConfig> {
  const res = await fetch(`${BASE}/config`);
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.status}`);
  return res.json();
}

export async function patchConfig(patch: Partial<TicketbookConfig>): Promise<TicketbookConfig> {
  const res = await fetch(`${BASE}/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to update config: ${res.status}`);
  return res.json();
}

export async function reorderTicket(
  id: string,
  afterId: string | null,
  beforeId: string | null,
): Promise<Ticket> {
  const res = await fetch(`${BASE}/tickets/${encodeURIComponent(id)}/reorder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ afterId, beforeId }),
  });
  if (!res.ok) throw new Error(`Failed to reorder ticket: ${res.status}`);
  return res.json();
}

export function subscribeSSE(onEvent: (event: { type: string; ticketId?: string }) => void): () => void {
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
