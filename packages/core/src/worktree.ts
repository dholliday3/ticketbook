import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { getConfig } from "./config.js";

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

async function findNearestRelayDir(startDir: string): Promise<string | null> {
  let dir = resolve(startDir);
  while (true) {
    if (await hasRelayDir(dir)) {
      return join(dir, ".relay");
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export interface RelayDirResolution {
  relayDir: string | null;
  isWorktree: boolean;
  usesMainRootRelayDir: boolean;
}

async function getWorktreeMode(dir: string): Promise<"local" | "shared"> {
  try {
    const config = await getConfig(dir);
    return config.worktreeMode;
  } catch {
    return "local";
  }
}

/**
 * Find the .relay/ directory, with worktree awareness.
 *
 * In a linked git worktree, Relay defaults to the current checkout's
 * `.relay/` so artifacts stay on the branch being edited. Projects can opt
 * back into the historical shared-artifacts behavior with
 * `worktreeMode: shared` in `.relay/config.yaml`.
 */
export async function findRelayDirWithWorktree(
  startDir: string,
): Promise<RelayDirResolution> {
  const nearestRelayDir = await findNearestRelayDir(startDir);
  const mainRoot = await resolveWorktreeRoot(startDir);

  if (!mainRoot) {
    return {
      relayDir: nearestRelayDir,
      isWorktree: false,
      usesMainRootRelayDir: false,
    };
  }

  if (nearestRelayDir) {
    const worktreeMode = await getWorktreeMode(nearestRelayDir);
    if (worktreeMode === "shared" && await hasRelayDir(mainRoot)) {
      return {
        relayDir: join(mainRoot, ".relay"),
        isWorktree: true,
        usesMainRootRelayDir: true,
      };
    }
    return {
      relayDir: nearestRelayDir,
      isWorktree: true,
      usesMainRootRelayDir: false,
    };
  }

  if (await hasRelayDir(mainRoot)) {
    return {
      relayDir: join(mainRoot, ".relay"),
      isWorktree: true,
      usesMainRootRelayDir: true,
    };
  }

  return { relayDir: null, isWorktree: true, usesMainRootRelayDir: false };
}
