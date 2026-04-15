---
id: PLAN-006
title: primitive rename from task to task
status: completed
project: relay
created: '2026-04-09T02:39:58.351Z'
updated: '2026-04-09T13:08:23.720Z'
---

> **Status:** draft. Scope the primitive rename from task -> task across code, API, MCP, and UI, while explicitly avoiding historical repo-content migration and deferring docs as a primitive.

## Goals

- Make `task` the first-class noun for the tracked work-item primitive
- Keep the product name `relay`
- Keep subtasks as implicit markdown checkboxes, not a first-class schema
- Change the default work-item ID prefix from `TKT` to `TASK`
- Keep custom prefixes such as `TKTB` untouched

## Non-Goals

- No product rename from `relay`
- No `.docs/` primitive or doc schema in this pass
- No migration of existing repo-local `.tasks/`, `.plans/`, or historical markdown wording
- No mandatory rewrite of body headings like `## Tasks` to `## Subtasks`
- No long-term compatibility layer preserving both task and task public APIs indefinitely

## Decisions

- Top-level primitive becomes **task**
- **Subtask** remains a markdown/body convention, not a persisted top-level entity
- Existing historical content in this repo can remain as-is; the migration targets the product surface and forward-looking defaults
- Plan frontmatter and internal code can be renamed as needed for the new primitive, but markdown body prose does not need to be normalized aggressively
- Default config prefix becomes `TASK`; user-defined prefixes are left alone

## Migration Principles

- Optimize for a clean post-migration product surface rather than carrying dual task/task terminology long term
- Treat historical markdown in this repo as legacy content, not as something that must be normalized exhaustively
- Prefer changing code symbols, API surfaces, UI copy, and generated scaffolding over rewriting freeform prose
- Keep subtasks lightweight and markdown-native; do not turn them into a tracked entity just to make the terminology feel symmetrical
- Make forward-looking defaults clean even if some local dogfooding content continues to use older wording

## Recommended Defaults

- New project initialization should use `.tasks/` as the default work-item directory
- New HTTP, MCP, and UI surfaces should expose only task-oriented naming once the migration lands
- Temporary aliases are acceptable during implementation on the branch, but they should be removed before merge unless a specific compatibility need is discovered
- Plan readers may tolerate legacy `tasks:` frontmatter during the transition, but newly written plans should emit `tasks:`
- Body headings like `## Tasks` can remain valid historical content; we do not need to bulk-rewrite markdown unless tooling behavior depends on it

## Workstreams

### 1. Core domain rename
- [ ] Rename core types and helpers from task-oriented names to task-oriented names
- [ ] Rename storage/discovery helpers from `.tasks` assumptions to `.tasks` for new/default behavior
- [ ] Update config defaults so new projects get `prefix: TASK`
- [ ] Keep subtask helpers markdown-based; do not introduce a subtask schema

### 2. Server/API/MCP rename
- [ ] Rename HTTP API routes from `/api/tasks` to `/api/tasks`
- [ ] Rename MCP tools from `*_ticket` / `*_tickets` to `*_task` / `*_tasks`
- [ ] Update MCP resource names and agent instructions to prefer task language
- [ ] Decide whether any temporary aliasing is needed during the implementation window only

### 3. UI rename
- [ ] Rename UI routes, state, and components from task-oriented names to task-oriented names
- [ ] Update visible product copy to consistently say `task`
- [ ] Keep plan/task body editing flexible; do not enforce heavy markdown structure changes

### 4. Plans integration
- [ ] Rename plan linkage fields and helpers from `tasks` to `tasks`
- [ ] Rename `cut_tickets_from_plan` and related flows to task language
- [ ] Preserve the conceptual model: plans can still be cut into executable tasks

### 5. Tests and docs
- [ ] Update tests, fixtures, README, AGENTS, and skill docs to use task terminology going forward
- [ ] Avoid mass-rewriting historical plans/tasks in this repo unless a specific fixture/test requires it

## Risks And Failure Modes

- Mixed old/new terminology can leak through dogfooding content, generated examples, or stale test fixtures and make the product feel half-migrated
- Route/tool renames can quietly break copilot flows, tests, or agent instructions if a single legacy name is left behind
- Generated scaffolding must stay synchronized across `init`, README guidance, AGENTS instructions, MCP config examples, and skill docs
- Changing the default directory to `.tasks/` affects path discovery, watcher setup, and startup flows; missing one path assumption will produce confusing runtime failures

## Open Questions

1. Should the on-disk default directory change from `.tasks/` to `.tasks/`, or do we keep the old directory name temporarily while renaming the higher-level primitive?
2. Do we want a short-lived compatibility window for legacy MCP/API names during the transition, or do we cut cleanly before external testing?
3. Should plan frontmatter keep a legacy `tasks:` reader temporarily for old files, even if newly written plans emit `tasks:`?

## Acceptance Criteria

- New and updated product surfaces use **task** as the top-level work-item noun
- New default initialization uses `TASK` as the default prefix
- Subtasks remain lightweight markdown checkboxes rather than a separate schema
- Historical repo content does not need to be comprehensively migrated for this effort
- The system is clean enough to test externally without exposing `task` as the primary user-facing primitive
