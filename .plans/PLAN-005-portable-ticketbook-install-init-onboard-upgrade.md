---
id: PLAN-005
title: 'Portable ticketbook — install, init, onboard, upgrade in any repo'
status: active
tags:
  - distribution
  - packaging
  - release
  - agent-integration
  - init
  - onboard
project: ticketbook
tasks:
  - TKTB-069
  - TKTB-070
  - TKTB-071
  - TKTB-073
  - TKTB-074
created: '2026-04-08T19:00:00.000Z'
updated: '2026-04-11T07:07:34.898Z'
---

# Portable ticketbook — install, init, onboard, upgrade in any repo

> **Status:** active. Plan for making ticketbook installable AND properly onboardable in any arbitrary repo. Expanded from the original PLAN-005 (compiled binary only) to add a Phase 0 for seeds-inspired init/onboard improvements that ship independently of any binary work. Claude Code plugin marketplace path is explicitly dropped — project-level `.mcp.json` auto-loading + project-level skills cover the full Claude Code integration story without a plugin.

## Thesis

Two independent pieces have to work for a user on a fresh repo to go from zero to a working ticketbook setup:

1. **A binary on their PATH.** Today there isn't one — the root `package.json` is `"private": true`, so `bunx ticketbook` fails, and nothing produces a distributable artifact. The original PLAN-005 (Phases 1–3 below) solves this via `bun build --compile` + GitHub Releases cross-compile + `scripts/install.sh`. That approach is still correct.

2. **A clean per-project init/onboard layer.** This is the part we undercooked. `initTicketbook` in `packages/core/src/init.ts` exists and is well-tested (16 tests), but it conflates data-layer scaffolding with agent instruction delivery, and the agent instructions are write-once-if-missing — any update to the recommended workflow silently fails to reach projects that already initialized. Studying seeds (`~/workspace/resources/seeds`) surfaced a clearly better pattern: split `init` from `onboard`, wrap agent instructions in versioned HTML-comment markers, and surgically replace the bracketed section on update.

Seeds solves the *distribution* half via npm publish, which does not transfer to ticketbook — ticketbook is a Bun workspace monorepo with `workspace:*` deps, a React UI bundle in `packages/ui/dist/`, SQLite, and the MCP SDK, which together are too heavy to ship as source the way seeds does. But seeds' init/onboard/upgrade patterns are **distribution-agnostic** and transfer directly. Stealing them is cheap, high-value, and doesn't block or depend on the binary work.

The resulting plan has four phases. Phase 0 is the seeds-inspired per-project layer + two small multi-repo UX improvements, and ships without any binary work. Phases 1–3 are the original compiled-binary path. Phase 4 adds `ticketbook upgrade` once there's an install mechanism to upgrade *from*. Each phase is independently shippable so we don't gate everything on the binary rabbit hole.

## Scope boundaries (what this plan is NOT)

- **Not a Claude Code plugin marketplace path.** `.claude-plugin/plugin.json` will be deleted — `.mcp.json` auto-loading + project-level skills at `.claude/skills/ticketbook/SKILL.md` cover Claude Code without a plugin. A plugin would be a second, duplicative path to the same outcome since ticketbook is inherently per-project (the MCP server has to be pointed at the current repo's `.tasks/`/`.plans/`/`.docs/`, so "install once globally and forget" doesn't actually save steps).
- **Not an npm publish path.** Monorepo + `workspace:*` + UI bundle + heavy deps make the seeds-style "ship source as-is to npm" route infeasible without major restructuring. Binary distribution is the chosen path.
- **Not a branded install URL** (ticketbook.ai, ticketbook.dev) — deferred.
- **Not Windows support** for install (install.ps1, install.cmd) — deferred.
- **Not SLSA build provenance attestations** — overkill for v1.
- **Not a Codex plugin packaging story.**
- **Not a workspace switcher UI** (one long-running server, dropdown across known repos). Cleaner ultimate answer for multi-repo UI, but a real redesign — filed for later.

## Multi-repo model (how ticketbook actually runs across repos)

Worth stating explicitly because it shapes several Phase 0 decisions:

