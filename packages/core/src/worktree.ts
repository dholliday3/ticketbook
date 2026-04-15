import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const exec = promisify(execFile);

/**
 * Detect if the current directory is inside a git worktree (not the main
 * checkout). Returns the main repo's root if so, null otherwise.
 */
export async function resolveWorktreeRoot(
  cwd: string,
): Promise<string | null> {
  try {
    // git-common-dir returns the shared .git directory for all worktrees.
    // In the main checkout, this equals `git rev-parse --git-dir`.
    // In a linked worktree, it points to the main repo's .git.
    const { stdout: commonDir } = await exec(
      "git",
      ["rev-parse", "--git-common-dir"],
      { cwd },
    );
    const { stdout: gitDir } = await exec(
      "git",
      ["rev-parse", "--git-dir"],
      { cwd },
    );

    const resolvedCommon = resolve(cwd, commonDir.trim());
    const resolvedGitDir = resolve(cwd, gitDir.trim());

    if (resolvedCommon !== resolvedGitDir) {
      // We're in a linked worktree. The main repo root is the parent of
      // the common .git directory.
      return resolve(resolvedCommon, "..");
    }
  } catch {
    // Not in a git repo at all
  }

  return null;
}

/**
 * Check whether a directory contains a valid .relay/ directory.
 */
async function hasRelayDir(dir: string): Promise<boolean> {
  try {
    const s = await stat(join(dir, ".relay"));
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Find the .relay/ directory, with worktree awareness.
 *
 * In a linked git worktree, this checks the main repo's root first.
 * If the main repo has a .relay/ directory, we use that (artifacts are
 * shared across worktrees, not duplicated). Otherwise falls back to
 * walking up from `startDir` as usual.
 */
export async function findRelayDirWithWorktree(
  startDir: string,
): Promise<{ relayDir: string | null; isWorktree: boolean }> {
  const mainRoot = await resolveWorktreeRoot(startDir);

  if (mainRoot) {
    // We're in a linked worktree — check the main repo first
    if (await hasRelayDir(mainRoot)) {
      return {
        relayDir: join(mainRoot, ".relay"),
        isWorktree: true,
      };
    }
  }

  // Standard walk-up search (same as before, but done here for completeness)
  let dir = resolve(startDir);
  const { dirname } = await import("node:path");
  while (true) {
    if (await hasRelayDir(dir)) {
      return { relayDir: join(dir, ".relay"), isWorktree: false };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return { relayDir: null, isWorktree: false };
}
