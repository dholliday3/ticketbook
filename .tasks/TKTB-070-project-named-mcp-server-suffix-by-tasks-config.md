---
id: TKTB-070
title: Project-named MCP server (suffix by .tasks/.config.yaml name field)
status: open
priority: medium
tags:
  - phase-0
  - mcp
  - packaging
project: ticketbook
created: '2026-04-11T07:05:25.769Z'
updated: '2026-04-11T07:05:25.769Z'
---

Give each ticketbook MCP server instance a per-project name derived from the repo directory, so multi-repo setups have distinguishable MCP identities for debugging. Pattern lifted from seeds' `config.yaml` approach (`seeds/src/commands/init.ts:24`).

Part of PLAN-005 Phase 0. Independent of Tasks A/B/D/E — touches different files, can run in parallel.

## Why

Today every ticketbook MCP server identifies as plain `"ticketbook"` at handshake time. In multi-repo setups, `claude mcp list` and error messages can't distinguish which repo's server you're looking at. Adding a `ticketbook-<project>` suffix is a small, low-risk change with meaningful debug clarity.

## Changes

### `.tasks/.config.yaml` schema

Add an optional `name` field. Check `packages/core/src/config.ts` (or wherever the config schema/parser lives — see `packages/core/src/config.test.ts` for the current shape) and extend it to parse and validate `name: string | undefined`.

New config shape:
```yaml
name: projA          # NEW — optional, project identifier for MCP server naming
prefix: TASK
planPrefix: PLAN
docPrefix: DOC
deleteMode: archive
```

### `packages/core/src/init.ts`

At init time, auto-populate `name` from `basename(baseDir)`. Reference: seeds does this at `~/workspace/resources/seeds/src/commands/init.ts:24`.

Update the config-write block in `initTicketbook` (around line 257):
```ts
const projectName = basename(baseDir);
await writeFile(
  configPath,
  `name: "${projectName}"\nprefix: TASK\nplanPrefix: PLAN\ndocPrefix: DOC\ndeleteMode: archive\n`,
  "utf-8",
);
```

**Back-compat:** if an existing `.config.yaml` has no `name` field (pre-existing projects), leave it alone on re-init. The MCP server's fallback logic handles absence.

### `packages/server/src/mcp.ts`

At MCP server startup inside `startMcpServer`, read the config file for the `name` field, then construct the server name:

```ts
const config = loadConfig(tasksDir); // or whatever the existing config loader is called
const projectName = config.name;
const serverName = projectName ? `ticketbook-${projectName}` : "ticketbook";
new Server({ name: serverName, version: VERSION });
```

If the config file is missing or fails to parse, fall back to plain `"ticketbook"` — **no throwing**. Log a warning to stderr if you want, but don't break the server.

### Tests

- `packages/core/src/config.test.ts` — add a test that `name` parses correctly, and that absence yields `undefined` (not `""`)
- `packages/core/src/init.test.ts` — extend the "creates `.tasks/`…" test (around line 48) to assert the config file contains `name: "<basename of tmpdir>"`
- `packages/server/src/mcp.test.ts` — verify the Server is instantiated with `ticketbook-<name>` when config has `name`, and plain `ticketbook` when it doesn't. If mcp.test.ts doesn't exist, create it with minimal scaffolding.

## Out of scope
- Exposing the project name in MCP tool responses (e.g., `project` field on `list_tasks` output). Explicitly skipped — Open Questions in PLAN-005 discusses and rejects this for v1.
- Runtime config reloading. If the user edits `.config.yaml` the server needs a restart — acceptable for v1.
- Pinning a UI port in the same config file — that's Task F (backlog).

## Acceptance
- New init in a dir named `foo` produces `.tasks/.config.yaml` with `name: "foo"`
- MCP server started in that dir declares itself as `"ticketbook-foo"` at handshake (verify via a spawn + initialize round-trip)
- MCP server started in a dir whose `.config.yaml` has no `name` field still starts and declares itself as plain `"ticketbook"` (back-compat)
- All tests pass (`bun test`)
- `bun run typecheck` clean
