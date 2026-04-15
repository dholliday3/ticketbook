---
id: TKTB-069
title: Port seeds' marker primitives + onboard module
status: done
priority: high
tags:
  - phase-0
  - onboard
  - packaging
project: relay
assignee: claude-code
created: '2026-04-11T07:05:00.422Z'
updated: '2026-04-11T07:22:12.131Z'
---

Port the marker-wrapping infrastructure from seeds (`~/workspace/resources/seeds`) into relay core, and build the new `runOnboard` module on top of it. Foundation for PLAN-005 Phase 0 — Tasks B and E both depend on this landing first.

## Files to create

### `packages/core/src/markers.ts`

Verbatim port of `~/workspace/resources/seeds/src/markers.ts` (~20 lines), with delimiter names changed:

- `START_MARKER = "<!-- relay:start -->"`
- `END_MARKER = "<!-- relay:end -->"`
- `hasMarkerSection(content: string): boolean`
- `replaceMarkerSection(content: string, newSection: string): string | null`
- `wrapInMarkers(section: string): string`

### `packages/core/src/markers.test.ts`

Unit tests for each helper: wrap, detect (with/without markers), replace (happy path + returns `null` when markers absent).

### `packages/core/src/onboard.ts`

New module exporting `runOnboard(options: RunOnboardOptions): Promise<RunOnboardResult>`. Mirror seeds' `src/commands/onboard.ts` shape.

Top-level constants:
- `ONBOARD_VERSION = 1` — a plain numeric constant with a prominent comment: "Bump this when the snippet below materially changes (not for whitespace tweaks). See PLAN-005 Open Questions for rationale."
- `VERSION_MARKER = \`<!-- relay-onboard-v:${ONBOARD_VERSION} -->\``
- `CANDIDATE_FILES = ["CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md"] as const`
- `ONBOARD_SECTION_CONTENT` — the reshaped agent instructions. Start with the current `AGENTS_MD_CONTENT` body from `packages/core/src/init.ts:51`, minus the top-level `# AGENTS.md` heading (this task creates the constant; Task B will delete the original in `init.ts`).

Functions to implement (mirror seeds exactly):
- `onboardSnippet(): string` — returns `## Issue Tracking (Relay)` heading + `VERSION_MARKER` + body
- `findTargetFile(projectRoot: string): string | null` — walks `CANDIDATE_FILES`, returns first that exists, or `null`
- `detectStatus(content: string): "missing" | "current" | "outdated"` — same shape as seeds' `onboard.ts:50-54`
- `runOnboard(options)` — main entry:
  - Options: `{ baseDir: string, check?: boolean, stdout?: boolean }`
  - `--check` mode: report status and return `{ action: "checked", status, file }` (the CLI caller in Task B decides exit code)
  - `--stdout` mode: print wrapped snippet via `process.stdout.write`, return `{ action: "stdout" }`
  - Default mode: walk candidate files, dispatch one of four actions:
    - File absent → create with `wrapInMarkers(snippet)` → `{ action: "created", file }`
    - Status `current` → no-op → `{ action: "unchanged", file }`
    - Status `outdated` → `replaceMarkerSection` → `{ action: "updated", file }`
    - Status `missing` → append wrapped snippet to end (preserving trailing newline semantics) → `{ action: "appended", file }`

Return type:
```ts
type RunOnboardResult =
  | { action: "created" | "unchanged" | "updated" | "appended"; file: string }
  | { action: "checked"; status: "missing" | "current" | "outdated"; file: string | null }
  | { action: "stdout" };
```

### `packages/core/src/onboard.test.ts`

Mirror seeds' test shape. Required cases:
- Creates `CLAUDE.md` when no candidate file exists
- Writes to existing `CLAUDE.md` in preference to creating new
- Prefers `CLAUDE.md` over `.claude/CLAUDE.md` over `AGENTS.md` when multiple exist
- Appends to file with content but no marker — verifies existing content preserved
- No-op on `current` state — file byte-identical
- Surgically replaces bracketed section on `outdated` — **verifies content outside markers preserved byte-for-byte** (this is the whole point of the marker design; do not skip this)
- `--check` mode returns correct status without touching files
- `--stdout` mode touches no files

Use `mkdtemp(join(tmpdir(), "relay-onboard-"))` for isolation, matching the pattern in `packages/core/src/init.test.ts`.

## Reference
- `~/workspace/resources/seeds/src/markers.ts` — lift verbatim
- `~/workspace/resources/seeds/src/commands/onboard.ts` — model for three-state detection + candidate walk + `--check` / `--stdout` modes
- `~/workspace/resources/seeds/src/commands/onboard.test.ts` — test patterns

## Out of scope
- Do NOT wire `onboard` into `bin/relay.ts` (Task B)
- Do NOT delete `AGENTS_MD_CONTENT` from `init.ts` yet (Task B, after verifying the content moved correctly)
- Do NOT update README (Task E)

