import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import matter from "gray-matter";
import {
  createPlan,
  updatePlan,
  deletePlan,
  restorePlan,
  cutTasksFromPlan,
} from "./plan-writer.js";
import { listTasks } from "./reader.js";

describe("createPlan", () => {
  let rootDir: string;
  let plansDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "relay-plan-writer-"));
    plansDir = join(rootDir, "plans");
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("creates a plan file with correct frontmatter", async () => {
    const plan = await createPlan(rootDir, plansDir, {
      title: "My First Plan",
      status: "draft",
    });

    expect(plan.id).toBe("PLAN-001");
    expect(plan.title).toBe("My First Plan");
    expect(plan.status).toBe("draft");
    expect(plan.created).toBeInstanceOf(Date);
    expect(plan.updated).toBeInstanceOf(Date);

    const files = await readdir(plansDir);
    const mdFile = files.find((f) => f.endsWith(".md"));
    expect(mdFile).toBe("PLAN-001-my-first-plan.md");

    const raw = await readFile(join(plansDir, mdFile!), "utf-8");
    const { data } = matter(raw);
    expect(data.id).toBe("PLAN-001");
    expect(data.title).toBe("My First Plan");
    expect(data.status).toBe("draft");
  });

  test("defaults status to draft", async () => {
    const plan = await createPlan(rootDir, plansDir, { title: "No Status" });
    expect(plan.status).toBe("draft");
  });

  test("omits optional fields when not set", async () => {
    await createPlan(rootDir, plansDir, { title: "Basic Plan" });

    const files = await readdir(plansDir);
    const mdFile = files.find((f) => f.endsWith(".md"))!;
    const raw = await readFile(join(plansDir, mdFile), "utf-8");
    const { data } = matter(raw);

    expect(data.project).toBeUndefined();
    expect(data.tags).toBeUndefined();
    expect(data.tasks).toBeUndefined();
    expect(data.refs).toBeUndefined();
  });

  test("normalizes tags on write", async () => {
    const plan = await createPlan(rootDir, plansDir, {
      title: "Tagged",
      tags: ["  Feature  ", "FEATURE", "ui"],
    });
    expect(plan.tags).toEqual(["feature", "ui"]);
  });

  test("includes body content", async () => {
    const plan = await createPlan(rootDir, plansDir, {
      title: "With Body",
      body: "## Overview\n\nSome plan content",
    });
    expect(plan.body).toBe("## Overview\n\nSome plan content");
  });

  test("increments counter for each plan", async () => {
    const p1 = await createPlan(rootDir, plansDir, { title: "First" });
    const p2 = await createPlan(rootDir, plansDir, { title: "Second" });
    expect(p1.id).toBe("PLAN-001");
    expect(p2.id).toBe("PLAN-002");
  });

  test("stores linked task IDs", async () => {
    const plan = await createPlan(rootDir, plansDir, {
      title: "Linked",
      tasks: ["TASK-001", "TASK-002"],
    });
    expect(plan.tasks).toEqual(["TASK-001", "TASK-002"]);

    const files = await readdir(plansDir);
    const mdFile = files.find((f) => f.endsWith(".md"))!;
    const raw = await readFile(join(plansDir, mdFile), "utf-8");
    const { data } = matter(raw);
    expect(data.tasks).toEqual(["TASK-001", "TASK-002"]);
  });

  test("uses custom prefix from config", async () => {
    await writeFile(
      join(rootDir, "config.yaml"),
      "prefix: TKT\nplanPrefix: PRD\n",
      "utf-8",
    );
    const plan = await createPlan(rootDir, plansDir, { title: "Custom Prefix" });
    expect(plan.id).toBe("PRD-001");
  });
});

describe("updatePlan", () => {
  let rootDir: string;
  let plansDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "relay-plan-writer-"));
    plansDir = join(rootDir, "plans");
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("updates frontmatter fields", async () => {
    const plan = await createPlan(rootDir, plansDir, { title: "Original" });
    const updated = await updatePlan(plansDir, plan.id, {
      status: "active",
      project: "myproject",
    });

    expect(updated.status).toBe("active");
    expect(updated.project).toBe("myproject");
    expect(updated.updated.getTime()).toBeGreaterThanOrEqual(
      plan.updated.getTime(),
    );
  });

  test("clears optional fields when set to null", async () => {
    const plan = await createPlan(rootDir, plansDir, {
      title: "WithProject",
      project: "myproject",
    });
    const updated = await updatePlan(plansDir, plan.id, { project: null });
    expect(updated.project).toBeUndefined();
  });

  test("updates body content", async () => {
    const plan = await createPlan(rootDir, plansDir, {
      title: "Body Test",
      body: "Original body",
    });
    const updated = await updatePlan(plansDir, plan.id, {
      body: "Updated body",
    });
    expect(updated.body).toBe("Updated body");
  });

  test("updates linked tasks", async () => {
    const plan = await createPlan(rootDir, plansDir, { title: "Links" });
    const updated = await updatePlan(plansDir, plan.id, {
      tasks: ["TASK-001", "TASK-003"],
    });
    expect(updated.tasks).toEqual(["TASK-001", "TASK-003"]);
  });

  test("throws for non-existent plan", async () => {
    expect(updatePlan(plansDir, "PLAN-999", { title: "Nope" })).rejects.toThrow(
      "Plan not found",
    );
  });
});

