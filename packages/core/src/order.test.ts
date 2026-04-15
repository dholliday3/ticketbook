import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sortTasks, reorderTask, rebalanceOrder } from "./order.js";
import { createTask, updateTask } from "./writer.js";
import { listTasks } from "./reader.js";
import type { Task } from "./types.js";

function makeTicket(overrides: Partial<Task>): Task {
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

describe("sortTasks", () => {
  test("ordered tasks sort before unordered", () => {
    const tasks = [
      makeTicket({ id: "A", order: undefined }),
      makeTicket({ id: "B", order: 1000 }),
    ];
    const sorted = sortTasks(tasks);
    expect(sorted[0].id).toBe("B");
    expect(sorted[1].id).toBe("A");
  });

  test("orders by order value ascending", () => {
    const tasks = [
      makeTicket({ id: "A", order: 2000 }),
      makeTicket({ id: "B", order: 1000 }),
      makeTicket({ id: "C", order: 3000 }),
    ];
    const sorted = sortTasks(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["B", "A", "C"]);
  });

  test("unordered tasks sort by priority then date", () => {
    const tasks = [
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
    const sorted = sortTasks(tasks);
    expect(sorted[0].id).toBe("B"); // urgent first
    expect(sorted[1].id).toBe("C"); // low, newer
    expect(sorted[2].id).toBe("A"); // low, older
  });
});

describe("reorderTask", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "relay-order-"));
    await writeFile(join(dir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("places task between two neighbors", async () => {
    const t1 = await createTask(dir, { title: "First" });
    await updateTask(dir, t1.id, { order: 1000 });
    const t2 = await createTask(dir, { title: "Second" });
    await updateTask(dir, t2.id, { order: 2000 });
    const t3 = await createTask(dir, { title: "Third" });

    const result = await reorderTask(dir, t3.id, t1.id, t2.id);
    expect(result.order).toBe(1500);
  });

  test("places task at bottom (after last)", async () => {
    const t1 = await createTask(dir, { title: "First" });
    await updateTask(dir, t1.id, { order: 1000 });
    const t2 = await createTask(dir, { title: "Second" });

    const result = await reorderTask(dir, t2.id, t1.id, null);
    expect(result.order).toBe(2000);
  });

  test("places task at top (before first)", async () => {
    const t1 = await createTask(dir, { title: "First" });
    await updateTask(dir, t1.id, { order: 1000 });
    const t2 = await createTask(dir, { title: "Second" });

    const result = await reorderTask(dir, t2.id, null, t1.id);
    // Should get an order less than 1000
    expect(result.order!).toBeLessThan(1000);
  });
});

describe("rebalanceOrder", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "relay-order-"));
    await writeFile(join(dir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("normalizes order values to clean integers", async () => {
    const t1 = await createTask(dir, { title: "A", status: "open" });
    await updateTask(dir, t1.id, { order: 1.5 });
    const t2 = await createTask(dir, { title: "B", status: "open" });
    await updateTask(dir, t2.id, { order: 2.7 });
    const t3 = await createTask(dir, { title: "C", status: "open" });
    await updateTask(dir, t3.id, { order: 5.3 });

    await rebalanceOrder(dir, "open");

    const tasks = await listTasks(dir, { status: "open" });
    const orders = tasks
      .map((t) => t.order)
      .filter((o) => o != null)
      .sort((a, b) => a! - b!);

    expect(orders).toEqual([1000, 2000, 3000]);
  });
});
