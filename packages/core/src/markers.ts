/**
 * HTML-comment markers used to wrap the relay section inside a host
 * document (CLAUDE.md, AGENTS.md, etc.). The bracketed region can be
 * surgically replaced on re-run without touching content outside the
 * markers.
 *
 * Pattern lifted from seeds (~/workspace/resources/seeds/src/markers.ts).
 */

export const START_MARKER = "<!-- relay:start -->";
export const END_MARKER = "<!-- relay:end -->";

export function hasMarkerSection(content: string): boolean {
  return content.includes(START_MARKER) && content.includes(END_MARKER);
}

/**
 * Replace the region between START_MARKER and END_MARKER (inclusive) with
 * a freshly wrapped `newSection`. Returns `null` if either marker is
 * absent from the input — callers should treat that as "no section to
 * replace" and fall through to an append or create.
 */
export function replaceMarkerSection(
  content: string,
  newSection: string,
): string | null {
  const startIdx = content.indexOf(START_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) return null;
  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + END_MARKER.length);
  return before + wrapInMarkers(newSection) + after;
}

export function wrapInMarkers(section: string): string {
  return `${START_MARKER}\n${section}\n${END_MARKER}`;
}
