---
id: PLAN-005
title: Compiled binary distribution and install script
status: draft
tags:
  - distribution
  - packaging
  - release
  - agent-integration
project: ticketbook
tickets: []
created: '2026-04-08T19:00:00.000Z'
updated: '2026-04-08T19:00:00.000Z'
---

# Compiled binary distribution and install script

> **Status:** draft. Plan for making ticketbook installable in any arbitrary repo without publishing to npm. Follows plannotator's distribution model: cross-compiled standalone binaries via `bun build --compile`, GitHub Releases as the hosting layer, and a `scripts/install.sh` that downloads, verifies, and installs. Branded install URL is explicitly out of scope for this plan.

## Thesis

Skip npm entirely. The root `package.json` is `"private": true` and the repo is a Bun workspace monorepo — publishing to a registry requires either bundling the whole workspace into one package or publishing each workspace package separately and rewriting `workspace:*` deps. Both are solvable but add real, ongoing friction.

`bun build --compile` produces self-contained single-file binaries that include the Bun runtime, all JS deps, and any embedded assets. No registry, no workspace resolution, no publish ceremony. Distribution is a GitHub Release with the binary uploaded as an asset, plus a shell script that fetches the right binary for the user's platform. Plannotator (`~/workspace/resources/plannotator`) ships this way successfully — they're `"private": true` and a monorepo too, and they bypassed the same blockers.

Ticketbook already has the *per-project* scaffolding layer (see `bunx ticketbook init`). The missing piece is the global binary install, so `ticketbook init` can be run in a foreign repo without first cloning this one.

## What's already in place

- `bin/ticketbook.ts` is the single entry point for CLI, server, and MCP modes
- `skills/ticketbook/SKILL.md` is the canonical source of truth for the agent skill
- `.claude-plugin/plugin.json` declares the MCP server for Claude Code plugin installs
- `bunx ticketbook init` scaffolds skill + MCP config + data dirs into any target repo
- `initTicketbook` is extracted to `packages/core/src/init.ts`, tested (12 tests), and idempotent

## What's missing

- No binary compilation pipeline — nothing produces distributable artifacts
- No GitHub Releases workflow — no automation for cutting a release
- No `scripts/install.sh` — no user-facing installer
- No `.claude-plugin/marketplace.json` — the plugin is declared but not marketplace-registered, so `/plugin marketplace add` has nothing to find

## Phases

### Phase 1: Produce a working compiled binary locally

Goal: a single-file `ticketbook-darwin-arm64` executable that runs `init`, the HTTP/UI server, and MCP mode, all from the compiled binary. This phase surfaces the hard technical questions — skill embedding, UI asset bundling, SQLite — before we build anything around it. **Budget a full session; this is where the rabbit holes live.**

Reference: study `~/workspace/resources/plannotator/apps/hook` and its build scripts to see how they handle vite-built UI assets inside a `bun --compile` binary before re-deriving the answer.

- [ ] Add a `build:binary` script to root `package.json` that invokes `bun build bin/ticketbook.ts --compile --target=bun-darwin-arm64 --outfile dist/ticketbook-darwin-arm64`
- [ ] Decide how to embed `skills/ticketbook/SKILL.md` so `resolveSkillSourcePath()` in `bin/ticketbook.ts` finds it from inside the binary — options: Bun's `embeddedFiles` API, extract-on-first-init, or download from the release tag
- [ ] Decide how to embed the built UI assets (`packages/ui/dist/`) so HTTP server mode can serve them from inside the binary
- [ ] Verify SQLite works inside the compiled binary (`bun:sqlite` is part of Bun itself so should survive `--compile`, but must be verified with an actual read/write)
- [ ] Convert the dynamic imports in `bin/ticketbook.ts` (`await import("../packages/server/src/mcp.ts")`, `"../packages/server/src/index.ts"`) to static imports so they get bundled
- [ ] Smoke test: build the binary, copy to a fresh temp dir outside the repo, run `./ticketbook-darwin-arm64 init --dir /tmp/smoke-test`, verify all scaffolded files
- [ ] Smoke test: run the binary in MCP mode from a foreign repo, verify MCP handshake and a tool call
- [ ] Smoke test: run the binary in HTTP mode, verify the UI loads and a ticket can be created

### Phase 2: Cross-compile and publish via GitHub Releases

Once the binary works on the local platform, wire up CI to cross-compile for all platforms and upload to GitHub Releases on tag push. Model after `~/workspace/resources/plannotator/.github/workflows/release.yml`.

- [ ] Add `.github/workflows/release.yml` triggered on `v*` tag pushes, with a `workflow_dispatch` dry-run input for testing
- [ ] Workflow stages: `test` (typecheck + `bun test`) → `build` (cross-compile for darwin-arm64, darwin-x64, linux-x64, linux-arm64) → `release` (upload binaries + `.sha256` files to the GitHub release)
- [ ] Use `ubuntu-latest` runners for cross-compilation (plannotator does this to avoid macOS cross-compile edge cases)
- [ ] Generate SHA256 checksums alongside each binary for install-time verification
- [ ] Scope the `build` job permissions to `contents: read` only — no OIDC or attestation permissions on PR dry-runs
- [ ] Test the workflow via a dry-run first, then cut a `v0.1.0-rc.1` test release and verify all expected assets land

### Phase 3: Ship `scripts/install.sh`

The user-facing installer. Mirror plannotator's structure but strip everything ticketbook doesn't need: no Gemini/OpenCode/Pi branches, no SLSA attestation for v1, no Windows .ps1 for v1.