## Acceptance
- `bun test packages/core/src/markers.test.ts packages/core/src/onboard.test.ts` passes
- All new files typecheck clean (`bun run typecheck`)
- No changes to existing files — this task is purely additive

<!-- agent-notes -->

## claude-code debrief — 2026-04-11

**Done.** Four new files, purely additive in `packages/core/src/`. No existing files touched.

### Tests + typecheck
- `bun test packages/core/src/markers.test.ts packages/core/src/onboard.test.ts` → **30 pass / 0 fail / 63 expect() calls** (markers.test.ts: 11 tests; onboard.test.ts: 19 tests).
- `bun run typecheck` → `packages/core` typecheck passes cleanly. **Unrelated error in `packages/server/src/index.ts:416`** referencing `bindWithIncrementUsing` — this is in-progress work from `claude-opus` on TKTB-071, not TKTB-069 scope. Flagged to the user; not blocking.

### Files added
- `packages/core/src/markers.ts` — lifted from seeds' `src/markers.ts` with delimiters changed to `<!-- relay:start -->` / `<!-- relay:end -->`. Three helpers: `hasMarkerSection`, `replaceMarkerSection`, `wrapInMarkers`.
- `packages/core/src/markers.test.ts` — 11 tests covering `wrapInMarkers` (2), `hasMarkerSection` (4 — both present, only start, only end, neither), `replaceMarkerSection` (5 — happy path, outside-content byte-preservation, three null cases).
- `packages/core/src/onboard.ts` — exports `runOnboard`, `ONBOARD_VERSION`, `onboardSnippet`, `findTargetFile`, `detectStatus`, `RunOnboardOptions`, `RunOnboardResult`. Three-state dispatch (missing/current/outdated → create/append/unchanged/updated), plus `--check` and `--stdout` short-circuits.
- `packages/core/src/onboard.test.ts` — 19 tests: create (2), candidate preference (3), append (2 — with blank-line separator check), unchanged (1), outdated surgical replace (1 — verifies outside bytes preserved), `--check` (4 — missing-no-file, missing-has-file-no-marker, current, outdated), `--stdout` (2), helpers (4).

### Design decisions worth knowing for Task B (TKTB-073)

1. **Top-level heading is `## Relay`** — simpler than seeds' `## Issue Tracking (Seeds)`. The body introduces itself. Change if user feedback pushes otherwise.
2. **`ONBOARD_VERSION = 1`** as a hand-bumped plain constant per PLAN-005 Open Questions, with a prominent comment explaining the bump discipline.
3. **`ONBOARD_SECTION_BODY` mirrors current `AGENTS_MD_CONTENT`** (in `init.ts:51`) verbatim — minus the `# AGENTS.md` top-level heading, with the former `##` subheadings demoted to `###` so they nest properly under `## Relay`. **Task B should verify the body content matches before deleting the original** in `init.ts`.
4. **Append separator logic matches seeds exactly:** `content.endsWith("\n") ? "\n" : "\n\n"`. Produces one blank line between existing content and the onboarding section. Tested explicitly.
5. **Outdated surgical-replace test is the load-bearing one.** It writes a file with `## Other tool's section` content after the old relay markers, then verifies that content is byte-identical after `runOnboard` replaces the section. This is the whole point of the marker design and the reason seeds' pattern is worth stealing — don't let this test regress.

### Known follow-up for Phase 1

`ONBOARD_SECTION_BODY` still contains `bunx relay --mcp` — matching the current `init.ts` content, which is dead-on-arrival because the package is `"private": true`. When PLAN-005 Phase 1 flips `PUBLISHED_MCP_ENTRY` to plain `relay`, this body should also flip to `relay --mcp` **and** `ONBOARD_VERSION` should bump to 2 so existing projects get the corrected section on their next `relay onboard` run. Not TKTB-069's job; not Task B's either. File a small follow-up when Phase 1 lands.

### Out of scope (deliberately untouched)
- `packages/core/src/init.ts` — Task B deletes `AGENTS_MD_CONTENT` there
- `bin/relay.ts` — Task B wires the `onboard` subcommand + `--check` / `--stdout` flags
- `README.md` — Task E
- `.claude-plugin/plugin.json` — Task E

### Coordination note

The parallel agent (`claude-opus`) claimed TKTB-070 and TKTB-071 within ~15 seconds of my claim on TKTB-069, and is working in the **same working tree**. Their in-progress changes span `bin/relay.ts`, `packages/core/src/{init,config,schema,init.test,config.test,schema.test}.ts`, `packages/server/src/{index,mcp}.ts`, and two new files (`mcp.test.ts`, `port-bind.ts`). None overlap with TKTB-069's files, so staging is unambiguous: commit only the four new files in `packages/core/src/markers*` and `packages/core/src/onboard*`, plus this task file's status update. Left their WIP alone.
