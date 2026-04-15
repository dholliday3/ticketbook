import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  listTasks,
  getTask,
  searchTasks,
  getProjects,
  getEpics,
  getSprints,
  getTags,
} from "./reader.js";
import { createTask } from "./writer.js";

describe("reader", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "relay-reader-"));
    await writeFile(join(dir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("listTasks returns empty array for empty directory", async () => {
    const tasks = await listTasks(dir);
    expect(tasks).toEqual([]);
  });

  test("listTasks returns empty array for non-existent directory", async () => {
    const tasks = await listTasks(join(dir, "nonexistent"));
    expect(tasks).toEqual([]);
  });

  test("listTasks finds created tasks", async () => {
    await createTask(dir, { title: "First" });
    await createTask(dir, { title: "Second" });

    const tasks = await listTasks(dir);
    expect(tasks).toHaveLength(2);
  });

  test("listTasks ignores .counter", async () => {
    await createTask(dir, { title: "Test" });

    const tasks = await listTasks(dir);
    expect(tasks).toHaveLength(1);
  });

  test("listTasks ignores .archive directory", async () => {
    await createTask(dir, { title: "Active" });

    // Create a file in .archive
    const archiveDir = join(dir, ".archive");
    await mkdir(archiveDir, { recursive: true });
    await writeFile(
      join(archiveDir, "TKT-099-old.md"),
      "---\nid: TKT-099\ntitle: Old\nstatus: done\ncreated: 2024-01-01\nupdated: 2024-01-01\n---\n",
      "utf-8",
    );

    const tasks = await listTasks(dir);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Active");
  });

  test("listTasks filters by status", async () => {
    await createTask(dir, { title: "Open", status: "open" });
    await createTask(dir, { title: "Done", status: "done" });

    const open = await listTasks(dir, { status: "open" });
    expect(open).toHaveLength(1);
    expect(open[0].title).toBe("Open");
  });

  test("listTasks filters by multiple statuses", async () => {
    await createTask(dir, { title: "Open", status: "open" });
    await createTask(dir, { title: "Done", status: "done" });
    await createTask(dir, { title: "Backlog", status: "backlog" });

    const result = await listTasks(dir, { status: ["open", "done"] });
    expect(result).toHaveLength(2);
  });

  test("listTasks filters by priority", async () => {
    await createTask(dir, { title: "High", priority: "high" });
    await createTask(dir, { title: "Low", priority: "low" });

    const high = await listTasks(dir, { priority: "high" });
    expect(high).toHaveLength(1);
    expect(high[0].title).toBe("High");
  });

  test("listTasks filters by project", async () => {
    await createTask(dir, { title: "P1", project: "alpha" });
    await createTask(dir, { title: "P2", project: "beta" });

    const result = await listTasks(dir, { project: "alpha" });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("P1");
  });

  test("listTasks filters by tags", async () => {
    await createTask(dir, { title: "Tagged", tags: ["bug", "frontend"] });
    await createTask(dir, { title: "Other", tags: ["feature"] });

    const result = await listTasks(dir, { tags: ["bug"] });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Tagged");
  });

  test("listTasks filters by search", async () => {
    await createTask(dir, { title: "Fix login crash" });
    await createTask(dir, { title: "Add search feature" });

    const result = await listTasks(dir, { search: "login" });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Fix login crash");
  });

  test("getTask returns a task by ID", async () => {
    const created = await createTask(dir, { title: "Find Me" });
    const found = await getTask(dir, created.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Find Me");
  });

  test("getTask returns null for non-existent ID", async () => {
    const result = await getTask(dir, "TKT-999");
    expect(result).toBeNull();
  });

  test("searchTasks finds matches in title and body", async () => {
    await createTask(dir, {
      title: "Normal Title",
      body: "Contains special keyword here",
    });
    await createTask(dir, { title: "Unrelated" });

    const results = await searchTasks(dir, "special keyword");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Normal Title");
  });

  test("getProjects returns unique project names", async () => {
    await createTask(dir, { title: "A", project: "alpha" });
    await createTask(dir, { title: "B", project: "beta" });
    await createTask(dir, { title: "C", project: "alpha" });

    const projects = await getProjects(dir);
    expect(projects).toEqual(["alpha", "beta"]);
  });

  test("getEpics returns unique epic names", async () => {
    await createTask(dir, { title: "A", epic: "v1" });
    await createTask(dir, { title: "B", epic: "v2" });

    const epics = await getEpics(dir);
    expect(epics).toEqual(["v1", "v2"]);
  });

  test("getSprints returns unique sprint names", async () => {
    await createTask(dir, { title: "A", sprint: "sprint-1" });

    const sprints = await getSprints(dir);
    expect(sprints).toEqual(["sprint-1"]);
  });

  test("getTags returns unique tag values", async () => {
    await createTask(dir, { title: "A", tags: ["bug", "frontend"] });
    await createTask(dir, { title: "B", tags: ["bug", "backend"] });

    const tags = await getTags(dir);
    expect(tags).toEqual(["backend", "bug", "frontend"]);
  });
});
