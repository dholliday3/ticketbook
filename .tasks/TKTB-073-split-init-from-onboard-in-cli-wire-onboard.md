---
id: TKTB-073
title: Split init from onboard in CLI + wire onboard subcommand
status: done
priority: high
tags:
  - phase-0
  - onboard
  - init
  - packaging
project: ticketbook
blockedBy:
  - TKTB-069
assignee: claude-code
created: '2026-04-11T07:06:47.203Z'
updated: '2026-04-11T07:36:24.150Z'
---

Now that `runOnboard` exists (TKTB-069), rewire the CLI so `init` owns only data-layer scaffolding and the new `onboard` subcommand owns agent instructions. This is the behavior change users will see.

**Blocked by TKTB-069** — the `onboard.ts` module must exist before this task can edit it and wire it in.

Part of PLAN-005 Phase 0. Promote to `open` as soon as TKTB-069 is merged.

## Changes

### `packages/core/src/init.ts`
- Delete the `AGENTS_MD_CONTENT` constant (lines 51–81) — it lives in `onboard.ts` now (added by TKTB-069). Verify the body matches before deleting.
- Delete the `writeAgentsMd` function (~lines 192–196)
- Remove the `writeAgentsMd(...)` call from `initTicketbook` (~line 323)
- Remove `wroteAgentsMd: boolean` from `InitTicketbookResult` (~line 39)
- Update the JSDoc comment at the top of `initTicketbook` (~line 225): remove the `AGENTS.md` bullet, add a "run `ticketbook onboard` separately for agent instructions" note
- Remove `AGENTS_MD_CONTENT` from the `export { ... }` statement at the bottom (~line 354)

### `packages/core/src/init.test.ts`
- Delete the "writes AGENTS.md when absent and leaves it alone when present" test (~line 238)
- Remove any `wroteAgentsMd` assertions from the "is idempotent" test (~line 284) — that test should keep existing for the remaining fields
- Remove `expect(agentsMd).toContain(...)` lines referencing the old behavior

### `bin/ticketbook.ts`
- Add `"onboard"` to the `CliArgs.command` union at line 13
- Add `check?: boolean` and `stdout?: boolean` fields to `CliArgs`
- Extend `parseArgs` (around line 20) to handle:
  - `onboard` as a command (same pattern as the existing `init` branch at line 27)
  - `--check` → `result.check = true`
  - `--stdout` → `result.stdout = true`
- Add a dispatch branch in `main()` after the `init` branch (around line 153):
  ```ts
  if (args.command === "onboard") {
    const { runOnboard } = await import("../packages/core/src/onboard.ts");
    const baseDir = args.dir ? resolve(args.dir) : process.cwd();
    const result = await runOnboard({
      baseDir,
      check: args.check,
      stdout: args.stdout,
    });
    // Print a one-line summary based on result.action
    // For check mode with status "missing" or "outdated", process.exitCode = 1
    // See seeds' bin for the exact summary-line shape
    return;
  }
  ```
- Match seeds' `onboard` summary output: "Created CLAUDE.md with ticketbook section" / "Updated ticketbook section in CLAUDE.md" / "Ticketbook section is already up to date" / "Added ticketbook section to CLAUDE.md" / "Status: missing|current|outdated (file)"

### `printInitSummary` in `bin/ticketbook.ts:112`
- Remove the `AGENTS.md` entry from the `created` list (~line 128)
- At the end of the function, after the existing Codex instructions, add:
  ```ts
  console.log(`Next: run 'ticketbook onboard' to add agent instructions to CLAUDE.md.`);
  ```

### `printUsage` in `bin/ticketbook.ts:49`
Add under **Commands**:
```
  onboard     Write/update the ticketbook agent instructions section in CLAUDE.md (or AGENTS.md)
```

Add under **Options**:
```
  --check        (onboard only) Report status without modifying files; exit 1 if stale
  --stdout       (onboard only) Print the onboarding section to stdout without touching files
```

## Out of scope
- README updates (TKTB-074 / Task E handles docs)
- Deleting `.claude-plugin/plugin.json` (TKTB-074 / Task E)
- Any changes to the MCP server (TKTB-070 / Task C) or HTTP port logic (TKTB-071 / Task D)

## Acceptance
- `bun test` passes — `init.test.ts` with `wroteAgentsMd` assertions removed, `onboard.test.ts` from TKTB-069 still passing
- `bun run typecheck` clean
- `bun bin/ticketbook.ts init` in a fresh temp dir scaffolds everything *except* `AGENTS.md`
- `bun bin/ticketbook.ts onboard` in that same temp dir then writes a marker-wrapped CLAUDE.md with the agent instructions
- `bun bin/ticketbook.ts onboard --check` in a fresh dir exits 1 and reports "missing"
- `bun bin/ticketbook.ts onboard --stdout` prints the wrapped snippet without creating any files
- Running `onboard` twice back-to-back reports `unchanged` the second time
- `bun bin/ticketbook.ts init` in a fresh temp dir prints the "Next: run 'ticketbook onboard'..." hint at the end of the summary