- **Each Claude Code session spawns its own MCP subprocess** scoped to that session's cwd. The `.mcp.json` entry deliberately omits `cwd`, so the spawned process inherits Claude Code's cwd (the repo root) and uses `findTasksDirWithWorktree(process.cwd())` to self-discover the target `.tasks/`. One repo = one MCP subprocess per active session.
- **Worktree coordination is free.** `findTasksDirWithWorktree` redirects to the main repo's artifacts when invoked from a worktree, so parallel agents in different worktrees of the same repo share task state automatically.
- **Cross-repo aggregation is explicitly out of scope.** An agent in projA cannot see projB's tasks. Local-first per-project is the design, not a limitation to fix.
- **The UI side is less clean than the MCP side.** Each `ticketbook` invocation starts a separate HTTP server on a separate port. Phase 0 addresses this with deterministic port auto-increment starting at 4242. A longer-term fix (pinned-per-repo ports) is filed as a follow-up task, not Phase 0 scope.

## What's already in place

- `bin/ticketbook.ts` is the single entry point for CLI, server, and MCP modes
- `skills/ticketbook/SKILL.md` is the canonical source of truth for the agent skill
- `initTicketbook` in `packages/core/src/init.ts` scaffolds `.tasks/`, `.plans/`, `.docs/`, `.config.yaml`, `.counter`, `.mcp.json`, `.claude/skills/ticketbook/SKILL.md`, `.agents/skills/ticketbook/SKILL.md`, `AGENTS.md`, and `.gitignore` entries — idempotent, covered by 16 tests in `init.test.ts`
- Dev-mode detection in `init.ts:115` correctly dogfoods against the ticketbook source repo (writes `bun bin/ticketbook.ts --mcp` instead of `bunx ticketbook --mcp`)
- `packages/ui/dist/` builds cleanly via `bun --filter @ticketbook/ui build`
- MCP server (stdio + HTTP modes) works end-to-end inside the source repo

## What's missing

### Per-project init/onboard layer (addressed in Phase 0)
- Agent instructions (`AGENTS_MD_CONTENT` at `packages/core/src/init.ts:51`) are baked into `AGENTS.md` as a whole file and written only when missing — no way to update them after a workflow change
- No cooperation with existing `CLAUDE.md` or `.claude/CLAUDE.md` files — ticketbook ignores them and writes `AGENTS.md` regardless
- No way to refresh just the agent instructions independently of data scaffolding
- No `--check` / `--stdout` modes for dry-run or CI verification of onboarding state

### Multi-repo UX (addressed in Phase 0)
- All ticketbook MCP server instances identify as plain `"ticketbook"` at handshake — indistinguishable across repos in logs, `claude mcp list`, or debugging
- `.tasks/.config.yaml` has no project name field to derive the MCP server identity from
- `bin/ticketbook.ts` HTTP server mode binds to port `0` (OS-assigned random port) → each repo's UI ends up at an unpredictable `localhost:<random>` address

### Binary distribution (addressed in Phases 1–3)
- No binary compilation pipeline — nothing produces distributable artifacts
- No GitHub Releases workflow (no `.github/` directory exists at all)
- No `scripts/install.sh`
- `PUBLISHED_MCP_ENTRY` in `packages/core/src/init.ts:90` still writes `bunx ticketbook`, which fails because the package is `"private": true`

### Self-update (addressed in Phase 4)
- No `ticketbook upgrade` command — once installed, users have to remember how they installed it

## Phases

### Phase 0 — Seeds-inspired init/onboard + multi-repo UX

**Ships independently of any binary work.** Goal: make the per-project init/onboard layer feel right *and* clean up the two rough edges that show up as soon as you run ticketbook across multiple repos, before any of this gets frozen into a shipped binary. All "seeds" references below mean `~/workspace/resources/seeds`.

**Work chunks:** broken into six tasks linked to this plan. See PLAN-005 linked tasks for the full breakdown. Tasks A→B→E form a chain (primitives, then CLI wiring, then docs). Tasks C (MCP naming) and D (port auto-increment) are independent and can run in parallel. Task F (pinned-per-repo port) is a backlog follow-up.

#### Seeds-inspired init/onboard split

- [ ] **Add `packages/core/src/markers.ts`** — port seeds' `START_MARKER` / `END_MARKER` / `hasMarkerSection` / `replaceMarkerSection` / `wrapInMarkers` helpers verbatim from `seeds/src/markers.ts` (~20 lines). Use `<!-- ticketbook:start -->` / `<!-- ticketbook:end -->` as the delimiters. *(Task A)*

