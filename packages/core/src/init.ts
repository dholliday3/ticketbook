import { join, dirname, resolve } from "node:path";
import {
  stat,
  mkdir,
  writeFile,
  readFile,
  copyFile,
} from "node:fs/promises";
import { setupGitIntegration } from "./git-setup.js";

/**
 * Options for scaffolding a ticketbook installation into a target project.
 */
export interface InitTicketbookOptions {
  /** Directory to initialize ticketbook in (will contain .tasks/, .plans/, etc.). */
  baseDir: string;
  /**
   * Path to `skills/ticketbook/SKILL.md` inside the ticketbook package.
   * The bin script computes this from its own location and passes it in.
   * If the file does not exist, skill installation is skipped with a warning.
   */
  skillSourcePath?: string;
  /**
   * Path to `scripts/merge-driver.ts` inside the ticketbook package.
   * Used to register the custom git merge driver for artifact files.
   * If omitted, git merge integration is skipped.
   */
  mergeDriverPath?: string;
}

/**
 * Result summary of an init run. Fields indicate what was newly created
 * vs. left alone (init is idempotent — it never overwrites user files).
 */
export interface InitTicketbookResult {
  tasksDir: string;
  plansDir: string;
  docsDir: string;
  createdTasksDir: boolean;
  createdPlansDir: boolean;
  createdDocsDir: boolean;
  wroteConfig: boolean;
  wroteSkill: boolean;
  wroteMcpConfig: boolean;
  mergedMcpConfig: boolean;
  wroteAgentsMd: boolean;
  updatedGitignore: boolean;
  /** Whether the custom merge driver was registered in local git config. */
  registeredMergeDriver: boolean;
  /** Whether the post-merge hook was installed. */
  installedPostMergeHook: boolean;
  /** Whether .gitattributes was updated with merge driver entries. */
  updatedGitattributes: boolean;
  /**
   * True when init detected it was running against the ticketbook source
   * repo itself (via package.json name + bin/ticketbook.ts presence) and
   * wrote a dev-mode MCP command that runs the bin script directly instead
   * of relying on `bunx ticketbook` (which won't resolve while the package
   * is `"private": true`).
   */
  devMode: boolean;
}

const AGENTS_MD_CONTENT = `# AGENTS.md

This project uses **ticketbook** for task and plan tracking. Tasks live in \`.tasks/\`, plans live in \`.plans/\`, and reference docs live in \`.docs/\` as markdown files with YAML frontmatter.

## If your agent supports Skills

The \`ticketbook\` skill at \`.claude/skills/ticketbook/SKILL.md\` (Claude Code) and \`.agents/skills/ticketbook/SKILL.md\` (Codex) covers the full workflow. Nothing to configure — just ask about tasks, plans, or docs and the skill will load on demand.

## If your agent does not support Skills

Use the \`ticketbook\` MCP server for all task, plan, and doc operations. Start it with:

\`\`\`
bunx ticketbook --mcp
\`\`\`

Never hand-edit files in \`.tasks/\`, \`.plans/\`, or \`.docs/\` — the MCP server owns ID assignment, file naming, ordering, and watcher sync. Direct edits will desync state.

## Workflow basics

- **Start work:** set task \`status: "in-progress"\` and \`assignee: "<your agent name>"\`.
- **Finish work:** set \`status: "done"\`, append a debrief under a \`<!-- agent-notes -->\` marker in the body, and call \`link_ref\` with the commit SHA or PR URL.
- **Plans → tasks:** call \`cut_tasks_from_plan\` to parse unchecked checkboxes in a plan body into linked tasks in one step.
- **Commit convention:** include the task ID in the commit message (e.g. \`TKTB-015: fix kanban reorder bug\`).

## Enums

- **Task status:** \`draft\`, \`backlog\`, \`open\`, \`in-progress\`, \`done\`, \`cancelled\`
- **Task priority:** \`low\`, \`medium\`, \`high\`, \`urgent\`
- **Plan status:** \`draft\`, \`active\`, \`completed\`, \`archived\`
`;

/**
 * Published-mode MCP command. Used when init scaffolds a foreign repo that
 * has `ticketbook` available on its PATH (via a future binary install or an
 * eventual npm publish). Until the package is actually published, this
 * command will fail — so init auto-detects dev mode (running against the
 * ticketbook source repo itself) and swaps to DEV_MCP_ENTRY below.
 */
const PUBLISHED_MCP_ENTRY = {
  command: "bunx",
  args: ["ticketbook", "--mcp"],
} as const;

