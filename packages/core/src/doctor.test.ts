import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, mkdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import matter from "gray-matter";
import { runDoctor } from "./doctor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function taskFile(id: string, extra: Record<string, unknown> = {}): string {
  return matter.stringify("", {
    id,
    title: `Task ${id}`,
    status: "open",
    created: new Date("2024-01-01"),
    updated: new Date("2024-01-01"),
    ...extra,
  });
}

async function setupTasksDir(baseDir: string): Promise<string> {
  const tasksDir = join(baseDir, ".tasks");
  await mkdir(tasksDir, { recursive: true });
  return tasksDir;
}

// ---------------------------------------------------------------------------
// Counter checks
// ---------------------------------------------------------------------------

describe("doctor — counter", () => {
  let dir: string;
  let tasksDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-doctor-"));
    tasksDir = await setupTasksDir(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("reports pass when counter matches highest ID", async () => {
    await writeFile(join(tasksDir, "TKT-003-foo.md"), taskFile("TKT-003"));
    await writeFile(join(tasksDir, ".counter"), "3", "utf-8");

    const result = await runDoctor({ tasksDir });
    const counterItems = result.items.filter((i) => i.check.includes("counter"));
    expect(counterItems.some((i) => i.severity === "pass")).toBe(true);
    expect(counterItems.every((i) => i.severity !== "fail")).toBe(true);
  });

  test("reports fail when counter is behind highest ID", async () => {
    await writeFile(join(tasksDir, "TKT-007-foo.md"), taskFile("TKT-007"));
    await writeFile(join(tasksDir, ".counter"), "3", "utf-8");

    const result = await runDoctor({ tasksDir });
    const fail = result.items.find(
      (i) => i.check.includes("counter") && i.severity === "fail",
    );
    expect(fail).toBeDefined();
    expect(fail!.message).toContain("7");
  });

  test("fix: advances counter to match highest ID", async () => {
    await writeFile(join(tasksDir, "TKT-007-foo.md"), taskFile("TKT-007"));
    await writeFile(join(tasksDir, ".counter"), "3", "utf-8");

    const result = await runDoctor({ tasksDir, fix: true });
    expect(result.fixed).toBeGreaterThan(0);

    const counter = await readFile(join(tasksDir, ".counter"), "utf-8");
    expect(counter).toBe("7");
  });

  test("fix: does not reduce a counter that is ahead", async () => {
    await writeFile(join(tasksDir, "TKT-003-foo.md"), taskFile("TKT-003"));
    await writeFile(join(tasksDir, ".counter"), "10", "utf-8");

    await runDoctor({ tasksDir, fix: true });

    const counter = await readFile(join(tasksDir, ".counter"), "utf-8");
    expect(counter).toBe("10");
  });
});

// ---------------------------------------------------------------------------
// Duplicate ID detection
// ---------------------------------------------------------------------------

describe("doctor — duplicate IDs", () => {
  let dir: string;
  let tasksDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-doctor-"));
    tasksDir = await setupTasksDir(dir);
    await writeFile(join(tasksDir, ".counter"), "2", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("reports fail for two files with the same ID", async () => {
    await writeFile(join(tasksDir, "TKT-001-a.md"), taskFile("TKT-001"));
    await writeFile(join(tasksDir, "TKT-001-b.md"), taskFile("TKT-001"));

    const result = await runDoctor({ tasksDir });
    const dup = result.items.find(
      (i) => i.check.includes("duplicate") && i.severity === "fail",
    );
    expect(dup).toBeDefined();
    expect(dup!.message).toContain("TKT-001");
  });

  test("reports pass when all IDs are unique", async () => {
    await writeFile(join(tasksDir, "TKT-001-foo.md"), taskFile("TKT-001"));
    await writeFile(join(tasksDir, "TKT-002-bar.md"), taskFile("TKT-002"));

    const result = await runDoctor({ tasksDir });
    const dupItems = result.items.filter((i) => i.check.includes("duplicate"));
    expect(dupItems.every((i) => i.severity !== "fail")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dangling reference detection
// ---------------------------------------------------------------------------

describe("doctor — dangling refs", () => {
  let dir: string;
  let tasksDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-doctor-"));
    tasksDir = await setupTasksDir(dir);
    await writeFile(join(tasksDir, ".counter"), "1", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("warns on blockedBy referencing a non-existent task", async () => {
    await writeFile(
      join(tasksDir, "TKT-001-foo.md"),
      taskFile("TKT-001", { blockedBy: ["TKT-999"] }),
    );

    const result = await runDoctor({ tasksDir });
    const dangling = result.items.find(
      (i) => i.check.includes("dangling-ref") && i.severity === "warn",
    );
    expect(dangling).toBeDefined();
    expect(dangling!.message).toContain("TKT-999");
  });

  test("no dangling-ref warning when blockedBy target exists", async () => {
    await writeFile(join(tasksDir, "TKT-001-foo.md"), taskFile("TKT-001", { blockedBy: ["TKT-002"] }));
    await writeFile(join(tasksDir, "TKT-002-bar.md"), taskFile("TKT-002"));
    await writeFile(join(tasksDir, ".counter"), "2", "utf-8");

    const result = await runDoctor({ tasksDir });
    const dangling = result.items.find((i) => i.check.includes("dangling-ref"));
    expect(dangling).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Stale lock detection
// ---------------------------------------------------------------------------

describe("doctor — stale locks", () => {
  let dir: string;
  let tasksDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-doctor-"));
    tasksDir = await setupTasksDir(dir);
    await writeFile(join(tasksDir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("warns on lock files older than 30s", async () => {
    const lockPath = join(tasksDir, "resource.lock");
    await writeFile(lockPath, "", "utf-8");
    // Backdate mtime by 60 seconds
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleTime, staleTime);

    const result = await runDoctor({ tasksDir });
    const stale = result.items.find(
      (i) => i.check.includes("stale-lock") && i.severity === "warn",
    );
    expect(stale).toBeDefined();
  });

  test("fix: removes stale lock files", async () => {
    const lockPath = join(tasksDir, "resource.lock");
    await writeFile(lockPath, "", "utf-8");
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleTime, staleTime);

    const result = await runDoctor({ tasksDir, fix: true });
    expect(result.fixed).toBeGreaterThan(0);

    const { stat } = await import("node:fs/promises");
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

// ---------------------------------------------------------------------------
// .gitattributes check
// ---------------------------------------------------------------------------

describe("doctor — .gitattributes", () => {
  let dir: string;
  let tasksDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-doctor-"));
    tasksDir = await setupTasksDir(dir);
    await writeFile(join(tasksDir, ".counter"), "0", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("reports fail when merge=ours lines are missing", async () => {
    const result = await runDoctor({ tasksDir, projectRoot: dir });
    const ga = result.items.find((i) => i.check === "gitattributes" && i.severity === "fail");
    expect(ga).toBeDefined();
  });

  test("fix: adds missing merge=ours lines to .gitattributes", async () => {
    await runDoctor({ tasksDir, projectRoot: dir, fix: true });

    const content = await readFile(join(dir, ".gitattributes"), "utf-8");
    expect(content).toContain(".tasks/.counter merge=ours");
    expect(content).toContain(".plans/.counter merge=ours");
    expect(content).toContain(".docs/.counter merge=ours");
  });

  test("reports pass when all lines already present", async () => {
    await writeFile(
      join(dir, ".gitattributes"),
      ".tasks/.counter merge=ours\n.plans/.counter merge=ours\n.docs/.counter merge=ours\n",
      "utf-8",
    );

    const result = await runDoctor({ tasksDir, projectRoot: dir });
    const ga = result.items.find((i) => i.check === "gitattributes");
    expect(ga?.severity).toBe("pass");
  });
});
