---
id: PLAN-007
title: 'Relay wrap-up — clean primitives, ship portable'
status: active
tags:
  - wrap-up
  - primitives
  - packaging
  - agent-handoff
project: relay
created: '2026-04-09T05:12:56.550Z'
updated: '2026-04-11T06:47:33.845Z'
---

# Relay wrap-up — clean primitives, ship portable

> **Status:** draft. This is the overarching plan for wrapping up Relay as a clean, portable artifact-tracking tool (plans, tasks, docs) that can be dropped into any project. Once this plan is done, Relay is "shipped" and focus shifts to Agent Editor.

## Context

Relay started as a canvas for solving project management friction and testing ideas for a future agentic editor. It's served that purpose well. Now it's time to draw a clean line:

- **Relay** = artifact tracking (plans, tasks, docs) + agent handoff for those artifacts
- **Agent Editor** = the mac app for observing/managing agent sessions, workspaces, terminal integration

Most of PLAN-004 (V1 Foundations — sessions, workspaces, terminal, shell integration) is Agent Editor scope and should be deferred. The tickets tagged `deferred-desktop` were already marking this boundary.

## Goals

1. Clean up the primitives: rename tickets → tasks, add docs as a lightweight third primitive
2. Nail the artifact ↔ agent handoff pattern — agents should be able to pick up, work on, and hand back plans/tasks/docs cleanly
3. QoL polish on the existing UI — small wins, not a full redesign
4. Package Relay as a standalone binary that can be installed, initialized, and onboarded in any repo
5. Explicitly defer everything that belongs to Agent Editor

## Non-goals

- Full App.css → shadcn migration (TKTB-069) — not worth it for a tool that's shipping as a utility, not a showcase
- Session/workspace/terminal primitives (PLAN-004 scope) — these are Agent Editor
- Custom agent runtime, ambient agents, plugin system — all deferred-desktop
- Perfect UI — functional and clean is enough; the editor will have the polished UI

## Sequencing

### Phase 1: Primitive rename (tickets → tasks)

This is the foundation — everything after this builds on clean naming. Subsumes PLAN-006.

- Rename core types, storage, and discovery from ticket → task
- Rename MCP tools from `*_ticket` / `*_tickets` → `*_task` / `*_tasks`
- Rename API routes from `/api/tickets` → `/api/tasks`
- Update UI routes, components, and copy
- Update plan linkage fields from `tickets` → `tasks`
- Default prefix becomes `TASK`; existing custom prefixes (like `TKTB`) stay
- Update tests, fixtures, README, skill docs
- On-disk default directory changes from `.tickets/` → `.tasks/` for new projects
- Existing content in this repo stays as-is (legacy, not migrated)

**Linked:** PLAN-006 (full details there)

### Phase 2: Docs primitive

Plans and tasks aren't enough — there's a gap for persistent reference material (architecture decisions, conventions, API specs, onboarding guides). Docs fill this gap as a lightweight third primitive.

- Add a `Doc` type alongside Plan and Task — stored in `.docs/` by default
- Frontmatter: `title`, `tags`, `project`, `status` (draft/published/archived)
- No subtasks, no priority, no assignee — docs are reference, not work items
- MCP tools: `create_doc`, `get_doc`, `list_docs`, `update_doc`, `delete_doc`
- Docs can be linked from plans and tasks (and vice versa) via refs
- UI: docs appear as a third tab alongside plans and tasks
- `relay init` scaffolds `.docs/` alongside `.tasks/` and `.plans/`

### Phase 3: Agent handoff polish

The artifact ↔ agent feedback loop is the most important thing to get right before shipping. This is what makes Relay more than just markdown files.

- **TKTB-046** — Agent feedback loop: `feedback` status between `in-progress` and `done`, agent debrief/confidence in agent-notes, human validation step
- **TKTB-025** — Agent handoff patterns: clear MCP workflow for agents to pick up a task, update status, leave notes, and hand back
- Ensure the MCP tool descriptions guide agents through the handoff workflow naturally (the tool descriptions are the UX for agents)
- Test the full loop: human creates task → agent picks it up → agent works → agent debriefs → human reviews → done
- Apply the same pattern to docs: agent can create/update docs as part of their work

### Phase 4: UI QoL

Small, high-impact fixes. No redesign, no migration.

- **TKTB-040** — Copy task ID to clipboard
- **TKTB-041** — Command menu (⌘K) for quick navigation
- **TKTB-043** — Clickable tasks from home view
- **TKTB-045** — Remove sheet overlay for kanban view
- **TKTB-062** — Task filters (by status, tag, priority, assignee)

### Phase 5: Package and ship

Subsumes PLAN-005. Make Relay installable *and properly onboardable* in any repo. PLAN-005 now has five sub-phases — the first ships independently of any binary work, the rest are the compiled-binary path.