/**
 * Dev-mode MCP command. Used when init detects it's running against the
 * ticketbook source repo. Paths are relative to the project root (which
 * Claude Code uses as cwd when auto-loading .mcp.json), so this works for
 * anyone who clones the repo without any additional setup.
 */
const DEV_MCP_ENTRY = {
  command: "bun",
  args: ["bin/ticketbook.ts", "--mcp"],
} as const;

/**
 * Detect whether `baseDir` is the ticketbook source repo itself. Returns
 * true only if both signals line up:
 *   - package.json exists and its `name` field is "ticketbook"
 *   - bin/ticketbook.ts exists (the entry point that --mcp mode relies on)
 *
 * Both checks together prevent false positives (e.g., a user's unrelated
 * project happens to have a package named "ticketbook" in their deps).
 */
async function detectTicketbookSourceRepo(baseDir: string): Promise<boolean> {
  try {
    const pkgText = await readFile(join(baseDir, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgText);
    if (pkg?.name !== "ticketbook") return false;
  } catch {
    return false;
  }
  return pathExists(join(baseDir, "bin", "ticketbook.ts"));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p: string): Promise<boolean> {
  if (await pathExists(p)) return false;
  await mkdir(p, { recursive: true });
  return true;
}

/**
 * Merge the ticketbook MCP server entry into a `.mcp.json` file.
 * Returns { wrote, merged }:
 *   - wrote=true if the file was newly created
 *   - merged=true if the file existed and we added (or already had) the entry
 */
async function writeMcpConfig(
  mcpPath: string,
  entry: { command: string; args: readonly string[] },
): Promise<{ wrote: boolean; merged: boolean }> {
  if (!(await pathExists(mcpPath))) {
    const content = {
      mcpServers: {
        ticketbook: entry,
      },
    };
    await writeFile(mcpPath, JSON.stringify(content, null, 2) + "\n", "utf-8");
    return { wrote: true, merged: false };
  }

  // Parse and merge, preserving existing entries.
  const raw = await readFile(mcpPath, "utf-8");
  let parsed: { mcpServers?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed .mcp.json — don't clobber the user's file. Leave it alone.
    return { wrote: false, merged: false };
  }

  if (!parsed.mcpServers) parsed.mcpServers = {};
  if (parsed.mcpServers.ticketbook) {
    // Already configured — leave it alone (user may have customized).
    return { wrote: false, merged: false };
  }

  parsed.mcpServers.ticketbook = entry;
  await writeFile(mcpPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
  return { wrote: false, merged: true };
}

async function writeSkillFile(
  skillSourcePath: string,
  targetPath: string,
): Promise<boolean> {
  if (await pathExists(targetPath)) return false;
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(skillSourcePath, targetPath);
  return true;
}

async function writeAgentsMd(targetPath: string): Promise<boolean> {
  if (await pathExists(targetPath)) return false;
  await writeFile(targetPath, AGENTS_MD_CONTENT, "utf-8");
  return true;
}

async function updateGitignore(
  baseDir: string,
  patterns: string[],
): Promise<boolean> {
  const gitignorePath = join(baseDir, ".gitignore");
  let existing = "";
  let changed = false;
  try {
    existing = await readFile(gitignorePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  for (const pattern of patterns) {
    if (!existing.includes(pattern)) {
      const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
      existing += `${sep}${pattern}\n`;
      changed = true;
    }
  }

  if (changed) {
    await writeFile(gitignorePath, existing, "utf-8");
  }
  return changed;
}

/**
 * Scaffold a ticketbook installation into a target project.
 *
 * Creates (idempotently — existing files are never overwritten):
 *   - .tasks/, .plans/, and .docs/ directories with .config.yaml and .counter files
 *   - .claude/skills/ticketbook/SKILL.md (Claude Code skill discovery)
 *   - .agents/skills/ticketbook/SKILL.md (Codex skill discovery)
 *   - .mcp.json (or merges a ticketbook entry into an existing one)
 *   - AGENTS.md (minimal pointer for agents without skill support)
 *   - .gitignore entries for .tasks/.archive/, .plans/.archive/, and .docs/.archive/
 */
export async function initTicketbook(
  options: InitTicketbookOptions,
): Promise<InitTicketbookResult> {
  const baseDir = resolve(options.baseDir);
  const tasksDir = join(baseDir, ".tasks");
  const tasksArchiveDir = join(tasksDir, ".archive");
  const plansDir = join(baseDir, ".plans");
  const plansArchiveDir = join(plansDir, ".archive");
  const docsDir = join(baseDir, ".docs");
  const docsArchiveDir = join(docsDir, ".archive");

  const createdTasksDir = !(await pathExists(tasksDir));
  const createdPlansDir = !(await pathExists(plansDir));
  const createdDocsDir = !(await pathExists(docsDir));

  await ensureDir(tasksArchiveDir);
  await ensureDir(plansArchiveDir);
  await ensureDir(docsArchiveDir);

  // .config.yaml (tasks)
  let wroteConfig = false;
  const configPath = join(tasksDir, ".config.yaml");
  if (!(await pathExists(configPath))) {
    await writeFile(
      configPath,
      "prefix: TASK\nplanPrefix: PLAN\ndocPrefix: DOC\ndeleteMode: archive\n",
      "utf-8",
    );
    wroteConfig = true;
  }

  // .counter files
  for (const dir of [tasksDir, plansDir, docsDir]) {
    const counterPath = join(dir, ".counter");
    if (!(await pathExists(counterPath))) {
      await writeFile(counterPath, "0", "utf-8");
    }
  }

  // .gitignore updates
  const updatedGitignore = await updateGitignore(baseDir, [
    ".tasks/.archive/",
    ".plans/.archive/",
    ".docs/.archive/",
  ]);

  // Skill files — copied to both Claude and Codex discovery paths.
  // We deliberately copy twice (rather than symlink) so the project works on
  // Windows and so the two files can diverge if the user edits one.
  let wroteSkill = false;
  if (options.skillSourcePath && (await pathExists(options.skillSourcePath))) {
    const claudeSkillPath = join(
      baseDir,
      ".claude",
      "skills",
      "ticketbook",
      "SKILL.md",
    );
    const codexSkillPath = join(
      baseDir,
      ".agents",
      "skills",
      "ticketbook",
      "SKILL.md",
    );
    const claudeWrote = await writeSkillFile(
      options.skillSourcePath,
      claudeSkillPath,
    );
    const codexWrote = await writeSkillFile(
      options.skillSourcePath,
      codexSkillPath,
    );
    wroteSkill = claudeWrote || codexWrote;
  }

  // Detect whether we're scaffolding ticketbook against itself (dogfooding)
  // or against a foreign repo. Dev mode rewrites the MCP command so it runs
  // the local bin script directly — `bunx ticketbook` won't resolve while
  // the package is still `"private": true`.
  const devMode = await detectTicketbookSourceRepo(baseDir);
  const mcpEntry = devMode ? DEV_MCP_ENTRY : PUBLISHED_MCP_ENTRY;

  // .mcp.json — project-level MCP config Claude Code auto-loads.
  const mcpResult = await writeMcpConfig(join(baseDir, ".mcp.json"), mcpEntry);

  // AGENTS.md — minimal pointer for non-plugin agents.
  const wroteAgentsMd = await writeAgentsMd(join(baseDir, "AGENTS.md"));

  // Git integration — merge driver + post-merge hook.
  // Only set up if a merge driver path was provided and the file exists.
  let registeredMergeDriver = false;
  let installedPostMergeHook = false;
  let updatedGitattributes = false;
  if (options.mergeDriverPath && (await pathExists(options.mergeDriverPath))) {
    try {
      const gitResult = await setupGitIntegration(baseDir, options.mergeDriverPath);
      registeredMergeDriver = gitResult.registeredMergeDriver;
      installedPostMergeHook = gitResult.installedPostMergeHook;
      updatedGitattributes = gitResult.updatedGitattributes;
    } catch {
      // Not a git repo or git not available — skip silently
    }
  }

  return {
    tasksDir,
    plansDir,
    docsDir,
    createdTasksDir,
    createdPlansDir,
    createdDocsDir,
    wroteConfig,
    wroteSkill,
    wroteMcpConfig: mcpResult.wrote,
    mergedMcpConfig: mcpResult.merged,
    wroteAgentsMd,
    updatedGitignore,
    registeredMergeDriver,
    installedPostMergeHook,
    updatedGitattributes,
    devMode,
  };
}

/**
 * Returns the Codex TOML snippet users need to paste into ~/.codex/config.toml
 * to register the ticketbook MCP server. Codex doesn't support project-scoped
 * MCP config without a trusted-workspace flag, so this is a manual step.
 */
export function codexMcpInstructions(): string {
  return `[mcp_servers.ticketbook]
command = "bunx"
args = ["ticketbook", "--mcp"]`;
}

// Re-export for tests.
export { PUBLISHED_MCP_ENTRY, DEV_MCP_ENTRY, AGENTS_MD_CONTENT };
