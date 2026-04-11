---
id: TKTB-074
title: README updates + delete .claude-plugin/plugin.json
status: backlog
priority: medium
tags:
  - phase-0
  - docs
  - cleanup
  - packaging
project: ticketbook
blockedBy:
  - TKTB-073
created: '2026-04-11T07:07:14.392Z'
updated: '2026-04-11T07:07:14.392Z'
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
   onboard     Write/update the ticketbook agent instructions section in CLAUDE.md (or AGENTS.md)
   ```

2. Add `--check` and `--stdout` under **Options** with an "(onboard only)" tag, mirroring the help output from TKTB-073.

3. Rewrite the **Quick Start** section to show the two-step flow:
   ```bash
   # Initialize data directories and MCP config
   ticketbook init

   # Add agent instructions to CLAUDE.md / AGENTS.md
   ticketbook onboard

   # Start the web UI
   ticketbook
   ```

4. Add a new **Onboarding** subsection explaining:
   - `onboard` walks `CLAUDE.md` → `.claude/CLAUDE.md` → `AGENTS.md` and picks the first that exists (creates `CLAUDE.md` if none do)
   - The section is wrapped in versioned `<!-- ticketbook:start -->` / `<!-- ticketbook:end -->` markers — content outside the markers is preserved byte-for-byte on re-run
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
- `ticketbook upgrade` docs (Phase 4)
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