- [ ] **Add `packages/core/src/onboard.ts`** with a new `runOnboard` function that: *(Task A)*
  - Reads an `ONBOARD_VERSION` constant (start at `1`, see Open questions for rationale)
  - Emits a versioned sub-marker like `<!-- ticketbook-onboard-v:${ONBOARD_VERSION} -->` inside the wrapped section
  - Walks a candidate file list `["CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md"]` — first hit wins; if none exist, create `CLAUDE.md` at project root
  - Three-state detection: `missing` / `current` / `outdated`
  - Four actions: create (no file), no-op (current), replace via `replaceMarkerSection` (outdated), append (missing section in existing file)
  - Supports `--check` mode (report status only, exit 1 if stale) and `--stdout` mode (print what would be written, don't touch files)
  - Returns a structured `{ action, file, status }` result for testing

- [ ] **Move `AGENTS_MD_CONTENT` from `init.ts:51` into `onboard.ts`** and reshape it as a section (heading + body — no file-level framing). *(Task B)*

- [ ] **Shrink `initTicketbook`:** remove `writeAgentsMd` + `wroteAgentsMd` from the result; keep everything else. Update `printInitSummary` to drop the `AGENTS.md` line and append a "Next: run `ticketbook onboard`" hint. *(Task B)*

- [ ] **Add `onboard` subcommand to `bin/ticketbook.ts`** with `--check`, `--stdout`, `--json` flags. *(Task B)*

- [ ] **Tests:** delete `wroteAgentsMd` assertions from `init.test.ts`; add `packages/core/src/onboard.test.ts` mirroring seeds' test shape (create / find-existing / candidate-preference / append-to-existing-file / no-op-on-current / surgical-replace-preserves-outside-content / `--check` exit code / `--stdout` prints without touching files); add trivial `markers.test.ts`. *(Task A + Task B)*

#### Multi-repo UX

- [ ] **Project-named MCP server.** Add a `name` field to `.tasks/.config.yaml` (auto-populate from `basename(projectRoot)` at init time — mirrors seeds' `init.ts:24` pattern). Read it in `packages/server/src/mcp.ts` startup and use it as a suffix: `ticketbook-<name>`. Fall back to plain `"ticketbook"` when the field is absent (back-compat for pre-existing installs). Tests: config parse, init writes name, MCP handshake uses suffixed name, fallback works. *(Task C)*

- [ ] **UI server port auto-increment.** Default start port `4242` when no `--port` is passed (matches `bun dev` already). Wrap `Bun.serve()` in a bind-with-retry helper that catches `EADDRINUSE` and increments up to 100 attempts. Preserve hard-fail on explicit `--port <N>` (user opted in to a specific port, don't silently reassign). Log which ports were in use when auto-increment kicks in so the user understands the outcome. Tests: binds 4242 when free / 4243 when 4242 is held / throws after 100 attempts / explicit port does not retry. *(Task D)*

#### Docs + cleanup

- [ ] **Update README:** document `ticketbook init` (data layer) and `ticketbook onboard` (agent layer) as two separate commands. Document `--check` / `--stdout`. Remove any reference to `init` writing `AGENTS.md`. *(Task E)*

- [ ] **Delete `.claude-plugin/plugin.json`** and remove empty `.claude-plugin/` dir. *(Task E)*

**Acceptance:**
- `bun bin/ticketbook.ts init` in a fresh temp dir scaffolds `.tasks/`/`.plans/`/`.docs/` + config with a `name` field + `.mcp.json` + skill files + `.gitignore`, and does *not* write `AGENTS.md`
- `bun bin/ticketbook.ts onboard` in that same dir then writes a marker-wrapped CLAUDE.md with the agent instructions
- Re-running `onboard` after bumping `ONBOARD_VERSION` surgically replaces the bracketed region — content outside the markers byte-identical
- `onboard --check` reports correct status and exits 1 when stale; `onboard --stdout` prints the wrapped snippet without touching files
- Two concurrent `bun bin/ticketbook.ts` instances in different repos bind to 4242 and 4243 deterministically
- MCP server in a repo named `foo` declares itself as `ticketbook-foo` at handshake; falls back to `ticketbook` when `.config.yaml` has no `name`
- All of `bun test` passes

### Phase 1 — Produce a working compiled binary locally

Goal: a single-file `ticketbook-darwin-arm64` executable that runs `init`, `onboard`, `upgrade`, the HTTP/UI server, and MCP mode, all from the compiled binary. This phase surfaces the hard technical questions — skill embedding, UI asset bundling, SQLite — before we build anything around it. **Budget a full session; this is where the rabbit holes live.**

Reference: study `~/workspace/resources/plannotator/apps/hook` and its build scripts to see how they handle vite-built UI assets inside a `bun --compile` binary before re-deriving the answer.

- [ ] Add a `build:binary` script to root `package.json` that invokes `bun build bin/ticketbook.ts --compile --target=bun-darwin-arm64 --outfile dist/ticketbook-darwin-arm64`
- [ ] Decide how to embed `skills/ticketbook/SKILL.md` so `resolveSkillSourcePath()` in `bin/ticketbook.ts:103` finds it from inside the binary — options: Bun's `embeddedFiles` API, extract-on-first-init, or download from the release tag
- [ ] Decide how to embed the built UI assets (`packages/ui/dist/`) so HTTP server mode can serve them from inside the binary
- [ ] Verify SQLite works inside the compiled binary (`bun:sqlite` is part of Bun itself so should survive `--compile`, but must be verified with an actual read/write)
- [ ] Convert the dynamic imports in `bin/ticketbook.ts:190,201` (`await import("../packages/server/src/mcp.ts")`, `"../packages/server/src/index.ts"`) to static imports so they get bundled
- [ ] **Flip `PUBLISHED_MCP_ENTRY` in `packages/core/src/init.ts:90`** from `{command: "bunx", args: ["ticketbook", "--mcp"]}` to `{command: "ticketbook", args: ["--mcp"]}` — the binary will be on PATH after install.sh, so no bunx indirection is needed and the current command is dead-on-arrival because the package is `"private": true`. Update the `init.test.ts` assertions that currently expect `bunx`.
- [ ] Smoke test: build the binary, copy it to a fresh temp dir outside the repo, run `./ticketbook-darwin-arm64 init --dir /tmp/smoke-test`, verify all scaffolded files
- [ ] Smoke test: run `./ticketbook-darwin-arm64 onboard` in the smoke-test dir, verify the CLAUDE.md section is written correctly with the marker wrapping
- [ ] Smoke test: run the binary in MCP mode from a foreign repo, verify MCP handshake (including the `ticketbook-<name>` suffix from Task C) and a tool call round-trip
- [ ] Smoke test: run the binary in HTTP mode, verify the UI loads, auto-increment binds 4242, and a task can be created end-to-end

**Acceptance:** A single darwin-arm64 binary copied anywhere on disk runs `init`, `onboard`, MCP mode, and HTTP/UI mode correctly against a foreign repo, with no reference to the original source tree at runtime.

### Phase 2 — Cross-compile and publish via GitHub Releases

Once the binary works on the local platform, wire up CI to cross-compile for all platforms and upload to GitHub Releases on tag push. Model after `~/workspace/resources/plannotator/.github/workflows/release.yml`.

- [ ] Add `.github/workflows/release.yml` triggered on `v*` tag pushes, with a `workflow_dispatch` dry-run input for testing
- [ ] Workflow stages: `test` (typecheck + `bun test`) → `build` (cross-compile for darwin-arm64, darwin-x64, linux-x64, linux-arm64) → `release` (upload binaries + `.sha256` files to the GitHub release)
- [ ] Use `ubuntu-latest` runners for cross-compilation (plannotator does this to avoid macOS cross-compile edge cases)
- [ ] Generate SHA256 checksums alongside each binary for install-time verification
- [ ] Scope the `build` job permissions to `contents: read` only — no OIDC or attestation permissions on PR dry-runs
- [ ] Test the workflow via a dry-run first, then cut a `v0.1.0-rc.1` test release and verify all expected assets land

**Acceptance:** Tag pushing `v0.1.0-rc.1` produces a GitHub release with four binaries + four `.sha256` files and no manual intervention.

### Phase 3 — Ship `scripts/install.sh`

The user-facing installer. Mirror plannotator's structure but strip everything ticketbook doesn't need: no Gemini/OpenCode/Pi branches, no SLSA attestation for v1, no Windows `.ps1` for v1.

- [ ] Create `scripts/install.sh` that detects OS/arch, resolves the latest release tag via GitHub's API, downloads the matching binary, verifies SHA256, and installs to `$HOME/.local/bin/ticketbook`
- [ ] Support `--version <tag>` for pinning, and a positional form (`install.sh v0.1.0`)
- [ ] Warn if `~/.local/bin` is not on PATH and print the shell-specific fix
- [ ] **Install the skill globally at `~/.claude/skills/ticketbook/SKILL.md` and `~/.agents/skills/ticketbook/SKILL.md`** via git sparse-checkout of `skills/` from the release tag (plannotator's pattern). Promoted from "optional" to "default" — the per-repo MCP model means agents in not-yet-init'd repos have no ticketbook awareness otherwise, and this is the cheap fix.
- [ ] Add `scripts/install.test.ts` with basic argument parsing and OS detection coverage (plannotator has one; copy the structure)
- [ ] Update the README "Install" section with the curl one-liner pointing at the raw GitHub URL: `curl -fsSL https://raw.githubusercontent.com/<owner>/ticketbook/main/scripts/install.sh | bash`

**Acceptance:** On a clean machine with Bun installed, `curl -fsSL <raw-install-url> | bash` drops `ticketbook` into `~/.local/bin`, installs the skill globally, `ticketbook --help` runs, and `ticketbook init` + `ticketbook onboard` scaffold a foreign repo correctly.

### Phase 4 — `ticketbook upgrade` command

Depends on Phases 2–3 (must have GH Releases + install.sh before there's anything to upgrade *from*). Model after seeds' `src/commands/upgrade.ts`.

- [ ] Add `packages/core/src/upgrade.ts`:
  - `getCurrentVersion()` reads the version baked into the binary at compile time (or falls back to `packages/core/package.json` when running from source in dev mode)
  - `fetchLatestVersion()` hits `https://api.github.com/repos/<owner>/ticketbook/releases/latest` and returns the `tag_name` (strip leading `v`)
  - Compare current vs latest
  - `--check` mode: report current/latest/upToDate and exit 1 if stale; support `--json`
  - Default mode: re-invoke `scripts/install.sh` via `Bun.spawnSync(["sh", "-c", "curl -fsSL <raw-url> | bash"])` — simplest option, reuses all the verification logic in install.sh. Alternative: fetch binary directly, verify SHA256 inline, atomically `rename()` over the current binary (Unix allows overwriting a running executable)
- [ ] Add `upgrade` subcommand to `bin/ticketbook.ts` with `--check` and `--json` flags
- [ ] Tests: version-compare logic, `--check` exit code, `--json` output shape. Do **not** network-call the real GH API in tests — mock `fetch`
- [ ] Document `ticketbook upgrade` + `ticketbook upgrade --check` in README

**Acceptance:** `ticketbook upgrade --check` correctly reports stale/up-to-date; `ticketbook upgrade` on a stale install pulls the latest binary and replaces the running one. `--check` is safe to call from shell prompt integrations.

## Open questions

- **Skill embedding vs. extraction vs. download.** Embed `SKILL.md` as a Bun embedded asset and write it during `init`? Extract it to a cache dir on first run? Fetch it from the release tag at install time? Plannotator uses git sparse-checkout at install time for skills — worth copying. Phase 1 decision.
- **UI asset strategy.** Same question for `packages/ui/dist/`. Embedding adds real weight to the binary (~megabytes per asset); extract-on-first-run needs a predictable cache path. Study plannotator's hook binary before deciding.
- **SQLite native behavior under `--compile`.** `bun:sqlite` should survive because it's built into the Bun runtime, but we need to verify by building a binary and actually reading/writing the db file.
- **Versioning scheme.** Strict semver, or date-based tags for early releases? Affects the install script's + upgrade command's version-resolution logic. Pick before Phase 2.
- **`ONBOARD_VERSION` source of truth.** Options: (a) a constant in `onboard.ts` that someone must remember to bump when the snippet changes — drift-prone; (b) a content hash computed from the snippet itself at build time — auto-tracking but noisy (any whitespace change triggers a version bump); (c) read from `package.json` — ties onboard churn to release cadence. **Lean:** (a) with a prominent comment, because onboard changes are rare enough that manual bumping is fine, and manual bumping forces you to think about whether the change is actually user-facing. Revisit if it drifts.
- **Exposing project name in MCP tool responses.** Task C gives the MCP server a project-suffixed name at handshake. Should tool outputs (`list_tasks`, `get_task`, etc.) also include a `project` field so agents can always tell what repo they're looking at? **Lean: no for v1** — agents already know the project from session context, and adding it to every tool response is noisy. Revisit if cross-repo agent flows become a thing.
- **Binary size.** Plannotator's binaries are ~90MB. Non-blocking but worth tracking.

## Risks

- **Phase 1 is still the rabbit hole.** UI asset embedding + skill embedding + SQLite verification are three independent concerns that could each eat a session. Phase 0 doesn't change this. If Phase 1 drags past a day, reduce scope: drop HTTP/UI mode from the first binary and ship a CLI-and-MCP-only binary as v0, then add UI embedding in a follow-up.
- **Phase 0 scope creep.** The split is: Tasks A+B+E (seeds-inspired onboard) + Tasks C+D (multi-repo UX). That's the whole scope. If it starts growing past that (e.g., "while I'm here, let me also refactor the init result type," or "let me do the pinned-per-repo port too"), stop and reassess — pinned-per-repo is filed as Task F / backlog specifically to keep Phase 0 tight. Tasks C and D are independent of A/B/E, so they can happen in parallel without inflating scope.
- **Marker name collision.** If another tool writes `<!-- ticketbook:start -->` (unlikely but possible), the replace logic would corrupt their section. Use a distinctive-enough marker name and document it. Seeds runs with the same risk under `<!-- seeds:start -->` and has been fine.
- **Config schema churn.** Task C adds a `name` field to `.tasks/.config.yaml`. Existing installs without that field must keep working via fallback — test this explicitly, don't assume.
- **Cross-compilation edge cases.** Compiling from macOS ARM to Linux x64 can hit surprises. `ubuntu-latest` CI sidesteps this entirely — don't try to cross-compile locally for shipping artifacts.
- **`curl | bash` security posture.** Users running this against a random repo is a real risk surface. SHA256 verification is the minimum bar. Document the manual "download the binary and verify yourself" path as an escape hatch. Revisit SLSA provenance post-v1 if distribution grows.
- **The `private: true` + monorepo assumption might break.** If workspace resolution ever starts failing under `bun build --compile`, we're stuck. Early Phase 1 smoke tests will catch this — don't defer them.

## What "done" looks like

- A user on any supported machine can run `curl -fsSL <raw-install-url> | bash` and end up with `ticketbook` on their PATH + the skill installed globally at `~/.claude/skills/ticketbook/SKILL.md`
- From inside any repo, that user runs `ticketbook init` (data scaffold + `.mcp.json` + skill files + project name in config) and then `ticketbook onboard` (writes versioned section into CLAUDE.md or AGENTS.md), and has a complete, working setup
- Re-running `ticketbook onboard` after a version bump surgically updates the bracketed section — the user never has to manually merge workflow changes into their own docs, and content outside the markers is preserved byte-for-byte
- Multiple concurrent `ticketbook` UI instances across different repos bind to deterministic sequential ports starting at 4242, with clear logs when auto-increment kicks in
- MCP servers across different repos announce themselves distinguishably (`ticketbook-projA`, `ticketbook-projB`) so `claude mcp list` and debug logs are readable
- `ticketbook upgrade --check` reports whether an update is available (safe for shell-prompt integrations); `ticketbook upgrade` self-updates via install.sh
- Cutting a release is a single `git tag v0.x.y && git push --tags` action, with CI handling build + upload
- README has clear install + init + onboard instructions; `--check` and `--stdout` dry-run modes are documented
- `.claude-plugin/plugin.json` is gone; `PUBLISHED_MCP_ENTRY` correctly references the installed binary

## Related

- **PLAN-007** — Ticketbook wrap-up (this plan fulfills PLAN-007 Phase 5)
- **Linked tasks** — see this plan's `tasks` field for the Phase 0 breakdown (Tasks A–E). Task F (pinned-per-repo UI port) is filed as a backlog follow-up and is intentionally NOT linked here to keep Phase 0 scope tight.
- **Seeds reference files driving Phase 0 (read these before starting):**
  - `~/workspace/resources/seeds/src/markers.ts` — lift verbatim
  - `~/workspace/resources/seeds/src/commands/onboard.ts` — model for three-state detection + candidate file walk + `--check` / `--stdout` modes
  - `~/workspace/resources/seeds/src/commands/init.ts` — note how seeds derives `projectName` from `basename(cwd)` at line 24 (pattern for Task C)
  - `~/workspace/resources/seeds/src/commands/upgrade.ts` — model for Phase 4
- **Plannotator reference files worth reading before Phase 1:**
  - `~/workspace/resources/plannotator/.github/workflows/release.yml` — cross-compile + checksum + upload pattern
  - `~/workspace/resources/plannotator/scripts/install.sh` — the install script structure to mirror
  - `~/workspace/resources/plannotator/apps/hook/package.json` and `apps/hook/vite.config.ts` — how they build and embed the vite UI into the compiled binary
