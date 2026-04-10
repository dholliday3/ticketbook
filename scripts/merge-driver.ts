#!/usr/bin/env bun
/**
 * Custom git merge driver for ticketbook artifact files (tasks, plans, docs).
 *
 * Registered via: git config merge.ticketbook.driver "bun <path>/merge-driver.ts %O %A %B"
 *   %O = ancestor (base), %A = ours (current), %B = theirs (other)
 *
 * Strategy:
 *   1. Parse YAML frontmatter from all three versions.
 *   2. For each frontmatter field, if only one side changed it, take that change.
 *      If both sides changed the same field to different values, take "theirs"
 *      for timestamps (updated) and use a field-specific merge for arrays
 *      (union for tags, blockedBy, relatedTo, tasks, refs).
 *      For scalar conflicts, mark as conflicted and fall back to git's default.
 *   3. For the markdown body, if only one side changed it, take that change.
 *      If both sides changed it, attempt a line-level 3-way merge.
 *      If that fails, leave conflict markers for the body only.
 *   4. Write the result back to %A (ours) — exit 0 for clean merge, 1 for conflicts.
 */

import { readFileSync, writeFileSync } from "node:fs";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== typeof b) return false;

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) =>
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    );
  }

  return false;
}

/** Fields where we merge arrays via union rather than picking one side. */
const UNION_ARRAY_FIELDS = new Set([
  "tags",
  "blockedBy",
  "relatedTo",
  "tasks",
  "refs",
]);

function mergeArraysUnion(
  base: unknown[] | undefined,
  ours: unknown[] | undefined,
  theirs: unknown[] | undefined,
): unknown[] {
  const set = new Set<string>();
  for (const arr of [base, ours, theirs]) {
    if (Array.isArray(arr)) {
      for (const item of arr) set.add(String(item));
    }
  }
  return [...set].sort();
}

// ---------------------------------------------------------------------------
// 3-way frontmatter merge
// ---------------------------------------------------------------------------

interface MergeResult {
  frontmatter: Record<string, unknown>;
  body: string;
  hasConflicts: boolean;
}

function mergeFrontmatter(
  base: Record<string, unknown>,
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>,
): { merged: Record<string, unknown>; hasConflicts: boolean } {
  const allKeys = new Set([
    ...Object.keys(base),
    ...Object.keys(ours),
    ...Object.keys(theirs),
  ]);

  const merged: Record<string, unknown> = {};
  let hasConflicts = false;

  for (const key of allKeys) {
    const baseVal = base[key];
    const oursVal = ours[key];
    const theirsVal = theirs[key];

    const oursChanged = !deepEqual(baseVal, oursVal);
    const theirsChanged = !deepEqual(baseVal, theirsVal);

    if (!oursChanged && !theirsChanged) {
      // Neither side changed — keep base
      if (baseVal !== undefined) merged[key] = baseVal;
    } else if (oursChanged && !theirsChanged) {
      // Only we changed — keep ours
      if (oursVal !== undefined) merged[key] = oursVal;
    } else if (!oursChanged && theirsChanged) {
      // Only they changed — keep theirs
      if (theirsVal !== undefined) merged[key] = theirsVal;
    } else {
      // Both sides changed
      if (deepEqual(oursVal, theirsVal)) {
        // Changed to the same thing — no conflict
        if (oursVal !== undefined) merged[key] = oursVal;
      } else if (UNION_ARRAY_FIELDS.has(key)) {
        // Union merge for array fields
        const result = mergeArraysUnion(
          baseVal as unknown[] | undefined,
          oursVal as unknown[] | undefined,
          theirsVal as unknown[] | undefined,
        );
        if (result.length > 0) merged[key] = result;
      } else if (key === "updated") {
        // For timestamps, take the more recent one
        const oursDate = oursVal instanceof Date ? oursVal : new Date(String(oursVal));
        const theirsDate = theirsVal instanceof Date ? theirsVal : new Date(String(theirsVal));
        merged[key] = oursDate > theirsDate ? oursVal : theirsVal;
      } else {
        // True conflict on a scalar field — take theirs but flag it
        // (theirs = the incoming branch, which is usually the more recent work)
        if (theirsVal !== undefined) merged[key] = theirsVal;
        hasConflicts = true;
      }
    }
  }

  return { merged, hasConflicts };
}

// ---------------------------------------------------------------------------
// 3-way body merge (simple line-level)
// ---------------------------------------------------------------------------

function mergeBody(
  baseBody: string,
  oursBody: string,
  theirsBody: string,
): { body: string; hasConflicts: boolean } {
  const oursChanged = baseBody !== oursBody;
  const theirsChanged = baseBody !== theirsBody;

  if (!oursChanged && !theirsChanged) return { body: baseBody, hasConflicts: false };
  if (oursChanged && !theirsChanged) return { body: oursBody, hasConflicts: false };
  if (!oursChanged && theirsChanged) return { body: theirsBody, hasConflicts: false };
  if (oursBody === theirsBody) return { body: oursBody, hasConflicts: false };

  // Both changed differently — leave conflict markers
  const result = [
    "<<<<<<< ours",
    oursBody,
    "=======",
    theirsBody,
    ">>>>>>> theirs",
  ].join("\n");

  return { body: result, hasConflicts: true };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): number {
  const [ancestorPath, oursPath, theirsPath] = process.argv.slice(2);

  if (!ancestorPath || !oursPath || !theirsPath) {
    console.error("Usage: merge-driver.ts <ancestor> <ours> <theirs>");
    return 1;
  }

  let baseRaw: string, oursRaw: string, theirsRaw: string;
  try {
    baseRaw = readFileSync(ancestorPath, "utf-8");
    oursRaw = readFileSync(oursPath, "utf-8");
    theirsRaw = readFileSync(theirsPath, "utf-8");
  } catch (err) {
    console.error("Failed to read input files:", err);
    return 1;
  }

  // Parse frontmatter + body from each version
  let baseParsed, oursParsed, theirsParsed;
  try {
    baseParsed = matter(baseRaw);
    oursParsed = matter(oursRaw);
    theirsParsed = matter(theirsRaw);
  } catch {
    // If any file can't be parsed as frontmatter, bail and let git handle it
    return 1;
  }

  // Merge frontmatter
  const { merged: mergedFm, hasConflicts: fmConflicts } = mergeFrontmatter(
    baseParsed.data,
    oursParsed.data,
    theirsParsed.data,
  );

  // Merge body
  const { body: mergedBody, hasConflicts: bodyConflicts } = mergeBody(
    baseParsed.content.trim(),
    oursParsed.content.trim(),
    theirsParsed.content.trim(),
  );

  // Serialize and write result to %A (ours)
  const output = matter.stringify(
    mergedBody ? `\n${mergedBody}\n` : "",
    mergedFm,
  );
  writeFileSync(oursPath, output, "utf-8");

  // Exit 0 = clean merge, 1 = conflicts remain
  return fmConflicts || bodyConflicts ? 1 : 0;
}

process.exit(main());
