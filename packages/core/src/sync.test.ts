import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import matter from "gray-matter";
import { sync } from "./sync.js";

const exec = promisify(execFile);

async function initGitRepo(dir: string): Promise<void> {
  await exec("git", ["init"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test User"], { cwd: dir });
}

function taskContent(id: string): string {
  return matter.stringify("", {
    id,
    title: `Task ${id}`,
    status: "open",
    created: new Date("2024-01-01"),
    updated: new Date("2024-01-01"),
  });
}

describe("sync", () => {
  let dir: string;
  let tasksDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-sync-"));
    tasksDir = join(dir, ".tasks");
    await mkdir(tasksDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("returns no-op result when not in a git repo", async () => {
    await writeFile(join(tasksDir, "TKT-001-foo.md"), taskContent("TKT-001"));
    await writeFile(join(tasksDir, ".counter"), "1", "utf-8");

    const result = await sync({ tasksDir, projectRoot: dir });
    expect(result.committed).toHaveLength(0);
    expect(result.message).toBeNull();
    expect(result.pushed).toBe(false);
  });

  test("dry run: returns files and message without committing", async () => {
    await initGitRepo(dir);
    // Commit an initial state so .tasks/ is tracked
    await writeFile(join(tasksDir, ".counter"), "0", "utf-8");
    await exec("git", ["add", ".tasks/"], { cwd: dir });
    await exec("git", ["commit", "-m", "init"], { cwd: dir });

    // Add a new task file (will show as untracked)
    await writeFile(join(tasksDir, "TKT-001-my-task.md"), taskContent("TKT-001"));
    await writeFile(join(tasksDir, ".counter"), "1", "utf-8");

    const result = await sync({ tasksDir, projectRoot: dir, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.message).not.toBeNull();
    expect(result.committed.length).toBeGreaterThan(0);
  });

  test("dry run: commit message includes task IDs", async () => {
    await initGitRepo(dir);
    await writeFile(join(tasksDir, ".counter"), "0", "utf-8");
    await exec("git", ["add", ".tasks/"], { cwd: dir });
    await exec("git", ["commit", "-m", "init"], { cwd: dir });

    await writeFile(join(tasksDir, "TKT-001-my-task.md"), taskContent("TKT-001"));
    await writeFile(join(tasksDir, "TKT-002-other.md"), taskContent("TKT-002"));

    const result = await sync({ tasksDir, projectRoot: dir, dryRun: true });

    expect(result.message).toMatch(/TKT-001/);
    expect(result.message).toMatch(/TKT-002/);
    // Message format: "ticketbook: sync <ids> [YYYY-MM-DD]"
    expect(result.message).toMatch(/^ticketbook: sync .+ \[\d{4}-\d{2}-\d{2}\]$/);
  });

  test("dry run: does not create a commit", async () => {
    await initGitRepo(dir);
    await writeFile(join(tasksDir, ".counter"), "0", "utf-8");
    await exec("git", ["add", ".tasks/"], { cwd: dir });
    await exec("git", ["commit", "-m", "init"], { cwd: dir });

    await writeFile(join(tasksDir, "TKT-001-foo.md"), taskContent("TKT-001"));

    const { stdout: before } = await exec("git", ["log", "--oneline"], { cwd: dir });
    await sync({ tasksDir, projectRoot: dir, dryRun: true });
    const { stdout: after } = await exec("git", ["log", "--oneline"], { cwd: dir });

    expect(after.trim()).toBe(before.trim());
  });
});
