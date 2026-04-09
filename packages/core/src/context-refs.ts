/**
 * Rich context references for the copilot chat — *client-safe* portion.
 *
 * This module contains only the pure string/regex logic for working
 * with context ref markers. It has no node or gray-matter dependencies
 * so it's safe to import from the UI bundle.
 *
 * The server-side expansion logic (which reads task/plan files from
 * disk and renders them as `<context>` blocks) lives in
 * `context-refs-expansion.ts`.
 *
 * Two forms exist:
 *
 *   1. Marker form — self-closing, stored inline in copilot message text,
 *      typed by the user (via @-mention or quick-add button), and rendered
 *      in the UI as a chip with a hovercard:
 *
 *        <task id="TKTB-025" title="Copilot context refs" />
 *        <plan id="PLAN-006" title="Primitive rename" />
 *
 *   2. Expansion form — what the server substitutes in before forwarding
 *      the outgoing message to the provider. The agent sees the full,
 *      current state of each referenced primitive:
 *
 *        <context type="task" id="TKTB-025" ...>
 *        ---
 *        id: TKTB-025
 *        title: Copilot context refs
 *        status: open
 *        ---
 *
 *        [body]
 *        </context>
 *
 * Keeping these shapes distinct means the stored form stays compact and
 * the agent-facing form is always fresh (live refs, not snapshots). The
 * `<context>` wrapper is intentionally a different tag from `<task>` /
 * `<plan>` so it can never collide with a literal marker in user prose.
 */

export type ContextRefKind = "task" | "plan";

export interface ContextRef {
  kind: ContextRefKind;
  id: string;
  /** Title snapshot captured at insertion time. Used to render the chip even if the primitive is later deleted or renamed. */
  title: string | null;
  /** Character offset of the full marker in the source string. */
  start: number;
  /** Character offset immediately after the marker. */
  end: number;
  /** The full matched marker text. */
  raw: string;
}

/**
 * Matches a self-closing context ref marker. Always construct a fresh
 * instance via `createContextRefRegex()` when iterating, so callers don't
 * share `lastIndex` state.
 */
const MARKER_SOURCE = '<(task|plan)\\s+id="([^"]+)"(?:\\s+title="([^"]*)")?\\s*/>';
const MARKER_FLAGS = "g";

export function createContextRefRegex(): RegExp {
  return new RegExp(MARKER_SOURCE, MARKER_FLAGS);
}

/** Parse all context ref markers out of a piece of text. */
export function parseContextRefs(text: string): ContextRef[] {
  const regex = createContextRefRegex();
  const refs: ContextRef[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    refs.push({
      kind: match[1] as ContextRefKind,
      id: match[2],
      title: match[3] !== undefined ? decodeTitle(match[3]) : null,
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
    });
  }
  return refs;
}

/** A span of either plain text or a parsed ref, in source order. */
export type ContextRefSpan =
  | { type: "text"; content: string }
  | { type: "ref"; ref: ContextRef };

/**
 * Split a string into interleaved text and ref spans. Clients render text
 * spans via their usual markdown path and ref spans as chips.
 */
export function splitByContextRefs(text: string): ContextRefSpan[] {
  const refs = parseContextRefs(text);
  if (refs.length === 0) {
    return text.length > 0 ? [{ type: "text", content: text }] : [];
  }

  const spans: ContextRefSpan[] = [];
  let cursor = 0;
  for (const ref of refs) {
    if (ref.start > cursor) {
      spans.push({ type: "text", content: text.slice(cursor, ref.start) });
    }
    spans.push({ type: "ref", ref });
    cursor = ref.end;
  }
  if (cursor < text.length) {
    spans.push({ type: "text", content: text.slice(cursor) });
  }
  return spans;
}

/** Build a canonical marker string for insertion into the copilot input. */
export function renderContextRefMarker(input: {
  kind: ContextRefKind;
  id: string;
  title?: string | null;
}): string {
  const titleAttr =
    input.title && input.title.length > 0
      ? ` title="${encodeTitleAttr(input.title)}"`
      : "";
  return `<${input.kind} id="${input.id}"${titleAttr} />`;
}

/** Encode a string for safe use inside an XML attribute value. */
export function encodeTitleAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeTitle(title: string): string {
  return title
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
