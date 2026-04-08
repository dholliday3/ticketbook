import { join, dirname, relative, resolve } from "node:path";
import {
  stat,
  mkdir,
  writeFile,
  readFile,
  copyFile,
} from "node:fs/promises";

/**
 * Options for scaffolding a ticketbook installation into a target project.
 */
export interface InitTicketbookOptions {
  /** Directory to initialize ticketbook in (will contain .tickets/, .plans/, etc.). */
  baseDir: string;
  /**
   * Path to `skills/ticketbook/SKILL.md` inside the ticketbook package.
   * The bin script computes this from its own location and passes it in.
   * If the file does not exist, skill installation is skipped with a warning.
   */
  skillSourcePath?: string;
}

/**
 * Result summary of an init run. Fields indicate what was newly created
 * vs. left alone (init is idempotent — it never overwrites user files).
 */
export interface InitTicketbookResult {
  ticketsDir: string;
  plansDir: string;
  createdTicketsDir: boolean;
  createdPlansDir: boolean;
  wroteConfig: boolean;
  wroteSkill: boolean;
  wroteMcpConfig: boolean;
  mergedMcpConfig: boolean;
  wroteAgentsMd: boolean;
  updatedGitignore: boolean;
}

const AGENTS_MD_CONTENT = `# AGENTS.md

This project uses **ticketbook** for ticket and plan tracking. Tickets live in \`.tickets/\` and plans live in \`.plans/\` as markdown files with YAML frontmatter.

## If your agent supports Skills

The \`ticketbook\` skill at \`.claude/skills/ticketbook/SKILL.md\` (Claude Code) and \`.agents/skills/ticketbook/SKILL.md\` (Codex) covers the full workflow. Nothing to configure — just ask about tickets or plans and the skill will load on demand.

## If your agent does not support Skills

Use the \`ticketbook\` MCP server for all ticket and plan operations. Start it with:

\`\`\`
bunx ticketbook --mcp
\`\`\`

Never hand-edit files in \`.tickets/\` or \`.plans/\` — the MCP server owns ID assignment, file naming, ordering, and watcher sync. Direct edits will desync state.

## Workflow basics

- **Start work:** set ticket \`status: "in-progress"\` and \`assignee: "<your agent name>"\`.
- **Finish work:** set \`status: "done"\`, append a debrief under a \`<!-- agent-notes -->\` marker in the body, and call \`link_ref\` with the commit SHA or PR URL.
- **Plans → tickets:** call \`cut_tickets_from_plan\` to parse unchecked checkboxes in a plan body into linked tickets in one step.
- **Commit convention:** include the ticket ID in the commit message (e.g. \`TKTB-015: fix kanban reorder bug\`).

## Enums

- **Ticket status:** \`draft\`, \`backlog\`, \`open\`, \`in-progress\`, \`done\`, \`cancelled\`
- **Ticket priority:** \`low\`, \`medium\`, \`high\`, \`urgent\`
- **Plan status:** \`draft\`, \`active\`, \`completed\`, \`archived\`
`;

const TICKETBOOK_MCP_ENTRY = {
  command: "bunx",
  args: ["ticketbook", "--mcp"],
} as const;

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
): Promise<{ wrote: boolean; merged: boolean }> {
  if (!(await pathExists(mcpPath))) {
    const content = {
      mcpServers: {
        ticketbook: TICKETBOOK_MCP_ENTRY,
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

  parsed.mcpServers.ticketbook = TICKETBOOK_MCP_ENTRY;
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
 *   - .tickets/ and .plans/ directories with .config.yaml and .counter files
 *   - .claude/skills/ticketbook/SKILL.md (Claude Code skill discovery)
 *   - .agents/skills/ticketbook/SKILL.md (Codex skill discovery)
 *   - .mcp.json (or merges a ticketbook entry into an existing one)
 *   - AGENTS.md (minimal pointer for agents without skill support)
 *   - .gitignore entries for .tickets/.archive/ and .plans/.archive/
 */
export async function initTicketbook(
  options: InitTicketbookOptions,
): Promise<InitTicketbookResult> {
  const baseDir = resolve(options.baseDir);
  const ticketsDir = join(baseDir, ".tickets");
  const ticketsArchiveDir = join(ticketsDir, ".archive");
  const plansDir = join(baseDir, ".plans");
  const plansArchiveDir = join(plansDir, ".archive");

  const createdTicketsDir = !(await pathExists(ticketsDir));
  const createdPlansDir = !(await pathExists(plansDir));

  await ensureDir(ticketsArchiveDir);
  await ensureDir(plansArchiveDir);

  // .config.yaml (tickets)
  let wroteConfig = false;
  const configPath = join(ticketsDir, ".config.yaml");
  if (!(await pathExists(configPath))) {
    await writeFile(
      configPath,
      "prefix: TKT\nplanPrefix: PLAN\ndeleteMode: archive\n",
      "utf-8",
    );
    wroteConfig = true;
  }

  // .counter files
  for (const dir of [ticketsDir, plansDir]) {
    const counterPath = join(dir, ".counter");
    if (!(await pathExists(counterPath))) {
      await writeFile(counterPath, "0", "utf-8");
    }
  }

  // .gitignore updates
  const updatedGitignore = await updateGitignore(baseDir, [
    ".tickets/.archive/",
    ".plans/.archive/",
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

  // .mcp.json — project-level MCP config Claude Code auto-loads.
  const mcpResult = await writeMcpConfig(join(baseDir, ".mcp.json"));

  // AGENTS.md — minimal pointer for non-plugin agents.
  const wroteAgentsMd = await writeAgentsMd(join(baseDir, "AGENTS.md"));

  return {
    ticketsDir,
    plansDir,
    createdTicketsDir,
    createdPlansDir,
    wroteConfig,
    wroteSkill,
    wroteMcpConfig: mcpResult.wrote,
    mergedMcpConfig: mcpResult.merged,
    wroteAgentsMd,
    updatedGitignore,
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
export { TICKETBOOK_MCP_ENTRY, AGENTS_MD_CONTENT };
