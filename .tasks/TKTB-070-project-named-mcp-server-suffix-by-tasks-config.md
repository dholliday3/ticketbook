---
id: TKTB-070
title: Project-named MCP server (suffix by .tasks/.config.yaml name field)
status: done
priority: medium
tags:
  - phase-0
  - mcp
  - packaging
project: ticketbook
assignee: claude-opus
created: '2026-04-11T07:05:25.769Z'
updated: '2026-04-11T07:22:18.763Z'
---

Give each ticketbook MCP server instance a per-project name derived from the repo directory, so multi-repo setups have distinguishable MCP identities for debugging. Pattern lifted from seeds' `config.yaml` approach (`seeds/src/commands/init.ts:24`).

Part of PLAN-005 Phase 0. Independent of Tasks A/B/D/E — touches different files, can run in parallel.

## Why

Today every ticketbook MCP server identifies as plain `"ticketbook"` at handshake time. In multi-repo setups, `claude mcp list` and error messages can't distinguish which repo's server you're looking at. Adding a `ticketbook-<project>` suffix is a small, low-risk change with meaningful debug clarity.

## Acceptance
- New init in a dir named `foo` produces `.tasks/.config.yaml` with `name: "foo"` ✅
- MCP server started in that dir declares itself as `"ticketbook-foo"` at handshake ✅
- MCP server started in a dir whose `.config.yaml` has no `name` field still starts and declares itself as plain `"ticketbook"` (back-compat) ✅
- All tests pass (`bun test`) ✅ 318/318
- `bun run typecheck` clean ✅

<!-- agent-notes -->
## Debrief (claude-opus)

**Implementation:**
- `packages/core/src/schema.ts` — added optional `name: z.string().optional()` to `TicketbookConfigSchema` (with a doc comment explaining usage).
- `packages/core/src/init.ts` — imported `basename`, auto-populate `name` from `basename(baseDir)` when writing a fresh `.config.yaml`. Existing configs are left untouched (the idempotency check at line 258 already handles back-compat).
- `packages/server/src/mcp.ts` — extracted `resolveMcpServerName(tasksDir)` as an exported helper so it's directly testable. It loads the config via the existing `getConfig` loader, returns `ticketbook-<name>` when present, and falls back to `"ticketbook"` on any failure (missing file, parse error, empty string). Parse errors log a warning to stderr but never throw.

**Tests added:**
- `packages/core/src/schema.test.ts` — two tests covering `name` present vs. absent in the schema.
- `packages/core/src/config.test.ts` — two tests for the `getConfig` round-trip: `name` is read when present, `undefined` (not `""`) when absent.
- `packages/core/src/init.test.ts` — asserted the new config file contains `name: "<basename>"`, and added a dedicated back-compat test that writes a pre-0.x config without `name` and confirms init leaves it alone.
- `packages/server/src/mcp.test.ts` — new file with 5 tests for `resolveMcpServerName` (present, absent, missing file, malformed YAML, empty-string name).

**Acceptance validation (end-to-end):**
- `ticketbook init` in a dir called `foo` wrote `name: "foo"` to `.tasks/.config.yaml`.
- Spawned `ticketbook --mcp` in that dir, sent an `initialize` request over stdio, and the response was `"serverInfo":{"name":"ticketbook-foo","version":"0.1.0"}`.
- Planted a bare `.config.yaml` without a `name` field and confirmed the handshake returned `"name":"ticketbook"` (no crash).

**Out of scope (per ticket):** no `project` field on MCP tool responses, no runtime config reloading, no port pinning (that's Task F).
