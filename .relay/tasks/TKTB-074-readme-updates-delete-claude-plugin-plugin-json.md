---
id: TKTB-074
title: README updates + delete .claude-plugin/plugin.json
status: done
priority: medium
tags:
  - phase-0
  - docs
  - cleanup
  - packaging
project: relay
blockedBy:
  - TKTB-073
assignee: claude-code
created: '2026-04-11T07:07:14.392Z'
updated: '2026-04-11T07:39:56.079Z'
---

Documentation and cleanup for PLAN-005 Phase 0. Ties off the user-visible surface so the new `init` / `onboard` split is discoverable, and removes the dead `.claude-plugin/plugin.json` file that was left behind after the Claude Code plugin marketplace path was dropped from the roadmap.

**Blocked by TKTB-073** — the `init` / `onboard` split has to be real in the CLI before the README can document it accurately. Promote to `open` as soon as TKTB-073 is merged.

Part of PLAN-005 Phase 0.

## Changes

### `README.md`

Restructure the "CLI Options" and "Quick Start" sections:

1. Under **Commands**, change:
   ```
   init        Scaffold a new .tasks/ directory
   ```
   to:
   ```
   init        Scaffold .tasks/, .plans/, .docs/, .mcp.json, and skill files
   onboard     Write/update the relay agent instructions section in CLAUDE.md (or AGENTS.md)
   ```

2. Add `--check` and `--stdout` under **Options** with an "(onboard only)" tag, mirroring the help output from TKTB-073.

3. Rewrite the **Quick Start** section to show the two-step flow:
   ```bash
   # Initialize data directories and MCP config
   relay init

   # Add agent instructions to CLAUDE.md / AGENTS.md
   relay onboard

   # Start the web UI
   relay
   ```

4. Add a new **Onboarding** subsection explaining:
   - `onboard` walks `CLAUDE.md` → `.claude/CLAUDE.md` → `AGENTS.md` and picks the first that exists (creates `CLAUDE.md` if none do)
   - The section is wrapped in versioned `<!-- relay:start -->` / `<!-- relay:end -->` markers — content outside the markers is preserved byte-for-byte on re-run
   - Use `--check` in CI to fail if a project's onboarding is stale (non-zero exit on `missing` or `outdated`)
   - Use `--stdout` to preview the section before writing

5. Delete any reference to `AGENTS.md` being created by `init`. The current README (around the "Claude Code MCP Integration" section) may or may not mention this — scan for it and rewrite as needed.

6. Leave the install / curl one-liner documentation alone — that's Phase 3's concern, when `install.sh` actually exists. Don't preempt it.

### Delete `.claude-plugin/plugin.json`

The file was declared at `.claude-plugin/plugin.json` but never marketplace-registered. The Claude Code plugin marketplace path is explicitly dropped per PLAN-005 scope boundaries. Remove the dead config:

```bash
rm .claude-plugin/plugin.json
# Check if .claude-plugin/ has other contents first
ls .claude-plugin/
# If empty:
rmdir .claude-plugin
```

Verify nothing else in the repo references `.claude-plugin/plugin.json` (grep for it first).

## Out of scope
- Install / curl one-liner docs (Phase 3's job, when `install.sh` exists)
- `relay upgrade` docs (Phase 4)
- Port auto-increment docs — TKTB-071 handles its own narrow README blurb if it wants one; don't force it through here
- MCP server naming docs — TKTB-070 owns its own narrow blurb if needed

## Acceptance
- `README.md` documents `init` and `onboard` as two separate commands
- `--check` and `--stdout` are documented with their onboard-only semantics
- No remaining reference to `init` writing `AGENTS.md`
- `.claude-plugin/plugin.json` is removed from the repo
- `.claude-plugin/` directory is removed if empty
- `git grep -l 'claude-plugin'` returns nothing (or only historical plan/doc references, not live code)
- `git status` shows only the expected changes

<!-- agent-notes -->

## claude-code debrief — 2026-04-11

**Done.** Phase 0's user-visible surface is now coherent with the init/onboard split, and the dead Claude Code plugin config is deleted.

### Files changed
- **`README.md`** — three edits:
  1. Quick Start: added `bunx relay onboard` between init and the server invocation. Tweaked the server comment to mention the new default port (4242 + auto-increment).
  2. CLI Options: added `onboard` command, added `--check` / `--stdout` / `--json` flag docs, updated `--port` description to reflect the TKTB-071 default-4242 behavior.
  3. New **Onboarding** section (between CLI Options and the existing Claude Code MCP Integration section) explaining the marker-wrapped-section design, candidate file preference walk, all four modes (default, `--check`, `--stdout`, `--json`), and versioning semantics.
- **`AGENTS.md`** (one-line fix) — updated the stale reference: `"Claude Code discovers it via the \`.claude-plugin/\` manifest"` → `"Claude Code discovers it via \`.claude/skills/relay/SKILL.md\`"`. This was the only live doc reference to `.claude-plugin/` and it would have become false the moment I deleted the directory.
- **`.claude-plugin/plugin.json`** — deleted.
- **`.claude-plugin/`** — empty directory removed.

### Out-of-scope notes intentionally respected
- Did NOT flip `bunx relay` → plain `relay` in the README. That's Phase 1 scope (when PLAN-005 Phase 1 flips `PUBLISHED_MCP_ENTRY`). The README's `bunx relay` references are dead-on-arrival today but will become live when Phase 1 ships the binary + install.sh. Leaving them alone keeps the README aspirational but internally consistent.
- Did NOT add install / curl one-liner docs. That's Phase 3.
- Did NOT add `relay upgrade` docs. That's Phase 4.

### Validation
- `bun test` → 318 pass / 0 fail / 639 expect() calls across 28 files (unchanged — this task only touches docs + a single unused config file).
- `bun run typecheck` → all packages clean.
- `git grep -l 'claude-plugin'` → returns only historical references in `.tasks/TKTB-06x-...md`, `.tasks/TKTB-073-...md`, `.tasks/TKTB-074-...md`, `.plans/PLAN-005-...md`, `.plans/PLAN-007-...md`. Zero live code or documentation references. AGENTS.md is no longer in the list because I fixed the stale line.

### Leftover wart (not blocking)
The root `AGENTS.md` in this repo is a dogfood artifact from before TKTB-073. It still contains the old-style `## If your agent supports Skills` content (a full-file markdown doc, not a marker-wrapped section). Running `relay onboard` in this repo would find `AGENTS.md` as the third-preference candidate and append a marker-wrapped relay section to the end of it. That's correct behavior but would leave this repo with two overlapping descriptions of relay in the same file.

Not fixing it here — it's out of scope and cosmetic. Future cleanup options: (a) delete the old content manually and re-run onboard, (b) delete AGENTS.md entirely and let onboard create CLAUDE.md cleanly, (c) ignore since the source repo's onboarding is visible to Claude Code via the skill file anyway.