describe("deletePlan", () => {
  let rootDir: string;
  let plansDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "relay-plan-writer-"));
    plansDir = join(rootDir, "plans");
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("archives plan by default", async () => {
    const plan = await createPlan(rootDir, plansDir, { title: "To Archive" });
    await deletePlan(rootDir, plansDir, plan.id);

    const mainFiles = await readdir(plansDir);
    expect(mainFiles.filter((f) => f.endsWith(".md"))).toHaveLength(0);

    const archiveFiles = await readdir(join(plansDir, ".archive"));
    expect(archiveFiles.filter((f) => f.endsWith(".md"))).toHaveLength(1);
  });

  test("hard-deletes when config says so", async () => {
    await writeFile(
      join(rootDir, "config.yaml"),
      "prefix: TKT\nplanPrefix: PLAN\ndeleteMode: hard\n",
      "utf-8",
    );
    const plan = await createPlan(rootDir, plansDir, { title: "To Delete" });
    await deletePlan(rootDir, plansDir, plan.id);

    const files = await readdir(plansDir);
    expect(files.filter((f) => f.endsWith(".md"))).toHaveLength(0);
  });
});

describe("restorePlan", () => {
  let rootDir: string;
  let plansDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "relay-plan-writer-"));
    plansDir = join(rootDir, "plans");
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("restores an archived plan", async () => {
    const plan = await createPlan(rootDir, plansDir, { title: "Archived" });
    await deletePlan(rootDir, plansDir, plan.id);

    const restored = await restorePlan(plansDir, plan.id);
    expect(restored.id).toBe(plan.id);
    expect(restored.title).toBe("Archived");

    const mainFiles = await readdir(plansDir);
    expect(mainFiles.filter((f) => f.endsWith(".md"))).toHaveLength(1);
  });

  test("throws when plan is not in archive", () => {
    expect(restorePlan(plansDir, "PLAN-999")).rejects.toThrow("not found");
  });
});

describe("cutTasksFromPlan", () => {
  let rootDir: string;
  let tasksDir: string;
  let plansDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "relay-plan-writer-"));
    tasksDir = join(rootDir, "tasks");
    plansDir = join(rootDir, "plans");
    await mkdir(tasksDir, { recursive: true });
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, ".counter"), "0", "utf-8");
    await writeFile(join(tasksDir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("creates tasks from unchecked checkboxes", async () => {
    const plan = await createPlan(rootDir, plansDir, {
      title: "Feature Plan",
      body: "## Tasks\n\n- [ ] Build API endpoint\n- [ ] Add tests\n- [x] Already done",
      project: "myproject",
    });

    const result = await cutTasksFromPlan(rootDir, plansDir, plan.id);

    expect(result.createdTasks).toHaveLength(2);
    expect(result.createdTasks[0].title).toBe("Build API endpoint");
    expect(result.createdTasks[1].title).toBe("Add tests");
    expect(result.createdTasks[0].status).toBe("open");
    expect(result.createdTasks[0].project).toBe("myproject");

    // Plan body should have items checked off with task IDs
    expect(result.plan.body).toContain("[x] Build API endpoint (TASK-001)");
    expect(result.plan.body).toContain("[x] Add tests (TASK-002)");
    expect(result.plan.body).toContain("[x] Already done");

    // Plan should have linked tasks
    expect(result.plan.tasks).toContain("TASK-001");
    expect(result.plan.tasks).toContain("TASK-002");

    // Tasks should exist on disk
    const tasks = await listTasks(tasksDir);
    expect(tasks).toHaveLength(2);
  });

  test("returns empty array when no unchecked items", async () => {
    const plan = await createPlan(rootDir, plansDir, {
      title: "All Done",
      body: "- [x] Already done\n- [x] Also done",
    });

    const result = await cutTasksFromPlan(rootDir, plansDir, plan.id);
    expect(result.createdTasks).toHaveLength(0);
  });

  test("preserves existing linked tasks", async () => {
    const plan = await createPlan(rootDir, plansDir, {
      title: "Existing Links",
      tasks: ["EXISTING-001"],
      body: "- [ ] New task",
    });

    const result = await cutTasksFromPlan(rootDir, plansDir, plan.id);
    expect(result.plan.tasks).toContain("EXISTING-001");
    expect(result.plan.tasks).toContain("TASK-001");
  });
});
