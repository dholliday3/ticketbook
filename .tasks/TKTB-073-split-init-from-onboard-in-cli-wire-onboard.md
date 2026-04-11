---
id: TKTB-073
title: Split init from onboard in CLI + wire onboard subcommand
status: backlog
priority: high
tags:
  - phase-0
  - onboard
  - init
  - packaging
project: ticketbook
blockedBy:
  - TKTB-069
created: '2026-04-11T07:06:47.203Z'
updated: '2026-04-11T07:06:47.203Z'
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
