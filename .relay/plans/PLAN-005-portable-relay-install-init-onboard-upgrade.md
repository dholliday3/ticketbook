---
id: PLAN-005
title: 'Portable relay — install, init, onboard, upgrade in any repo'
status: completed
tags:
  - distribution
  - packaging
  - release
  - agent-integration
  - init
  - onboard
project: relay
tasks:
  - TKTB-069
  - TKTB-070
  - TKTB-071
  - TKTB-073
  - TKTB-074
created: '2026-04-08T19:00:00.000Z'
updated: '2026-04-11T09:09:22.575Z'
---

# Portable relay — install, init, onboard, upgrade in any repo

> **Status:** completed (2026-04-11). All five phases shipped. Binary compiles cleanly, install.sh + release workflow are wired up, and `relay upgrade` works against the GH Releases API. The only remaining step is cutting a first `v0.1.0-rc.1` tag to exercise the release pipeline end-to-end — that's a git operation, not a code change, and sits outside the plan scope.

## Shipped (2026-04-11)

All five phases are in main. Commit chain from this session and the one before it:

| Phase | Description | Key commits |
|---|---|---|
| 0 | Seeds-inspired init/onboard split + project-named MCP + port auto-increment | `a2118f3`, `1ef2b6f`, `7eb2a82`, `834abf7`, `dd02ecb`, `00480bc` |
| 1 | `bun build --compile` with `with { type: "file" }` asset embedding (SKILL.md + 312 UI files) | `4c6a31a` |
| 2 | `.github/workflows/release.yml` cross-compiles 4 targets, uploads to GH Releases on tag push | `4e9058e` |
| 3 | `scripts/install.sh` + 36-test validation + README install section | `8827b5f` |
| 4 | `relay upgrade` / `--check` / `--json` with DI'd fetch + spawn | `74b78b4` |

**Validation:** typecheck clean across all packages; 366 unit tests pass (core + server + onboard + upgrade + version sync); 36 install.sh tests pass; `bun run build:binary` produces a 72 MB darwin-arm64 binary; end-to-end smoke tests of init, onboard, HTTP/UI mode, MCP mode all green from a compiled binary in `/tmp`.

**Out-of-scope but done anyway as cleanup:**
- `version.ts` as a single source of truth, read by both `relay upgrade` and the MCP handshake
- Version sync test in `upgrade.test.ts` catches package.json ↔ version.ts drift
- `.claude-plugin/plugin.json` deleted (Phase 0) + stray `AGENTS.md` dogfood file deleted (Claude Code still picks up `CLAUDE.md` + the project-level skill)

**What's left (not blocking plan closure):**
- Cut `v0.1.0-rc.1` to exercise the release workflow end-to-end. Requires pushing to origin + tag push. Not a code change.
- Once the first release exists, `relay upgrade --check` starts returning real data instead of the current 404-from-empty-releases error.

## Thesis

Two independent pieces have to work for a user on a fresh repo to go from zero to a working relay setup:

1. **A binary on their PATH.** Before this plan there wasn't one — the root `package.json` is `"private": true`, so `bunx relay` failed, and nothing produced a distributable artifact. Phases 1–3 solved this via `bun build --compile` + GitHub Releases cross-compile + `scripts/install.sh`.

2. **A clean per-project init/onboard layer.** The part we undercooked originally. `initRelay` existed and was well-tested, but it conflated data-layer scaffolding with agent instruction delivery, and the agent instructions were write-once-if-missing — any update to the recommended workflow silently failed to reach projects that already initialized. Studying seeds (`~/workspace/resources/seeds`) surfaced a clearly better pattern: split `init` from `onboard`, wrap agent instructions in versioned HTML-comment markers, and surgically replace the bracketed section on update.

Seeds solves the *distribution* half via npm publish, which does not transfer to relay — relay is a Bun workspace monorepo with `workspace:*` deps, a React UI bundle in `packages/ui/dist/`, SQLite, and the MCP SDK, which together are too heavy to ship as source the way seeds does. But seeds' init/onboard/upgrade patterns are **distribution-agnostic** and transferred directly.

