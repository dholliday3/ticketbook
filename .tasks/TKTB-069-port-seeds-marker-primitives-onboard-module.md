---
id: TKTB-069
title: Port seeds' marker primitives + onboard module
status: open
priority: high
tags:
  - phase-0
  - onboard
  - packaging
project: ticketbook
created: '2026-04-11T07:05:00.422Z'
updated: '2026-04-11T07:05:00.422Z'
---

Port the marker-wrapping infrastructure from seeds (`~/workspace/resources/seeds`) into ticketbook core, and build the new `runOnboard` module on top of it. Foundation for PLAN-005 Phase 0 — Tasks B and E both depend on this landing first.

## Files to create

### `packages/core/src/markers.ts`

Verbatim port of `~/workspace/resources/seeds/src/markers.ts` (~20 lines), with delimiter names changed:

- `START_MARKER = "<!-- ticketbook:start -->"`
- `END_MARKER = "<!-- ticketbook:end -->"`
- `hasMarkerSection(content: string): boolean`
- `replaceMarkerSection(content: string, newSection: string): string | null`
- `wrapInMarkers(section: string): string`

### `packages/core/src/markers.test.ts`

Unit tests for each helper: wrap, detect (with/without markers), replace (happy path + returns `null` when markers absent).

### `packages/core/src/onboard.ts`

New module exporting `runOnboard(options: RunOnboardOptions): Promise<RunOnboardResult>`. Mirror seeds' `src/commands/onboard.ts` shape.

Top-level constants:
- `ONBOARD_VERSION = 1` — a plain numeric constant with a prominent comment: "Bump this when the snippet below materially changes (not for whitespace tweaks). See PLAN-005 Open Questions for rationale."
- `VERSION_MARKER = \`<!-- ticketbook-onboard-v:${ONBOARD_VERSION} -->\``
- `CANDIDATE_FILES = ["CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md"] as const`
- `ONBOARD_SECTION_CONTENT` — the reshaped agent instructions. Start with the current `AGENTS_MD_CONTENT` body from `packages/core/src/init.ts:51`, minus the top-level `# AGENTS.md` heading (this task creates the constant; Task B will delete the original in `init.ts`).

Functions to implement (mirror seeds exactly):
- `onboardSnippet(): string` — returns `## Issue Tracking (Ticketbook)` heading + `VERSION_MARKER` + body
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

Use `mkdtemp(join(tmpdir(), "ticketbook-onboard-"))` for isolation, matching the pattern in `packages/core/src/init.test.ts`.

## Reference
- `~/workspace/resources/seeds/src/markers.ts` — lift verbatim
- `~/workspace/resources/seeds/src/commands/onboard.ts` — model for three-state detection + candidate walk + `--check` / `--stdout` modes
- `~/workspace/resources/seeds/src/commands/onboard.test.ts` — test patterns

## Out of scope
- Do NOT wire `onboard` into `bin/ticketbook.ts` (Task B)
- Do NOT delete `AGENTS_MD_CONTENT` from `init.ts` yet (Task B, after verifying the content moved correctly)
- Do NOT update README (Task E)

## Acceptance
- `bun test packages/core/src/markers.test.ts packages/core/src/onboard.test.ts` passes
- All new files typecheck clean (`bun run typecheck`)
- No changes to existing files — this task is purely additive
