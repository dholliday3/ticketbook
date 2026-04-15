---
id: TKTB-070
title: Project-named MCP server (suffix by .tasks/.config.yaml name field)
status: done
priority: medium
tags:
  - phase-0
  - mcp
  - packaging
project: relay
assignee: claude-opus
created: '2026-04-11T07:05:25.769Z'
updated: '2026-04-11T07:29:22.854Z'
---

Give each relay MCP server instance a per-project name derived from the repo directory, so multi-repo setups have distinguishable MCP identities for debugging. Pattern lifted from seeds' `config.yaml` approach (`seeds/src/commands/init.ts:24`).

Part of PLAN-005 Phase 0. Independent of Tasks A/B/D/E — touches different files, can run in parallel.

## Why

Today every relay MCP server identifies as plain `"relay"` at handshake time. In multi-repo setups, `claude mcp list` and error messages can't distinguish which repo's server you're looking at. Adding a `relay-<project>` suffix is a small, low-risk change with meaningful debug clarity.

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

Update the config-write block in `initRelay` (around line 257):
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
const serverName = projectName ? `relay-${projectName}` : "relay";
new Server({ name: serverName, version: VERSION });
```

If the config file is missing or fails to parse, fall back to plain `"relay"` — **no throwing**. Log a warning to stderr if you want, but don't break the server.

### Tests

- `packages/core/src/config.test.ts` — add a test that `name` parses correctly, and that absence yields `undefined` (not `""`)
- `packages/core/src/init.test.ts` — extend the "creates `.tasks/`…" test (around line 48) to assert the config file contains `name: "<basename of tmpdir>"`
- `packages/server/src/mcp.test.ts` — verify the Server is instantiated with `relay-<name>` when config has `name`, and plain `relay` when it doesn't. If mcp.test.ts doesn't exist, create it with minimal scaffolding.

## Out of scope
- Exposing the project name in MCP tool responses (e.g., `project` field on `list_tasks` output). Explicitly skipped — Open Questions in PLAN-005 discusses and rejects this for v1.
- Runtime config reloading. If the user edits `.config.yaml` the server needs a restart — acceptable for v1.
- Pinning a UI port in the same config file — that's Task F (backlog).

## Acceptance
- New init in a dir named `foo` produces `.tasks/.config.yaml` with `name: "foo"`
- MCP server started in that dir declares itself as `"relay-foo"` at handshake (verify via a spawn + initialize round-trip)
- MCP server started in a dir whose `.config.yaml` has no `name` field still starts and declares itself as plain `"relay"` (back-compat)
- All tests pass (`bun test`)
- `bun run typecheck` clean

<!-- agent-notes -->

## claude-opus implementation + claude-code review — 2026-04-11

**Done.** Implemented by claude-opus in the shared working tree; claude-code reviewed, validated, and committed.

### Shipped
- **`packages/core/src/schema.ts`** — `RelayConfigSchema` gains an optional `name: z.string().optional()` field with a good JSDoc explaining the intent (lines 82-89).
- **`packages/core/src/init.ts:261-271`** — On first init, writes `name: "${basename(baseDir)}"` alongside the existing prefix/delete-mode config lines. On re-init of an existing config, leaves it alone (back-compat for projects initialized before this change).
- **`packages/server/src/mcp.ts:148-160`** — New exported `resolveMcpServerName(tasksDir): Promise<string>` function. Reads via `getConfig()`, returns `relay-<name>` when `cfg.name` is non-empty, falls back to plain `"relay"` on any error (including missing file, malformed YAML, empty name). **Never throws** — logs a `[relay-mcp]` warning to stderr and falls back cleanly. Bad config must not block server boot.
- **`packages/server/src/mcp.ts:162-171`** — `startMcpServer` now calls `resolveMcpServerName(tasksDir)` and passes the result as `name` to the `new McpServer({...})` constructor.
- **`packages/server/src/mcp.test.ts`** (new file) — 5 tests covering: name present → suffixed name; name absent → plain `relay`; missing config file → plain `relay`; malformed YAML → plain `relay` (plus stderr warning); empty-string name → plain `relay`.
- **`packages/core/src/config.test.ts:42-56`** — New tests: `name` parses when present, `name` is `undefined` (not `""`) when absent.
- **`packages/core/src/init.test.ts:69`** — Existing "creates .tasks/ .plans/ .docs/ with config and counters" test extended to assert the config file contains `name: "<basename of dir>"`.

### Validation
- `bun test` → **318 pass / 0 fail / 645 expect() calls** across 28 files. Includes new mcp.test.ts, new config.test.ts assertions, and the extended init.test.ts.
- `bun run typecheck` → all packages clean (`core`, `server`, `ui`, `e2e`).
- One benign stderr line during mcp.test.ts ("malformed yaml" test case) — that's the expected fallback warning, not a test failure.

### Review notes
- **Empty-string guard is correct.** `cfg.name && cfg.name.trim().length > 0` in `resolveMcpServerName` catches both `undefined` and `""` cases, matching the test in `mcp.test.ts` that asserts empty name falls back to plain `relay`. Good defensive coding.
- **Warning goes to stderr, not stdout.** Important for MCP mode where stdout is the JSON-RPC transport — any log there would corrupt the protocol. Correct choice.
- **Back-compat for existing projects is real.** Pre-existing `.config.yaml` files without a `name` field keep working because (a) init doesn't clobber them, and (b) `resolveMcpServerName` falls back gracefully. Verified by the `init.test.ts` idempotent test.

### Minor notes for future work
- The JSDoc on `resolveMcpServerName` says "Falls back to plain `"relay"` when the config is missing, unparseable, or has no `name`". The code handles one more case (empty-string `name`) that the JSDoc doesn't mention. Non-blocking. A future small refactor could align the doc with the empty-string test case.
- Follow-up Task F (TKTB-072) will build on this — it piggybacks on the same config schema to persist a `uiPort` field.