The plan had five phases. Phase 0 is the seeds-inspired per-project layer + two small multi-repo UX improvements; it shipped without any binary work. Phases 1–3 are the compiled-binary path. Phase 4 adds `relay upgrade`. Each phase is independently shippable so nothing gated on the binary rabbit hole.

## Scope boundaries (what this plan is NOT)

- **Not a Claude Code plugin marketplace path.** `.claude-plugin/plugin.json` was deleted in Phase 0 — `.mcp.json` auto-loading + project-level skills at `.claude/skills/relay/SKILL.md` cover Claude Code without a plugin. A plugin would be a second, duplicative path to the same outcome since relay is inherently per-project (the MCP server has to be pointed at the current repo's `.tasks/`/`.plans/`/`.docs/`, so "install once globally and forget" doesn't actually save steps).
- **Not an npm publish path.** Monorepo + `workspace:*` + UI bundle + heavy deps make the seeds-style "ship source as-is to npm" route infeasible without major restructuring. Binary distribution is the chosen path.
- **Not a branded install URL** (relay.ai, relay.dev) — deferred.
- **Not Windows support** for install (install.ps1, install.cmd) — deferred.
- **Not SLSA build provenance attestations** — overkill for v1.
- **Not a Codex plugin packaging story.**
- **Not a workspace switcher UI** (one long-running server, dropdown across known repos). **Explicitly scrapped** per user direction — not worth the redesign complexity. Deterministic `4242+N` auto-increment (Phase 0 Task D) is the answer for multi-repo UI.

## Multi-repo model (how relay actually runs across repos)

Worth stating explicitly because it shaped several Phase 0 decisions:

- **Each Claude Code session spawns its own MCP subprocess** scoped to that session's cwd. The `.mcp.json` entry deliberately omits `cwd`, so the spawned process inherits Claude Code's cwd (the repo root) and uses `findTasksDirWithWorktree(process.cwd())` to self-discover the target `.tasks/`. One repo = one MCP subprocess per active session.
- **Worktree coordination is free.** `findTasksDirWithWorktree` redirects to the main repo's artifacts when invoked from a worktree, so parallel agents in different worktrees of the same repo share task state automatically.
- **Cross-repo aggregation is explicitly out of scope.** An agent in projA cannot see projB's tasks. Local-first per-project is the design, not a limitation to fix.
- **The UI side used to be less clean than the MCP side.** Before Phase 0 Task D, each `relay` invocation started a separate HTTP server on a random port. Now it's deterministic auto-increment starting at 4242. A follow-up (TKTB-072, backlog) would persist the chosen port per-repo so launch order doesn't affect which repo gets which port — not landed, intentionally, until real daily use surfaces the pain.

## What's already in place (pre-PLAN-005 baseline)

- `bin/relay.ts` is the single entry point for CLI, server, and MCP modes
- `skills/relay/SKILL.md` is the canonical source of truth for the agent skill
- `initRelay` in `packages/core/src/init.ts` scaffolds `.tasks/`, `.plans/`, `.docs/`, `.config.yaml`, `.counter`, `.mcp.json`, `.claude/skills/relay/SKILL.md`, `.agents/skills/relay/SKILL.md`, and `.gitignore` entries — idempotent, covered by 16 tests in `init.test.ts`
- Dev-mode detection in `init.ts` correctly dogfoods against the relay source repo (writes `bun bin/relay.ts --mcp` instead of the published command)
- `packages/ui/dist/` builds cleanly via `bun --filter @relay/ui build`
- MCP server (stdio + HTTP modes) works end-to-end inside the source repo

## Phases (all complete)

### Phase 0 — Seeds-inspired init/onboard + multi-repo UX ✅

Shipped independently of any binary work. Goal: make the per-project init/onboard layer feel right *and* clean up the two rough edges that show up as soon as you run relay across multiple repos, before any of this got frozen into a shipped binary.

Work chunks — each shipped as its own TKTB:

