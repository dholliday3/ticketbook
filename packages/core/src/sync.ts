import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extname, relative } from "node:path";

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncOptions {
  tasksDir: string;
  plansDir?: string;
  docsDir?: string;
  /** Project root (parent of .tasks/). Used as git cwd. */
  projectRoot: string;
  /** If true, only report what would be committed. */
  dryRun?: boolean;
  /** If true, push after committing. */
  push?: boolean;
}

export interface SyncResult {
  /** Files that were staged and committed (relative to project root). */
  committed: string[];
  /** The commit message used, or null if nothing to commit. */
  message: string | null;
  /** Whether the commit was pushed. */
  pushed: boolean;
  /** True if this was a dry run (no actual commit). */
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function git(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return exec("git", args, { cwd });
}

/**
 * Collect IDs of changed artifacts from a directory by parsing
 * `git status --porcelain` output.
 */
async function changedArtifactIds(
  projectRoot: string,
  dir: string,
): Promise<{ files: string[]; ids: string[] }> {
  const relDir = relative(projectRoot, dir);
  let stdout: string;
  try {
    const result = await git(projectRoot, [
      "status",
      "--porcelain",
      relDir + "/",
    ]);
    stdout = result.stdout;
  } catch {
    return { files: [], ids: [] };
  }

  const files: string[] = [];
  const ids: string[] = [];

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    // porcelain format: "XY filename" or "XY orig -> filename"
    const filePath = line.slice(3).split(" -> ").pop()!.trim();
    files.push(filePath);

    // Extract ID from filename if it matches our pattern
    const basename = filePath.split("/").pop() ?? "";
    if (extname(basename) === ".md") {
      const match = basename.match(/^([A-Z]+-\d+)/);
      if (match) ids.push(match[1]);
    }
    // Also include counter/config changes
    if (basename === ".counter" || basename === ".config.yaml") {
      files.push(filePath);
    }
  }

  return { files, ids: [...new Set(ids)] };
}

/**
 * Build a structured commit message from the changed artifact IDs.
 */
function buildCommitMessage(
  taskIds: string[],
  planIds: string[],
  docIds: string[],
): string {
  const parts: string[] = [];
  if (taskIds.length > 0) parts.push(taskIds.join(", "));
  if (planIds.length > 0) parts.push(planIds.join(", "));
  if (docIds.length > 0) parts.push(docIds.join(", "));

  const date = new Date().toISOString().slice(0, 10);
  const summary = parts.length > 0 ? parts.join(", ") : "update";
  return `ticketbook: sync ${summary} [${date}]`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function sync(options: SyncOptions): Promise<SyncResult> {
  const { tasksDir, plansDir, docsDir, projectRoot, dryRun = false, push = false } = options;

  // Gather changes across all artifact directories
  const tasks = await changedArtifactIds(projectRoot, tasksDir);
  const plans = plansDir
    ? await changedArtifactIds(projectRoot, plansDir)
    : { files: [], ids: [] };
  const docs = docsDir
    ? await changedArtifactIds(projectRoot, docsDir)
    : { files: [], ids: [] };

  const allFiles = [...tasks.files, ...plans.files, ...docs.files];

  if (allFiles.length === 0) {
    return { committed: [], message: null, pushed: false, dryRun };
  }

  const message = buildCommitMessage(tasks.ids, plans.ids, docs.ids);

  if (dryRun) {
    return { committed: allFiles, message, pushed: false, dryRun: true };
  }

  // Stage all artifact directories (including counter files, config)
  const dirsToStage = [relative(projectRoot, tasksDir) + "/"];
  if (plansDir) dirsToStage.push(relative(projectRoot, plansDir) + "/");
  if (docsDir) dirsToStage.push(relative(projectRoot, docsDir) + "/");

  await git(projectRoot, ["add", ...dirsToStage]);
  await git(projectRoot, ["commit", "-m", message]);

  let pushed = false;
  if (push) {
    try {
      // Get current branch name
      const { stdout: branch } = await git(projectRoot, [
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ]);
      await git(projectRoot, [
        "push",
        "-u",
        "origin",
        branch.trim(),
      ]);
      pushed = true;
    } catch {
      // Push failed — commit is still local, which is fine
    }
  }

  return { committed: allFiles, message, pushed, dryRun: false };
}
