import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findRelayDirWithWorktree } from "./worktree.js";

const exec = promisify(execFile);

async function initGitRepo(dir: string): Promise<void> {
  await exec("git", ["init"], { cwd: dir });
  await exec("git", ["branch", "-M", "main"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test User"], { cwd: dir });
}

async function commitRelayConfig(
  dir: string,
  configYaml: string,
): Promise<void> {
  await mkdir(join(dir, ".relay"), { recursive: true });
  await writeFile(join(dir, ".relay", "config.yaml"), configYaml, "utf-8");
  await exec("git", ["add", ".relay/config.yaml"], { cwd: dir });
  await exec("git", ["commit", "-m", "init relay"], { cwd: dir });
}

describe("findRelayDirWithWorktree", () => {
  let repoDir: string;
  let worktreeDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "relay-worktree-main-"));
    worktreeDir = await mkdtemp(join(tmpdir(), "relay-worktree-branch-"));
    await rm(worktreeDir, { recursive: true, force: true });
    await initGitRepo(repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(worktreeDir, { recursive: true, force: true });
  });

  test("prefers the current worktree relay dir by default", async () => {
    await commitRelayConfig(
      repoDir,
      "prefix: TASK\ndeleteMode: archive\nworktreeMode: local\n",
    );
    await exec("git", ["worktree", "add", "-b", "feature/local", worktreeDir], {
      cwd: repoDir,
    });

    const result = await findRelayDirWithWorktree(worktreeDir);

    expect(result.isWorktree).toBe(true);
    expect(result.usesMainRootRelayDir).toBe(false);
    expect(await realpath(result.relayDir!)).toBe(await realpath(join(worktreeDir, ".relay")));
  });

  test("can opt into shared artifacts from the main checkout", async () => {
    await commitRelayConfig(
      repoDir,
      "prefix: TASK\ndeleteMode: archive\nworktreeMode: shared\n",
    );
    await exec("git", ["worktree", "add", "-b", "feature/shared", worktreeDir], {
      cwd: repoDir,
    });

    const result = await findRelayDirWithWorktree(worktreeDir);

    expect(result.isWorktree).toBe(true);
    expect(result.usesMainRootRelayDir).toBe(true);
    expect(await realpath(result.relayDir!)).toBe(await realpath(join(repoDir, ".relay")));
  });
});
