import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, stat, mkdir, chmod } from "node:fs/promises";
import { join, resolve, relative } from "node:path";

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitSetupResult {
  registeredMergeDriver: boolean;
  installedPostMergeHook: boolean;
  updatedGitattributes: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function gitConfig(
  cwd: string,
  key: string,
): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["config", "--local", key], { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function gitConfigSet(
  cwd: string,
  key: string,
  value: string,
): Promise<void> {
  await exec("git", ["config", "--local", key, value], { cwd });
}

/**
 * Find the .git directory for installing hooks.
 * Handles both regular repos (.git is a directory) and worktrees (.git is a file).
 */
async function findGitDir(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["rev-parse", "--git-dir"], { cwd });
    return resolve(cwd, stdout.trim());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Merge driver registration
// ---------------------------------------------------------------------------

/**
 * Register the ticketbook merge driver in local git config.
 *
 * This sets:
 *   merge.ticketbook.name = "Ticketbook frontmatter-aware merge"
 *   merge.ticketbook.driver = "bun <path>/merge-driver.ts %O %A %B"
 *
 * The driver path is resolved relative to the project root so it works
 * from any subdirectory or worktree.
 */
async function registerMergeDriver(
  projectRoot: string,
  mergeDriverPath: string,
): Promise<boolean> {
  const existing = await gitConfig(projectRoot, "merge.ticketbook.driver");

  // Use a relative path from project root so the config is portable
  // across machines (anyone who clones gets the script)
  const relPath = relative(projectRoot, mergeDriverPath);
  const driverCmd = `bun ${relPath} %O %A %B`;

  if (existing === driverCmd) {
    return false; // Already configured correctly
  }

  await gitConfigSet(
    projectRoot,
    "merge.ticketbook.name",
    "Ticketbook frontmatter-aware merge",
  );
  await gitConfigSet(projectRoot, "merge.ticketbook.driver", driverCmd);

  return true;
}

// ---------------------------------------------------------------------------
// Post-merge hook
// ---------------------------------------------------------------------------

const POST_MERGE_MARKER = "# ticketbook:post-merge";

const POST_MERGE_SNIPPET = `
${POST_MERGE_MARKER}
# Auto-reconcile ticketbook counters after merge
if command -v bun >/dev/null 2>&1; then
  bun -e "
    import { runDoctor } from './packages/core/src/doctor.ts';
    const r = await runDoctor({
      tasksDir: '.tasks',
      plansDir: '.plans',
      docsDir: '.docs',
      projectRoot: '.',
      fix: true,
    });
    if (r.fixed > 0) console.log('ticketbook: auto-fixed ' + r.fixed + ' issue(s) after merge');
  " 2>/dev/null || true
fi
`;

/**
 * Install (or append to) a post-merge hook that runs doctor --fix.
 */
async function installPostMergeHook(
  projectRoot: string,
): Promise<boolean> {
  const gitDir = await findGitDir(projectRoot);
  if (!gitDir) return false;

  const hooksDir = join(gitDir, "hooks");
  await mkdir(hooksDir, { recursive: true });

  const hookPath = join(hooksDir, "post-merge");
  let content = "";

  if (await pathExists(hookPath)) {
    content = await readFile(hookPath, "utf-8");
    if (content.includes(POST_MERGE_MARKER)) {
      return false; // Already installed
    }
    // Append to existing hook
    content = content.trimEnd() + "\n" + POST_MERGE_SNIPPET;
  } else {
    content = "#!/bin/sh\n" + POST_MERGE_SNIPPET;
  }

  await writeFile(hookPath, content, "utf-8");
  await chmod(hookPath, 0o755);
  return true;
}

// ---------------------------------------------------------------------------
// .gitattributes update
// ---------------------------------------------------------------------------

const ARTIFACT_GITATTRIBUTES_LINES = [
  "# Ticketbook: custom merge driver for artifact files",
  ".tasks/*.md merge=ticketbook",
  ".plans/*.md merge=ticketbook",
  ".docs/*.md merge=ticketbook",
];

/**
 * Ensure .gitattributes has the merge driver entries for artifact files.
 */
async function updateGitattributes(
  projectRoot: string,
): Promise<boolean> {
  const gaPath = join(projectRoot, ".gitattributes");
  let content = "";

  try {
    content = await readFile(gaPath, "utf-8");
  } catch {
    // File doesn't exist yet
  }

  const missing: string[] = [];
  for (const line of ARTIFACT_GITATTRIBUTES_LINES) {
    if (!content.includes(line)) {
      missing.push(line);
    }
  }

  if (missing.length === 0) return false;

  const addition = "\n" + missing.join("\n") + "\n";
  await writeFile(gaPath, content.trimEnd() + addition, "utf-8");
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Set up git integration for ticketbook in a project:
 *   1. Register the custom merge driver in local .git/config
 *   2. Install a post-merge hook that runs doctor --fix
 *   3. Update .gitattributes with merge driver entries
 *
 * All operations are idempotent — safe to call multiple times.
 * Call this from `ticketbook init` or `ticketbook serve` on first run.
 */
export async function setupGitIntegration(
  projectRoot: string,
  mergeDriverPath: string,
): Promise<GitSetupResult> {
  const registeredMergeDriver = await registerMergeDriver(
    projectRoot,
    mergeDriverPath,
  );
  const installedPostMergeHook = await installPostMergeHook(projectRoot);
  const updatedGitattributes = await updateGitattributes(projectRoot);

  return {
    registeredMergeDriver,
    installedPostMergeHook,
    updatedGitattributes,
  };
}
