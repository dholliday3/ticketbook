import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  listPlans,
  getPlan,
  searchPlans,
  getPlanProjects,
  getPlanTags,
} from "./plan-reader.js";
import { createPlan } from "./plan-writer.js";

describe("plan-reader", () => {
  let tasksDir: string;
  let plansDir: string;

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-plan-reader-"));
    tasksDir = join(root, ".tasks");
    plansDir = join(root, ".plans");
    await mkdir(tasksDir, { recursive: true });
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(tasksDir, { recursive: true, force: true });
    await rm(plansDir, { recursive: true, force: true });
  });

  test("listPlans returns empty array for empty directory", async () => {
    const plans = await listPlans(plansDir);
    expect(plans).toEqual([]);
  });

  test("listPlans returns empty array for non-existent directory", async () => {
    const plans = await listPlans(join(plansDir, "nonexistent"));
    expect(plans).toEqual([]);
  });

  test("listPlans finds created plans", async () => {
    await createPlan(tasksDir, plansDir, { title: "First Plan" });
    await createPlan(tasksDir, plansDir, { title: "Second Plan" });

    const plans = await listPlans(plansDir);
    expect(plans).toHaveLength(2);
  });

  test("listPlans ignores .counter and .archive", async () => {
    await createPlan(tasksDir, plansDir, { title: "Test" });

    const archiveDir = join(plansDir, ".archive");
    await mkdir(archiveDir, { recursive: true });
    await writeFile(
      join(archiveDir, "PLAN-099-old.md"),
      "---\nid: PLAN-099\ntitle: Old\nstatus: archived\ncreated: 2024-01-01\nupdated: 2024-01-01\n---\n",
      "utf-8",
    );

    const plans = await listPlans(plansDir);
    expect(plans).toHaveLength(1);
  });

  test("listPlans filters by status", async () => {
    await createPlan(tasksDir, plansDir, { title: "Draft", status: "draft" });
    await createPlan(tasksDir, plansDir, { title: "Active", status: "active" });

    const drafts = await listPlans(plansDir, { status: "draft" });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe("Draft");
  });

  test("listPlans filters by project", async () => {
    await createPlan(tasksDir, plansDir, { title: "P1", project: "alpha" });
    await createPlan(tasksDir, plansDir, { title: "P2", project: "beta" });

    const result = await listPlans(plansDir, { project: "alpha" });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("P1");
  });

  test("listPlans filters by tags", async () => {
    await createPlan(tasksDir, plansDir, { title: "Tagged", tags: ["feature", "ui"] });
    await createPlan(tasksDir, plansDir, { title: "Other", tags: ["infra"] });

    const result = await listPlans(plansDir, { tags: ["feature"] });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Tagged");
  });

  test("listPlans filters by search", async () => {
    await createPlan(tasksDir, plansDir, { title: "Agent Collaboration" });
    await createPlan(tasksDir, plansDir, { title: "Q2 Roadmap" });

    const result = await listPlans(plansDir, { search: "agent" });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Agent Collaboration");
  });

  test("getPlan returns a plan by ID", async () => {
    const created = await createPlan(tasksDir, plansDir, { title: "Find Me" });
    const found = await getPlan(plansDir, created.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Find Me");
  });

  test("getPlan returns null for non-existent ID", async () => {
    const result = await getPlan(plansDir, "PLAN-999");
    expect(result).toBeNull();
  });

  test("searchPlans finds matches in title and body", async () => {
    await createPlan(tasksDir, plansDir, {
      title: "Normal Plan",
      body: "Contains special keyword here",
    });
    await createPlan(tasksDir, plansDir, { title: "Unrelated" });

    const results = await searchPlans(plansDir, "special keyword");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Normal Plan");
  });

  test("getPlanProjects returns unique project names", async () => {
    await createPlan(tasksDir, plansDir, { title: "A", project: "alpha" });
    await createPlan(tasksDir, plansDir, { title: "B", project: "beta" });
    await createPlan(tasksDir, plansDir, { title: "C", project: "alpha" });

    const projects = await getPlanProjects(plansDir);
    expect(projects).toEqual(["alpha", "beta"]);
  });

  test("getPlanTags returns unique tag values", async () => {
    await createPlan(tasksDir, plansDir, { title: "A", tags: ["feature", "ui"] });
    await createPlan(tasksDir, plansDir, { title: "B", tags: ["feature", "api"] });

    const tags = await getPlanTags(plansDir);
    expect(tags).toEqual(["api", "feature", "ui"]);
  });
});
