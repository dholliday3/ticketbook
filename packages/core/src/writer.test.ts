import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import matter from "gray-matter";
import {
  createTicket,
  updateTicket,
  deleteTicket,
  restoreTicket,
  toggleSubtask,
  addSubtask,
} from "./writer.js";

describe("createTicket", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-writer-"));
    await writeFile(join(dir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("creates a ticket file with correct frontmatter", async () => {
    const ticket = await createTicket(dir, {
      title: "My First Ticket",
      status: "open",
    });

    expect(ticket.id).toBe("TKT-001");
    expect(ticket.title).toBe("My First Ticket");
    expect(ticket.status).toBe("open");
    expect(ticket.created).toBeInstanceOf(Date);
    expect(ticket.updated).toBeInstanceOf(Date);

    // Verify file exists
    const files = await readdir(dir);
    const mdFile = files.find((f) => f.endsWith(".md"));
    expect(mdFile).toBe("TKT-001-my-first-ticket.md");

    // Verify frontmatter
    const raw = await readFile(join(dir, mdFile!), "utf-8");
    const { data } = matter(raw);
    expect(data.id).toBe("TKT-001");
    expect(data.title).toBe("My First Ticket");
    expect(data.status).toBe("open");
  });

  test("omits optional fields when not set", async () => {
    await createTicket(dir, { title: "Basic Ticket" });

    const files = await readdir(dir);
    const mdFile = files.find((f) => f.endsWith(".md"))!;
    const raw = await readFile(join(dir, mdFile), "utf-8");
    const { data } = matter(raw);

    expect(data.priority).toBeUndefined();
    expect(data.project).toBeUndefined();
    expect(data.epic).toBeUndefined();
    expect(data.sprint).toBeUndefined();
    expect(data.tags).toBeUndefined();
    expect(data.order).toBeUndefined();
  });

  test("normalizes tags on write", async () => {
    const ticket = await createTicket(dir, {
      title: "Tagged",
      tags: ["  Bug  ", "BUG", "feature"],
    });
    expect(ticket.tags).toEqual(["bug", "feature"]);
  });

  test("includes body content", async () => {
    const ticket = await createTicket(dir, {
      title: "With Body",
      body: "Some description here",
    });
    expect(ticket.body).toBe("Some description here");
  });

  test("increments counter for each ticket", async () => {
    const t1 = await createTicket(dir, { title: "First" });
    const t2 = await createTicket(dir, { title: "Second" });
    expect(t1.id).toBe("TKT-001");
    expect(t2.id).toBe("TKT-002");
  });
});

describe("updateTicket", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-writer-"));
    await writeFile(join(dir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("updates frontmatter fields", async () => {
    const ticket = await createTicket(dir, { title: "Original" });
    const updated = await updateTicket(dir, ticket.id, {
      status: "in-progress",
      priority: "high",
    });

    expect(updated.status).toBe("in-progress");
    expect(updated.priority).toBe("high");
    expect(updated.updated.getTime()).toBeGreaterThanOrEqual(
      ticket.updated.getTime(),
    );
  });

  test("clears optional fields when set to null", async () => {
    const ticket = await createTicket(dir, {
      title: "WithPriority",
      priority: "high",
      project: "myproject",
    });
    const updated = await updateTicket(dir, ticket.id, {
      priority: null,
      project: null,
    });
    expect(updated.priority).toBeUndefined();
    expect(updated.project).toBeUndefined();

    // Verify in file
    const raw = await readFile(updated.filePath, "utf-8");
    const { data } = matter(raw);
    expect(data.priority).toBeUndefined();
    expect(data.project).toBeUndefined();
  });

  test("updates body content", async () => {
    const ticket = await createTicket(dir, {
      title: "Body Test",
      body: "Original body",
    });
    const updated = await updateTicket(dir, ticket.id, {
      body: "Updated body",
    });
    expect(updated.body).toBe("Updated body");
  });

  test("throws for non-existent ticket", async () => {
    expect(updateTicket(dir, "TKT-999", { title: "Nope" })).rejects.toThrow(
      "Ticket not found",
    );
  });
});

describe("deleteTicket", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-writer-"));
    await writeFile(join(dir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("archives ticket by default", async () => {
    const ticket = await createTicket(dir, { title: "To Archive" });
    await deleteTicket(dir, ticket.id);

    // Main directory should not have the file
    const mainFiles = await readdir(dir);
    expect(mainFiles.filter((f) => f.endsWith(".md"))).toHaveLength(0);

    // Archive should have it
    const archiveFiles = await readdir(join(dir, ".archive"));
    expect(archiveFiles.filter((f) => f.endsWith(".md"))).toHaveLength(1);
  });

  test("hard-deletes when config says so", async () => {
    await writeFile(
      join(dir, ".config.yaml"),
      "prefix: TKT\ndeleteMode: hard\n",
      "utf-8",
    );
    const ticket = await createTicket(dir, { title: "To Delete" });
    await deleteTicket(dir, ticket.id);

    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith(".md"))).toHaveLength(0);
  });
});

describe("restoreTicket", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-writer-"));
    await writeFile(join(dir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("restores an archived ticket", async () => {
    const ticket = await createTicket(dir, { title: "Archived" });
    await deleteTicket(dir, ticket.id);

    const restored = await restoreTicket(dir, ticket.id);
    expect(restored.id).toBe(ticket.id);
    expect(restored.title).toBe("Archived");

    const mainFiles = await readdir(dir);
    expect(mainFiles.filter((f) => f.endsWith(".md"))).toHaveLength(1);
  });

  test("throws when ticket is not in archive", () => {
    expect(restoreTicket(dir, "TKT-999")).rejects.toThrow("not found");
  });
});

describe("toggleSubtask", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-writer-"));
    await writeFile(join(dir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("toggles a checkbox from unchecked to checked", async () => {
    const ticket = await createTicket(dir, {
      title: "Tasks",
      body: "## Tasks\n\n- [ ] First task\n- [ ] Second task",
    });

    const updated = await toggleSubtask(dir, ticket.id, 0);
    expect(updated.body).toContain("- [x] First task");
    expect(updated.body).toContain("- [ ] Second task");
  });

  test("toggles a checkbox from checked to unchecked", async () => {
    const ticket = await createTicket(dir, {
      title: "Tasks",
      body: "- [x] Done task",
    });

    const updated = await toggleSubtask(dir, ticket.id, 0);
    expect(updated.body).toContain("- [ ] Done task");
  });

  test("throws for invalid index", async () => {
    const ticket = await createTicket(dir, {
      title: "Tasks",
      body: "- [ ] Only one",
    });

    expect(toggleSubtask(dir, ticket.id, 5)).rejects.toThrow("not found");
  });
});

describe("addSubtask", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-writer-"));
    await writeFile(join(dir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("creates Tasks section if missing", async () => {
    const ticket = await createTicket(dir, {
      title: "No Tasks",
      body: "Some description",
    });

    const updated = await addSubtask(dir, ticket.id, "New task");
    expect(updated.body).toContain("## Tasks");
    expect(updated.body).toContain("- [ ] New task");
  });

  test("appends to existing Tasks section", async () => {
    const ticket = await createTicket(dir, {
      title: "Has Tasks",
      body: "## Tasks\n\n- [ ] Existing task",
    });

    const updated = await addSubtask(dir, ticket.id, "Another task");
    expect(updated.body).toContain("- [ ] Existing task");
    expect(updated.body).toContain("- [ ] Another task");
  });
});