- **TKTB-069** — `packages/core/src/markers.ts` + `packages/core/src/onboard.ts` + tests. Ports seeds' marker-wrapping primitives (`hasMarkerSection`, `replaceMarkerSection`, `wrapInMarkers`) and builds `runOnboard` on top with three-state detection (missing/current/outdated) + `--check` / `--stdout` modes.
- **TKTB-070** — Project-named MCP server. `.tasks/.config.yaml` gains an optional `name` field (auto-populated from `basename(projectRoot)` at init); `packages/server/src/mcp.ts` reads it via `resolveMcpServerName` and suffixes the MCP handshake name as `relay-<name>`. Falls back to plain `"relay"` when absent or malformed.
- **TKTB-071** — UI server port auto-increment. `bin/relay.ts` defaults to 4242 and auto-increments on `EADDRINUSE` via `bindWithIncrementUsing<S>(tryBind, start, maxTries)` — a generic callback-style binder that preserves WebSocket type narrowing (smarter than an options-splat). Explicit `--port <N>` bypasses the retry loop.
- **TKTB-073** — Split init from onboard at the CLI layer. Delete `AGENTS_MD_CONTENT` + `writeAgentsMd` from `init.ts`; wire the `onboard` subcommand into `bin/relay.ts` with `--check` / `--stdout` / `--json` flags.
- **TKTB-074** — README rewrite + `.claude-plugin/plugin.json` deletion.

### Phase 1 — Standalone binary ✅

`bun build --compile` with `with { type: "file" }` import attributes for asset embedding. SKILL.md is a single import in `bin/relay.ts`; the 312-file `packages/ui/dist/` gets generated into `packages/server/src/embedded-ui.gen.ts` by `scripts/generate-embedded-ui.ts` before compile and reset to an empty stub after (via a `trap ... EXIT` in `scripts/build-binary.sh` so failed builds never leak).

Shipped: `4c6a31a PLAN-005 Phase 1: compile relay to a standalone binary`

Key technical wins:
- **Bun's `with { type: "file" }` works identically in dev and compiled binary**, so there's zero runtime mode detection anywhere in the code
- **SPA fallback embedded-first, filesystem-fallback** for `tryServeStatic` means dev mode behavior is byte-identical to before
- `PUBLISHED_MCP_ENTRY` flipped from `bunx relay` to `relay` (the binary is on PATH after install.sh)
- 5 dynamic `await import()` calls in `bin/relay.ts` converted to static imports so `--compile` can bundle them
- 72 MB darwin-arm64 binary, ~200ms compile after the vite build

### Phase 2 — Cross-compile + GitHub Releases ✅

