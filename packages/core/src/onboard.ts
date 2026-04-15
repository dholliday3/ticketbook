import { join } from "node:path";
import { readFile, writeFile, stat } from "node:fs/promises";
import {
  wrapInMarkers,
  replaceMarkerSection,
  hasMarkerSection,
} from "./markers.js";

/**
 * Bump when the snippet below materially changes (not for whitespace
 * tweaks). Projects with an older version marker in their CLAUDE.md
 * section will have that section surgically replaced on the next
 * `relay onboard` run.
 *
 * This is intentionally a hand-bumped constant rather than being derived
 * from package.json or a content hash. Rationale is captured in PLAN-005
 * open questions — short version: onboard content changes are rare, and
 * hand-bumping forces a deliberate "is this actually user-facing?"
 * decision at each bump.
 */
export const ONBOARD_VERSION = 3;

const VERSION_MARKER = `<!-- relay-onboard-v:${ONBOARD_VERSION} -->`;

/**
 * Candidate files to target when writing onboarding instructions. First
 * match wins. If none exist, `runOnboard` creates `CLAUDE.md` at the
 * project root.
 */
const CANDIDATE_FILES = [
  "CLAUDE.md",
  ".claude/CLAUDE.md",
  "AGENTS.md",
] as const;

/**
 * The body of the onboarding section, minus the top-level heading and the
 * version marker (those are added by `onboardSnippet`). Kept as a plain
 * string constant so bumping ONBOARD_VERSION and editing the body are a
 * single coordinated change.
 *
 * Task B (TKTB-073) will delete the mirror copy of this content
 * (`AGENTS_MD_CONTENT` in `./init.ts`) once this module ships.
 */
const ONBOARD_SECTION_BODY = `This project uses **relay** for task and plan tracking. Tasks live in \`.relay/tasks/\`, plans live in \`.relay/plans/\`, and reference docs live in \`.relay/docs/\` as markdown files with YAML frontmatter.

### If your agent supports Skills

The \`relay\` skill at \`.claude/skills/relay/SKILL.md\` (Claude Code) and \`.agents/skills/relay/SKILL.md\` (Codex) covers the full workflow. Nothing to configure — just ask about tasks, plans, or docs and the skill will load on demand.

### If your agent does not support Skills

Use the \`relay\` MCP server for all task, plan, and doc operations. Start it with:

\`\`\`
bunx relay --mcp
\`\`\`

Never hand-edit files in \`.relay/tasks/\`, \`.relay/plans/\`, or \`.relay/docs/\` — the MCP server owns ID assignment, file naming, ordering, and watcher sync. Direct edits will desync state.

### Workflow basics

- **Start work:** set task \`status: "in-progress"\` and \`assignee: "<your agent name>"\`.
- **Finish work:** set \`status: "done"\`, append a debrief under a \`<!-- agent-notes -->\` marker in the body, and call \`link_ref\` with the commit SHA or PR URL.
- **Plans → tasks:** call \`cut_tasks_from_plan\` to parse unchecked checkboxes in a plan body into linked tasks in one step.
- **Commit convention:** include the task ID in the commit message (e.g. \`TKTB-015: fix kanban reorder bug\`).

### Enums

- **Task status:** \`draft\`, \`backlog\`, \`open\`, \`in-progress\`, \`done\`, \`cancelled\`
- **Task priority:** \`low\`, \`medium\`, \`high\`, \`urgent\`
- **Plan status:** \`draft\`, \`active\`, \`completed\`, \`archived\``;

/**
 * Returns the full onboarding section: heading + version marker + body.
 * Not itself wrapped in the start/end markers — callers wrap it via
 * `wrapInMarkers` from ./markers.
 */
export function onboardSnippet(): string {
  return `## Relay\n${VERSION_MARKER}\n\n${ONBOARD_SECTION_BODY}`;
}

