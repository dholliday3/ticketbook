/**
 * Server-only rendering helpers for context ref expansions.
 *
 * These produce the `<context>...</context>` blocks that the server
 * substitutes into outgoing copilot messages before forwarding them to
 * the provider. The agent sees the full, current state of each
 * referenced primitive in a shape identical to the task/plan `.md`
 * file on disk.
 *
 * Kept separate from `context-refs.ts` so the pure string/regex logic
 * can be imported into the UI bundle without pulling gray-matter (and
 * its Node-specific deps) along with it.
 */

import matter from "gray-matter";
import { encodeTitleAttr, type ContextRefKind } from "./context-refs.js";
import type { Task } from "./types.js";
import type { Plan } from "./plan-types.js";

/**
 * Render a primitive (task or plan) as a `<context>` expansion block.
 * This is what the copilot provider actually sees — the agent gets the
 * full frontmatter + body, matching the shape it would see if it read
 * the `.md` file directly.
 */
export function renderContextRefExpansion(
  kind: ContextRefKind,
  primitive: Task | Plan,
): string {
  const { body, filePath: _filePath, ...frontmatterFields } = primitive as Task & Plan;
  const frontmatter = normalizeFrontmatter(
    frontmatterFields as Record<string, unknown>,
  );
  const fileLike = matter
    .stringify(body ? `\n${body}\n` : "", frontmatter)
    .trim();

  const attrs: string[] = [
    `type="${kind}"`,
    `id="${encodeTitleAttr(primitive.id)}"`,
    `title="${encodeTitleAttr(primitive.title)}"`,
  ];
  if ("status" in primitive && primitive.status) {
    attrs.push(`status="${encodeTitleAttr(String(primitive.status))}"`);
  }
  if ("priority" in primitive && primitive.priority) {
    attrs.push(`priority="${encodeTitleAttr(String(primitive.priority))}"`);
  }
  return `<context ${attrs.join(" ")}>\n${fileLike}\n</context>`;
}

/**
 * Render a self-closing `<context>` tag for a primitive that could not
 * be found. `titleSnapshot` comes from the marker form, so the UI can
 * still show something readable even when the primitive is gone.
 */
export function renderDeletedContextRef(
  kind: ContextRefKind,
  id: string,
  titleSnapshot: string | null,
): string {
  const attrs: string[] = [
    `type="${kind}"`,
    `id="${encodeTitleAttr(id)}"`,
    `deleted="true"`,
  ];
  if (titleSnapshot) {
    attrs.push(`title="${encodeTitleAttr(titleSnapshot)}"`);
  }
  return `<context ${attrs.join(" ")} />`;
}

/** Strip undefined/null and turn Dates into ISO strings (matches writer.ts). */
function normalizeFrontmatter(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}