- [ ] Create `scripts/install.sh` that detects OS/arch, resolves the latest release tag via GitHub's API, downloads the matching binary, verifies SHA256, and installs to `$HOME/.local/bin/ticketbook`
- [ ] Support `--version <tag>` for pinning, and a positional form (`install.sh v0.1.0`)
- [ ] Warn if `~/.local/bin` is not on PATH and print the shell-specific fix
- [ ] Optional: install the skill globally at `~/.claude/skills/ticketbook/SKILL.md` and `~/.agents/skills/ticketbook/SKILL.md` via git sparse-checkout of `skills/` from the release tag — lets agents outside any ticketbook-enabled project still know what ticketbook is (plannotator's pattern)
- [ ] Add `scripts/install.test.ts` with basic argument parsing and OS detection coverage (plannotator has one; copy the structure)
- [ ] Update the README "Install" section with the curl one-liner pointing at the raw GitHub URL: `curl -fsSL https://raw.githubusercontent.com/<owner>/ticketbook/main/scripts/install.sh | bash`

### Phase 4: Register the Claude Code plugin marketplace

`.claude-plugin/plugin.json` is already committed. The missing file is `marketplace.json`, which registers the plugin so users can run `/plugin marketplace add`.

- [ ] Create `.claude-plugin/marketplace.json` declaring the ticketbook plugin with `source: "./"` (pointing at the repo root as the plugin source — same pattern plannotator uses with `./apps/hook`)
- [ ] Verify end-to-end: from a scratch repo, run `/plugin marketplace add <ticketbook-repo>` then `/plugin install ticketbook@ticketbook`, confirm the MCP server starts and the skill loads
- [ ] Document the Claude plugin install path in the README as an alternative to the global binary install, for users who prefer plugin-managed setups

## What this plan is NOT

- **Not a branded install URL** (ticketbook.ai, ticketbook.dev, etc.) — explicitly deferred
- **Not Windows support** for the install script (install.ps1, install.cmd) — add later if there's demand
- **Not SLSA build provenance attestations** — overkill for v1, add if/when there's a supply-chain reason
- **Not an npm publish path** — intentionally bypassed via binary distribution
- **Not a Codex plugin packaging story** — Codex's own plugin system is a separate concern; `ticketbook init` already scaffolds the Codex skill path and `bin/ticketbook --mcp` is the same binary either way

## Open questions

- **Skill embedding vs. extraction vs. download.** Embed `SKILL.md` as a Bun embedded asset and write it during `init`? Extract it to a cache dir on first run? Fetch it from the release tag at install time? Plannotator uses git sparse-checkout at install time for skills — worth copying. Needs a Phase 1 decision.
- **UI asset strategy.** Same question for `packages/ui/dist/`. Embedding adds real weight to the binary (~megabytes per asset); extract-on-first-run needs a predictable cache path. Study plannotator's hook binary before deciding.
- **SQLite native behavior under `--compile`.** `bun:sqlite` should survive because it's built into the Bun runtime, but we need to verify by building a binary and actually reading/writing the db file.
- **Versioning scheme.** Strict semver, or date-based tags for early releases? Affects the install script's version-resolution logic. Pick before Phase 2.
- **Binary size.** Plannotator's binaries are ~90MB (Bun runtime + JS + UI + deps). Is that acceptable for ticketbook, or should we try to slim it down? Non-blocking but worth tracking.

## Risks

- **Phase 1 is the rabbit hole.** UI asset embedding + skill embedding + SQLite verification are three independent concerns that could each eat a session. If Phase 1 drags past a day, reduce scope: drop HTTP/UI mode from the first binary and ship a CLI-and-MCP-only binary as v0, then add UI embedding in a follow-up.
- **Cross-compilation edge cases.** Compiling from macOS ARM to Linux x64 can hit surprises. `ubuntu-latest` CI sidesteps this entirely — don't try to cross-compile locally for shipping artifacts.
- **`curl | bash` security posture.** Users running this against a random repo is a real risk surface. SHA256 verification is the minimum bar. Document the manual "download the binary and verify yourself" path as an escape hatch. Revisit SLSA provenance post-v1 if distribution grows.
- **The `private: true` + monorepo assumption might break.** If workspace resolution ever starts failing under `bun build --compile`, we're stuck. Early smoke tests in Phase 1 will catch this — don't defer them.

## What "done" looks like

- A user on any supported machine can run `curl -fsSL <raw-install-url> | bash` and end up with `ticketbook` on their PATH
- From inside any repo, that user can run `ticketbook init` and get a complete ticketbook + agent integration setup committed to their project
- Cutting a release is a single `git tag v0.1.0 && git push --tags` action, with CI handling build + upload
- The Claude Code plugin marketplace is a working secondary install path for users who prefer it
- README has clear install instructions for both the curl one-liner and the Claude plugin route

## Related

- **Plannotator reference files worth reading before starting Phase 1:**
  - `~/workspace/resources/plannotator/.github/workflows/release.yml` — cross-compile + checksum + upload pattern
  - `~/workspace/resources/plannotator/scripts/install.sh` — the install script structure to mirror
  - `~/workspace/resources/plannotator/apps/hook/package.json` and `apps/hook/vite.config.ts` — how they build and embed the vite UI into the compiled binary
  - `~/workspace/resources/plannotator/.claude-plugin/marketplace.json` — 13-line marketplace file