export interface RunOnboardOptions {
  /** Project root directory to onboard. */
  baseDir: string;
  /**
   * Report status only; do not modify files. The caller decides exit-code
   * semantics based on the returned status.
   */
  check?: boolean;
  /** Print the wrapped snippet to stdout without touching any files. */
  stdout?: boolean;
}

export type RunOnboardResult =
  | {
      action: "created" | "unchanged" | "updated" | "appended";
      file: string;
    }
  | {
      action: "checked";
      status: "missing" | "current" | "outdated";
      file: string | null;
    }
  | { action: "stdout" };

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk `CANDIDATE_FILES` in order and return the first one that exists
 * inside `baseDir`, or `null` if none do.
 */
export async function findTargetFile(
  baseDir: string,
): Promise<string | null> {
  for (const candidate of CANDIDATE_FILES) {
    const full = join(baseDir, candidate);
    if (await pathExists(full)) return full;
  }
  return null;
}

/**
 * Classify the onboarding state of an existing file's content:
 *   - `missing`  — no relay marker section anywhere in the content
 *   - `current`  — marker section present and the embedded version marker
 *                  matches `ONBOARD_VERSION`
 *   - `outdated` — marker section present but the embedded version marker
 *                  does not match (older or otherwise)
 */
export function detectStatus(
  content: string,
): "missing" | "current" | "outdated" {
  if (!hasMarkerSection(content)) return "missing";
  if (content.includes(VERSION_MARKER)) return "current";
  return "outdated";
}

/**
 * Write or update the relay onboarding section inside the target
 * project. Idempotent — re-running after a version bump surgically
 * replaces the bracketed region without touching content outside the
 * markers.
 *
 * Dispatches on the state of the target file:
 *   - No candidate file at all → create CLAUDE.md at the project root
 *     (unless `check`, which just reports "missing, file: null")
 *   - File exists, status `current`  → no-op, return `unchanged`
 *   - File exists, status `outdated` → `replaceMarkerSection` → `updated`
 *   - File exists, status `missing`  → append wrapped snippet → `appended`
 *
 * `--stdout` short-circuits the whole flow: print the wrapped snippet and
 * return without touching any files. `--check` reads the current state
 * and reports it without modifying files.
 */
export async function runOnboard(
  options: RunOnboardOptions,
): Promise<RunOnboardResult> {
  const { baseDir, check, stdout } = options;
  const snippet = onboardSnippet();
  const wrapped = wrapInMarkers(snippet);

  // --stdout: print and return, touch nothing.
  if (stdout) {
    process.stdout.write(wrapped + "\n");
    return { action: "stdout" };
  }

  const targetPath = await findTargetFile(baseDir);

  // --check: report state only.
  if (check) {
    if (!targetPath) {
      return { action: "checked", status: "missing", file: null };
    }
    const content = await readFile(targetPath, "utf-8");
    return {
      action: "checked",
      status: detectStatus(content),
      file: targetPath,
    };
  }

  // No candidate file exists — create CLAUDE.md at the project root.
  if (!targetPath) {
    const newPath = join(baseDir, "CLAUDE.md");
    await writeFile(newPath, wrapped + "\n", "utf-8");
    return { action: "created", file: newPath };
  }

  // Candidate file exists — act based on current state.
  const content = await readFile(targetPath, "utf-8");
  const status = detectStatus(content);

  if (status === "current") {
    return { action: "unchanged", file: targetPath };
  }

  if (status === "outdated") {
    const updated = replaceMarkerSection(content, snippet);
    if (updated !== null) {
      await writeFile(targetPath, updated, "utf-8");
      return { action: "updated", file: targetPath };
    }
    // replaceMarkerSection returned null despite detectStatus saying
    // outdated — shouldn't happen, but fall through to append as a
    // safety so the user's file still gets an onboarding section.
  }

  // status === "missing": file exists but has no marker section. Append.
  const separator =
    content.length === 0 || content.endsWith("\n") ? "\n" : "\n\n";
  await writeFile(
    targetPath,
    content + separator + wrapped + "\n",
    "utf-8",
  );
  return { action: "appended", file: targetPath };
}