<!-- agent-notes -->

## claude-code debrief — 2026-04-11

**Done.** The init/onboard split is real in the CLI now. Every acceptance criterion validated end-to-end in a temp dir smoke test.

### Files changed
- **`packages/core/src/init.ts`** — removed `AGENTS_MD_CONTENT` constant, `writeAgentsMd` function, `wroteAgentsMd` from `InitTicketbookResult`, the `writeAgentsMd` call inside `initTicketbook`, the `wroteAgentsMd` return field, and the `AGENTS_MD_CONTENT` re-export at the bottom. Updated the JSDoc to note that agent instructions are now handled by `runOnboard` in `./onboard.ts` via `ticketbook onboard`.
- **`packages/core/src/init.test.ts`** — deleted the `"writes AGENTS.md when absent and leaves it alone when present"` test. Replaced it with a **regression test** (`"does not write AGENTS.md (onboard owns agent instructions)"`) that asserts `AGENTS.md` is NOT created by init — if someone ever reintroduces AGENTS.md writing inside init, this test catches it. Removed the `wroteAgentsMd` assertion from the idempotent test.
- **`bin/ticketbook.ts`** — six changes:
  1. `CliArgs.command` union now includes `"onboard"`; added `check`, `stdout`, `json` boolean fields.
  2. `parseArgs` recognizes `onboard` as a command plus `--check`, `--stdout`, `--json` flags.
  3. `printUsage` documents the new command and three flags.
  4. `printInitSummary` drops the `AGENTS.md` line from the "created" list and appends a `"Next: run 'ticketbook onboard' to add agent instructions to CLAUDE.md."` hint at the end.
  5. New onboard dispatch branch in `main()` right after the init branch: imports `runOnboard` dynamically, dispatches on `result.action` with seeds-style summary lines, supports `--json` via a structured envelope (`{success, command, action, file?, status?}`), and sets `process.exitCode = 1` for `--check` when status is missing/outdated.
  6. **`--stdout` short-circuits cleanly** — once `runOnboard` returns `{action: "stdout"}`, the CLI returns immediately without trying to print a summary (the wrapped text was already written to stdout by `runOnboard`).

### Test + typecheck
- `bun test` → **318 pass / 0 fail** / 639 expect() calls across 28 files. (Count dropped from 645 because I consolidated the old multi-assertion "writes AGENTS.md" test into a single "does not write AGENTS.md" regression test.)
- `bun run typecheck` → all packages clean.

### End-to-end smoke tests (all green)
Ran in a fresh `mktemp -d`:
1. **`ticketbook init`** scaffolds `.claude/skills/`, `.agents/skills/`, `.mcp.json`. **No `AGENTS.md` created.** Prints the `"Next: run 'ticketbook onboard'..."` hint at the end. ✓
2. **`onboard --check`** on a fresh dir → prints `Status: missing (no candidate file)`, exits 1. ✓
3. **`onboard --stdout`** → prints the wrapped snippet to stdout, creates no files. ✓
4. **`onboard`** (default) → creates CLAUDE.md with `<!-- ticketbook:start -->` … `<!-- ticketbook:end -->` wrap + `## Ticketbook` heading + `ticketbook-onboard-v:1` marker. Prints `Created /tmp/.../CLAUDE.md with ticketbook section`. ✓
5. **`onboard`** second run → prints `Ticketbook section is already up to date (/tmp/.../CLAUDE.md)`. ✓
6. **`onboard --check`** on current dir → prints `Status: current (/tmp/.../CLAUDE.md)`, exits 0. ✓
7. **`onboard --check --json`** → `{"success":true,"command":"onboard","action":"checked","file":"/tmp/.../CLAUDE.md","status":"current"}`. ✓

### Design notes

1. **`--stdout` vs `--json` precedence.** If both are passed, `--stdout` wins (runOnboard returns `{action: "stdout"}` before checking target files at all). The CLI returns early without emitting a JSON envelope. Acceptable edge case — it would be surprising behavior either way, and seeds doesn't test this combo.
2. **JSON envelope shape mirrors seeds.** `{success: true, command: "onboard", action, file?, status?}` — I use `"file" in result` and `"status" in result` as type guards inside the envelope builder so the discriminated union narrows correctly.
3. **Exit-code semantics for `--check`.** Only `missing` and `outdated` trigger `process.exitCode = 1`. `current` exits 0. This lets CI use `ticketbook onboard --check` as a freshness gate (`|| exit 1`).
4. **Regression test is the quiet win.** The old "writes AGENTS.md when absent" test tested a positive behavior — TKTB-073 deletes that behavior, so a naive removal would leave no coverage at all. Instead I flipped it into an assertion that init *does not* touch AGENTS.md. If a future change accidentally reintroduces AGENTS.md writing inside init, the test fires.

### Out of scope (handed off to TKTB-074)
- README updates (Task E)
- Deleting `.claude-plugin/plugin.json` + `.claude-plugin/` directory (Task E)