- **Phase 0 (seeds-inspired init/onboard layer).** Split `relay init` (data scaffold) from a new `relay onboard` command (agent instructions). Agent instructions get wrapped in versioned HTML-comment markers (`<!-- relay:start -->` / `<!-- relay:end -->`) so re-running `onboard` after a version bump surgically replaces the bracketed section in existing CLAUDE.md / AGENTS.md files without touching content outside the markers. Candidate file walk: `CLAUDE.md` → `.claude/CLAUDE.md` → `AGENTS.md`. Support `--check` and `--stdout` dry-run modes. Ships without any binary work — pattern lifted from `~/workspace/resources/seeds`.
- Compile to standalone binary via `bun build --compile`; embed `skills/relay/SKILL.md` and `packages/ui/dist/`; verify `bun:sqlite` survives compile
- Cross-compile for darwin-arm64, darwin-x64, linux-x64, linux-arm64 via `ubuntu-latest` CI
- GitHub Releases workflow (tag push → test → build → upload binaries + `.sha256`)
- `scripts/install.sh` for curl one-liner install; drops binary at `$HOME/.local/bin/relay`; supports `--version <tag>` pinning
- `relay upgrade` and `relay upgrade --check` self-update command (models seeds' `sd upgrade`; re-invokes `install.sh` under the hood)
- Flip `PUBLISHED_MCP_ENTRY` in `packages/core/src/init.ts:90` from `bunx relay` to `relay` once the binary is on PATH
- Delete `.claude-plugin/plugin.json` — the Claude Code plugin marketplace path is explicitly dropped; project-level `.mcp.json` auto-loading + project-level skills cover Claude Code without a plugin
- README with clear install + init + onboard + upgrade instructions

**Linked:** PLAN-005 (full details there — Phase 0 through Phase 4 with acceptance criteria, open questions, risks, and seeds/plannotator reference files)

## Deferred to Agent Editor

The following are explicitly out of scope and should be ported to the Agent Editor project backlog:

### Plans
- **PLAN-004** (V1 Foundations — sessions, workspaces, terminal) → archive, port tickets
- **PLAN-003** (Flexible code-editor-style UI) → already tagged deferred/v2

### Tickets
- **TKTB-054** — Terminal session event stream + OSC shell integration
- **TKTB-055** — SessionRecord model tied to tickets
- **TKTB-056** — Git diff and file review UI scoped by session
- **TKTB-064** — Worktree/branch detection for terminal sessions
- **TKTB-065** — Workspace model and discovery
- **TKTB-066** — Session feed view
- **TKTB-067** — Session MCP tools
- **TKTB-068** — Workspace view three-panel layout
- **TKTB-044** — Agent Editor App (brainstorm)
- **TKTB-047** — Agent harness observability
- **TKTB-049** — Ambient and proactive agents
- **TKTB-050** — Platform agent runtime and model gateway
- **TKTB-057** — Relay-native planning chat
- **TKTB-059** — Native Mac terminal exploration
- **TKTB-061** — Custom plugins
- **TKTB-058** — Terminal basics audit
- **TKTB-060** — Open copilot conversation in terminal
- **TKTB-063** — Add Codex as a selectable copilot provider

### Tickets to cancel/skip
- **TKTB-069** — Migrate UI off App.css (not worth it)
- **TKTB-048** — Saved prompts (editor scope)
- **TKTB-051** — Project soul and developer philosophy (editor scope)
- **TKTB-053** — Saving blurbs to claude.md/skills (ideas, not artifact tracking)

## What "done" looks like

- Relay ships three clean primitives: **plans**, **tasks**, **docs**
- The MCP tools use consistent `task` (not `ticket`) naming
- Agents can pick up, work on, debrief, and hand back artifacts via MCP
- The UI is functional and navigable (command menu, filters, clickable tasks)
- A user on any supported platform can `curl | bash` to install, then `relay init` + `relay onboard` in any repo to get a fully scaffolded and agent-onboarded setup
- Re-running `relay onboard` after a version bump surgically updates agent instructions in CLAUDE.md/AGENTS.md without clobbering user edits outside the markers
- `relay upgrade` self-updates users to the latest release
- All Agent Editor work is cleanly cataloged and ready to port to the next project
- CLAUDE.md, README, and skill docs reflect the shipped state

## Risks

- **Phase 1 (rename) touches everything** — high blast radius, but PLAN-006 already has a detailed migration plan. Do it first so everything after builds on clean naming.
- **Docs primitive scope creep** — keep it dead simple. It's markdown files with frontmatter and MCP tools, not a wiki or knowledge base.
- **Agent handoff is hard to validate without real usage** — dogfood aggressively during Phase 3. Use agents to work on Phase 4 and Phase 5 tasks via the handoff workflow.
- **Packaging rabbit holes** — PLAN-005 Phase 1 (binary compilation) is where surprises live. Phase 0 (seeds-inspired init/onboard) ships independently so we get value from the packaging work even if Phase 1 drags. Budget accordingly.

## Related plans

- **PLAN-006** — Detailed primitive rename spec (Phase 1 details)
- **PLAN-005** — Detailed packaging + init/onboard/upgrade spec (Phase 5 details). Recently expanded to include the seeds-inspired Phase 0.
- **PLAN-004** — V1 Foundations, to be archived/deferred to Agent Editor
- **PLAN-003** — Flexible UI exploration, already deferred
