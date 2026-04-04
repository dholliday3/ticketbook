import { listTickets } from "./reader.js";
import { updateTicket } from "./writer.js";
import type { Ticket } from "./types.js";

const REBALANCE_STEP = 1000;
const MAX_DECIMAL_PLACES = 10;

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function decimalPlaces(n: number): number {
  const s = n.toString();
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * Sort tickets: ordered tickets first (by order asc), then unordered
 * tickets by priority (urgent→low) then updated date (newest first).
 */
export function sortTickets(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => {
    const aHasOrder = a.order != null;
    const bHasOrder = b.order != null;

    if (aHasOrder && bHasOrder) return a.order! - b.order!;
    if (aHasOrder && !bHasOrder) return -1;
    if (!aHasOrder && bHasOrder) return 1;

    // Both unordered: sort by priority then updated date
    const aPri = a.priority ? (PRIORITY_RANK[a.priority] ?? 4) : 4;
    const bPri = b.priority ? (PRIORITY_RANK[b.priority] ?? 4) : 4;
    if (aPri !== bPri) return aPri - bPri;

    return b.updated.getTime() - a.updated.getTime();
  });
}

/**
 * Rebalance order values for all tickets with a given status to clean
 * integers (1000, 2000, 3000, ...).
 */
export async function rebalanceOrder(
  dir: string,
  status: string,
): Promise<void> {
  const tickets = await listTickets(dir, { status: status as "draft" | "backlog" | "open" | "in-progress" | "done" | "cancelled" });
  const sorted = sortTickets(tickets);

  for (let i = 0; i < sorted.length; i++) {
    const newOrder = (i + 1) * REBALANCE_STEP;
    if (sorted[i].order !== newOrder) {
      await updateTicket(dir, sorted[i].id, { order: newOrder });
    }
  }
}

/**
 * Reorder a ticket by placing it between two neighbors. Calculates the
 * midpoint order value. If the midpoint requires more than 10 decimal
 * places, triggers an automatic rebalance first, then recalculates.
 *
 * @param dir - .tickets directory path
 * @param id - ticket to move
 * @param afterId - ticket above (lower order), or null if placing at top
 * @param beforeId - ticket below (higher order), or null if placing at bottom
 */
export async function reorderTicket(
  dir: string,
  id: string,
  afterId: string | null,
  beforeId: string | null,
): Promise<Ticket> {
  const ticket = await getNeighborOrder(dir, id);
  if (!ticket) throw new Error(`Ticket not found: ${id}`);

  const afterOrder = afterId ? await getNeighborOrder(dir, afterId) : null;
  const beforeOrder = beforeId ? await getNeighborOrder(dir, beforeId) : null;

  let newOrder = calculateMidpoint(
    afterOrder?.order ?? null,
    beforeOrder?.order ?? null,
  );

  if (decimalPlaces(newOrder) > MAX_DECIMAL_PLACES) {
    await rebalanceOrder(dir, ticket.status);
    // Re-read neighbor orders after rebalance
    const afterRebalanced = afterId
      ? await getNeighborOrder(dir, afterId)
      : null;
    const beforeRebalanced = beforeId
      ? await getNeighborOrder(dir, beforeId)
      : null;
    newOrder = calculateMidpoint(
      afterRebalanced?.order ?? null,
      beforeRebalanced?.order ?? null,
    );
  }

  return updateTicket(dir, id, { order: newOrder });
}

async function getNeighborOrder(
  dir: string,
  id: string,
): Promise<{ order: number | undefined; status: string } | null> {
  const tickets = await listTickets(dir);
  const t = tickets.find((t) => t.id === id);
  if (!t) return null;
  return { order: t.order, status: t.status };
}

function calculateMidpoint(
  afterOrder: number | null | undefined,
  beforeOrder: number | null | undefined,
): number {
  const after = afterOrder ?? null;
  const before = beforeOrder ?? null;

  if (after != null && before != null) {
    return (after + before) / 2;
  }
  if (after != null) {
    return after + REBALANCE_STEP;
  }
  if (before != null) {
    return before > REBALANCE_STEP ? before - REBALANCE_STEP : before / 2;
  }
  return REBALANCE_STEP;
}