`.github/workflows/release.yml` with three jobs: **test** (typecheck + `bun test` + install-script tests), **build** (4 targets via Bun's `--target` from a single ubuntu-latest runner, SHA256 alongside each), **release** (download artifacts, create GitHub Release with auto-prerelease on tags containing `-`). Narrow permissions (no OIDC/attestations). Action SHAs pinned with version comments.

Cross-compile validated locally macOS → Linux x64 before commit (108 MB Linux binary).

Shipped: `4e9058e PLAN-005 Phase 2: GH Actions cross-compile + release workflow`

### Phase 3 — `scripts/install.sh` + README ✅

curl one-liner installer modeled after plannotator's install.sh, stripped to relay's surface area. OS/arch detection, version resolution via GH Releases API, SHA256 verification, install to `~/.local/bin/relay`, PATH warning, global skill install via git sparse-checkout (`skills/relay/` → `~/.claude/skills/relay/` + `~/.agents/skills/relay/`).

36 tests in `scripts/install.test.ts` covering static structure + arg parsing behavior (spawns `bash install.sh --help`, `--version` with missing arg, unknown flag, etc). Wired into a new `test:install` package.json script and invoked separately in CI because `bunfig.toml` scopes `bun test` root to `packages/` only.

README rewritten with a new "Install" section above Quick Start + an "Upgrade" section.

Shipped: `8827b5f PLAN-005 Phase 3: install.sh + README install section`

### Phase 4 — `relay upgrade` ✅

`packages/core/src/upgrade.ts` with `runUpgrade({check?, fetch?, spawn?})` — three-branch dispatch (`checked` / `unchanged` / `upgraded`), DI'd fetch + spawn for testability. Uses `node:child_process.spawnSync` rather than `Bun.spawnSync` so the module stays core-portable. Default spawn runs `curl -fsSL <install-sh-url> | bash` with inherited stdio so the user sees install.sh's progress.

`packages/core/src/version.ts` is the single source of truth for the installed version; `upgrade.test.ts` has a sync test that fires if `version.ts` and `packages/core/package.json` drift.

CLI wrapping in `bin/relay.ts` has a try/catch so the pre-first-release 404 surfaces as a one-line error (`relay upgrade failed: Failed to fetch latest release from GitHub: 404 Not Found`) rather than a stack trace, in both plain and JSON modes.

14 unit tests for upgrade + 1 version sync test. All zero-network via DI'd fetch.

Shipped: `74b78b4 PLAN-005 Phase 4: relay upgrade command`

## Open questions (resolved during implementation)

- **Skill / UI asset embedding:** Answer — `with { type: "file" }` import attributes, both for SKILL.md (direct import) and for the 312-file UI dist (generated module + stub-reset pattern). No extract-on-first-run cache needed. Decided in Phase 1.
- **SQLite under `--compile`:** Verified — works for both `:memory:` and file-based DBs. 15-minute spike during Phase 1.
- **Versioning scheme:** Strict semver (`v0.1.0`, `v0.1.0-rc.1`). The release workflow auto-marks tags containing `-` as prereleases.
- **`ONBOARD_VERSION` source of truth:** Hand-bumped constant in `onboard.ts` with a prominent comment. Revisit if it drifts.
- **Exposing project name in MCP tool responses:** Deferred — agents already know the project from session context, adding it to every tool response is noisy. Revisit if cross-repo agent flows become a thing.
- **Binary size:** 72 MB darwin-arm64, 108 MB linux-x64. Matches plannotator's scale. Not blocking.

## Risks (as seen in retrospect)

- **Phase 1 was not actually the rabbit hole** — Bun's `with { type: "file" }` turned out to be a much simpler primitive than plannotator's `vite-plugin-singlefile`-based approach, and it composed cleanly with the generated-module pattern for multi-file dists. The rabbit-hole budget wasn't needed.
- **Phase 0 scope creep was avoided** — Task F (pinned-per-repo UI port) stayed in backlog as planned; nothing else sneaked in.
- **Marker name collision risk** — no observed collisions; the `<!-- relay:start -->` / `<!-- relay:end -->` delimiters are distinctive enough.
- **Config schema churn** — back-compat tested explicitly in TKTB-070; pre-existing `.config.yaml` without `name` keeps working.

## Related

- **PLAN-007** — Relay wrap-up (this plan fulfills PLAN-007 Phase 5)
- **TKTB-072** — Pin UI port per-repo in `.tasks/.config.yaml`. Backlog follow-up to Phase 0. Intentionally not promoted — the backing design ("persist the chosen port so launch order doesn't swap them") needs real daily-use pain to validate.
- **Seeds reference files driving Phase 0:**
  - `~/workspace/resources/seeds/src/markers.ts` — lifted verbatim
  - `~/workspace/resources/seeds/src/commands/onboard.ts` — model for three-state detection + candidate file walk
  - `~/workspace/resources/seeds/src/commands/init.ts` — `basename(cwd)` project-name pattern
  - `~/workspace/resources/seeds/src/commands/upgrade.ts` — model for Phase 4
- **Plannotator reference files driving Phase 1–3:**
  - `~/workspace/resources/plannotator/.github/workflows/release.yml` — cross-compile + upload pattern
  - `~/workspace/resources/plannotator/scripts/install.sh` — installer structure (stripped for relay)
  - `~/workspace/resources/plannotator/apps/hook/server/index.ts` — `with { type: "text" }` embed reference (relay uses `file` instead because of multi-file dist)
