/**
 * Server-side expansion of context ref markers.
 *
 * Walks an outgoing copilot message for `<task id="..." />`,
 * `<plan id="..." />`, and `<doc id="..." />` markers, fetches each
 * primitive's current state from the filesystem, and substitutes a
 * `<context>` expansion inline.
 *
 * The stored user message keeps the marker form — this expansion only
 * affects the text that's forwarded to the provider, so the agent
 * always sees the latest primitive state (live refs, not snapshots).
 */

import {
  createContextRefRegex,
  getTask,
  getPlan,
  getDoc,
  renderContextRefExpansion,
  renderDeletedContextRef,
  type ContextRefKind,
  type Task,
  type Plan,
  type Doc,
} from "@relay/core";

export interface ExpandContextRefsOptions {
  tasksDir: string;
  plansDir: string;
  docsDir?: string;
}

/**
 * Replace every context ref marker in `text` with its expanded
 * `<context>` form. Returns the original text unchanged if it has
 * no markers.
 */
export async function expandContextRefs(
  text: string,
  opts: ExpandContextRefsOptions,
): Promise<string> {
  const regex = createContextRefRegex();
  const matches: Array<{
    full: string;
    kind: ContextRefKind;
    id: string;
    titleSnapshot: string | null;
    index: number;
  }> = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    matches.push({
      full: m[0],
      kind: m[1] as ContextRefKind,
      id: m[2],
      titleSnapshot: m[3] ?? null,
      index: m.index,
    });
  }

  if (matches.length === 0) return text;

  // Deduplicate fetches — the same primitive may be referenced multiple
  // times in one message; no need to hit the filesystem twice.
  const uniqueKeys = Array.from(
    new Set(matches.map((match) => `${match.kind}:${match.id}`)),
  );
  const fetched = new Map<string, Task | Plan | Doc | null>();
  await Promise.all(
    uniqueKeys.map(async (key) => {
      const sep = key.indexOf(":");
      const kind = key.slice(0, sep) as ContextRefKind;
      const id = key.slice(sep + 1);
      if (kind === "task") {
        fetched.set(key, await getTask(opts.tasksDir, id));
      } else if (kind === "plan") {
        fetched.set(key, await getPlan(opts.plansDir, id));
      } else if (opts.docsDir) {
        fetched.set(key, await getDoc(opts.docsDir, id));
      } else {
        fetched.set(key, null);
      }
    }),
  );

  // Walk the matches in order, interleaving text and expansions.
  let result = "";
  let cursor = 0;
  for (const match of matches) {
    if (match.index > cursor) {
      result += text.slice(cursor, match.index);
    }
    const key = `${match.kind}:${match.id}`;
    const primitive = fetched.get(key) ?? null;
    result += primitive
      ? renderContextRefExpansion(match.kind, primitive)
      : renderDeletedContextRef(match.kind, match.id, match.titleSnapshot);
    cursor = match.index + match.full.length;
  }
  if (cursor < text.length) {
    result += text.slice(cursor);
  }
  return result;
}
