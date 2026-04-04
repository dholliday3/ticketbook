import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sortTickets, reorderTicket, rebalanceOrder } from "./order.js";
import { createTicket, updateTicket } from "./writer.js";
import { listTickets } from "./reader.js";
import type { Ticket } from "./types.js";

function makeTicket(overrides: Partial<Ticket>): Ticket {
  return {
    id: "TKT-001",
    title: "Test",
    status: "open",
    created: new Date("2024-01-01"),
    updated: new Date("2024-01-01"),
    body: "",
    filePath: "/tmp/test.md",
    ...overrides,
  };
}

describe("sortTickets", () => {
  test("ordered tickets sort before unordered", () => {
    const tickets = [
      makeTicket({ id: "A", order: undefined }),
      makeTicket({ id: "B", order: 1000 }),
    ];
    const sorted = sortTickets(tickets);
    expect(sorted[0].id).toBe("B");
    expect(sorted[1].id).toBe("A");
  });

  test("orders by order value ascending", () => {
    const tickets = [
      makeTicket({ id: "A", order: 2000 }),
      makeTicket({ id: "B", order: 1000 }),
      makeTicket({ id: "C", order: 3000 }),
    ];
    const sorted = sortTickets(tickets);
    expect(sorted.map((t) => t.id)).toEqual(["B", "A", "C"]);
  });

  test("unordered tickets sort by priority then date", () => {
    const tickets = [
      makeTicket({
        id: "A",
        priority: "low",
        updated: new Date("2024-01-01"),
      }),
      makeTicket({
        id: "B",
        priority: "urgent",
        updated: new Date("2024-01-01"),
      }),
      makeTicket({
        id: "C",
        priority: "low",
        updated: new Date("2024-06-01"),
      }),
    ];
    const sorted = sortTickets(tickets);
    expect(sorted[0].id).toBe("B"); // urgent first
    expect(sorted[1].id).toBe("C"); // low, newer
    expect(sorted[2].id).toBe("A"); // low, older
  });
});

describe("reorderTicket", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-order-"));
    await writeFile(join(dir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("places ticket between two neighbors", async () => {
    const t1 = await createTicket(dir, { title: "First" });
    await updateTicket(dir, t1.id, { order: 1000 });
    const t2 = await createTicket(dir, { title: "Second" });
    await updateTicket(dir, t2.id, { order: 2000 });
    const t3 = await createTicket(dir, { title: "Third" });

    const result = await reorderTicket(dir, t3.id, t1.id, t2.id);
    expect(result.order).toBe(1500);
  });

  test("places ticket at bottom (after last)", async () => {
    const t1 = await createTicket(dir, { title: "First" });
    await updateTicket(dir, t1.id, { order: 1000 });
    const t2 = await createTicket(dir, { title: "Second" });

    const result = await reorderTicket(dir, t2.id, t1.id, null);
    expect(result.order).toBe(2000);
  });

  test("places ticket at top (before first)", async () => {
    const t1 = await createTicket(dir, { title: "First" });
    await updateTicket(dir, t1.id, { order: 1000 });
    const t2 = await createTicket(dir, { title: "Second" });

    const result = await reorderTicket(dir, t2.id, null, t1.id);
    // Should get an order less than 1000
    expect(result.order!).toBeLessThan(1000);
  });
});

describe("rebalanceOrder", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-order-"));
    await writeFile(join(dir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("normalizes order values to clean integers", async () => {
    const t1 = await createTicket(dir, { title: "A", status: "open" });
    await updateTicket(dir, t1.id, { order: 1.5 });
    const t2 = await createTicket(dir, { title: "B", status: "open" });
    await updateTicket(dir, t2.id, { order: 2.7 });
    const t3 = await createTicket(dir, { title: "C", status: "open" });
    await updateTicket(dir, t3.id, { order: 5.3 });

    await rebalanceOrder(dir, "open");

    const tickets = await listTickets(dir, { status: "open" });
    const orders = tickets
      .map((t) => t.order)
      .filter((o) => o != null)
      .sort((a, b) => a! - b!);

    expect(orders).toEqual([1000, 2000, 3000]);
  });
});
