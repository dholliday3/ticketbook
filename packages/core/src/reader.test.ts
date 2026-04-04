import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  listTickets,
  getTicket,
  searchTickets,
  getProjects,
  getEpics,
  getSprints,
  getTags,
} from "./reader.js";
import { createTicket } from "./writer.js";

describe("reader", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-reader-"));
    await writeFile(join(dir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("listTickets returns empty array for empty directory", async () => {
    const tickets = await listTickets(dir);
    expect(tickets).toEqual([]);
  });

  test("listTickets returns empty array for non-existent directory", async () => {
    const tickets = await listTickets(join(dir, "nonexistent"));
    expect(tickets).toEqual([]);
  });

  test("listTickets finds created tickets", async () => {
    await createTicket(dir, { title: "First" });
    await createTicket(dir, { title: "Second" });

    const tickets = await listTickets(dir);
    expect(tickets).toHaveLength(2);
  });

  test("listTickets ignores .counter and .config.yaml", async () => {
    await createTicket(dir, { title: "Test" });
    await writeFile(join(dir, ".config.yaml"), "prefix: TKT\n", "utf-8");

    const tickets = await listTickets(dir);
    expect(tickets).toHaveLength(1);
  });

  test("listTickets ignores .archive directory", async () => {
    await createTicket(dir, { title: "Active" });

    // Create a file in .archive
    const archiveDir = join(dir, ".archive");
    await mkdir(archiveDir, { recursive: true });
    await writeFile(
      join(archiveDir, "TKT-099-old.md"),
      "---\nid: TKT-099\ntitle: Old\nstatus: done\ncreated: 2024-01-01\nupdated: 2024-01-01\n---\n",
      "utf-8",
    );

    const tickets = await listTickets(dir);
    expect(tickets).toHaveLength(1);
    expect(tickets[0].title).toBe("Active");
  });

  test("listTickets filters by status", async () => {
    await createTicket(dir, { title: "Open", status: "open" });
    await createTicket(dir, { title: "Done", status: "done" });

    const open = await listTickets(dir, { status: "open" });
    expect(open).toHaveLength(1);
    expect(open[0].title).toBe("Open");
  });

  test("listTickets filters by multiple statuses", async () => {
    await createTicket(dir, { title: "Open", status: "open" });
    await createTicket(dir, { title: "Done", status: "done" });
    await createTicket(dir, { title: "Backlog", status: "backlog" });

    const result = await listTickets(dir, { status: ["open", "done"] });
    expect(result).toHaveLength(2);
  });

  test("listTickets filters by priority", async () => {
    await createTicket(dir, { title: "High", priority: "high" });
    await createTicket(dir, { title: "Low", priority: "low" });

    const high = await listTickets(dir, { priority: "high" });
    expect(high).toHaveLength(1);
    expect(high[0].title).toBe("High");
  });

  test("listTickets filters by project", async () => {
    await createTicket(dir, { title: "P1", project: "alpha" });
    await createTicket(dir, { title: "P2", project: "beta" });

    const result = await listTickets(dir, { project: "alpha" });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("P1");
  });

  test("listTickets filters by tags", async () => {
    await createTicket(dir, { title: "Tagged", tags: ["bug", "frontend"] });
    await createTicket(dir, { title: "Other", tags: ["feature"] });

    const result = await listTickets(dir, { tags: ["bug"] });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Tagged");
  });

  test("listTickets filters by search", async () => {
    await createTicket(dir, { title: "Fix login crash" });
    await createTicket(dir, { title: "Add search feature" });

    const result = await listTickets(dir, { search: "login" });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Fix login crash");
  });

  test("getTicket returns a ticket by ID", async () => {
    const created = await createTicket(dir, { title: "Find Me" });
    const found = await getTicket(dir, created.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Find Me");
  });

  test("getTicket returns null for non-existent ID", async () => {
    const result = await getTicket(dir, "TKT-999");
    expect(result).toBeNull();
  });

  test("searchTickets finds matches in title and body", async () => {
    await createTicket(dir, {
      title: "Normal Title",
      body: "Contains special keyword here",
    });
    await createTicket(dir, { title: "Unrelated" });

    const results = await searchTickets(dir, "special keyword");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Normal Title");
  });

  test("getProjects returns unique project names", async () => {
    await createTicket(dir, { title: "A", project: "alpha" });
    await createTicket(dir, { title: "B", project: "beta" });
    await createTicket(dir, { title: "C", project: "alpha" });

    const projects = await getProjects(dir);
    expect(projects).toEqual(["alpha", "beta"]);
  });

  test("getEpics returns unique epic names", async () => {
    await createTicket(dir, { title: "A", epic: "v1" });
    await createTicket(dir, { title: "B", epic: "v2" });

    const epics = await getEpics(dir);
    expect(epics).toEqual(["v1", "v2"]);
  });

  test("getSprints returns unique sprint names", async () => {
    await createTicket(dir, { title: "A", sprint: "sprint-1" });

    const sprints = await getSprints(dir);
    expect(sprints).toEqual(["sprint-1"]);
  });

  test("getTags returns unique tag values", async () => {
    await createTicket(dir, { title: "A", tags: ["bug", "frontend"] });
    await createTicket(dir, { title: "B", tags: ["bug", "backend"] });

    const tags = await getTags(dir);
    expect(tags).toEqual(["backend", "bug", "frontend"]);
  });
});
