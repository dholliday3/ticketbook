---
id: PLAN-008
title: Extract agent-editor scope from ticketbook — cataloging plan
status: active
tags:
  - extraction
  - cataloging
  - cleanup
  - open-source-prep
project: ticketbook
tasks:
  - TKTB-022
  - TKTB-044
  - TKTB-047
  - TKTB-048
  - TKTB-049
  - TKTB-050
  - TKTB-051
  - TKTB-053
  - TKTB-054
  - TKTB-055
  - TKTB-056
  - TKTB-057
  - TKTB-058
  - TKTB-059
  - TKTB-060
  - TKTB-061
  - TKTB-063
  - TKTB-064
  - TKTB-065
  - TKTB-066
  - TKTB-067
  - TKTB-068
  - TKTB-024
created: '2026-04-12T03:53:43.758Z'
updated: '2026-04-12T03:57:22.155Z'
---

# Extract agent-editor scope from ticketbook — cataloging plan

> **Status:** active. This plan catalogs every open/backlog/draft task and plan in the repo and classifies it as either (a) part of **Ticketbook** — the artifact-tracking tool being open sourced — or (b) part of **Agent Editor** — the separate agentic coding platform that needs to move to its own repo. This is the source of truth for the extraction.

## Why this plan exists

Ticketbook and Agent Editor were brainstormed in parallel in the same repo, and the two concerns became entangled. To keep the ticketbook repo clean and open sourceable, we need a clear line:

- **Ticketbook** = plans, tasks, docs; MCP tools for those primitives; the artifact ↔ agent handoff pattern; packaging/install/upgrade; the minimum UI to navigate artifacts. Directly derived from PLAN-007's "wrap-up" scope.
- **Agent Editor** = everything oriented around observing and orchestrating agent sessions: terminals, shell integration, workspace/session primitives, copilot provider work, ambient agents, plugin framework, desktop UI, platform agent runtime.

PLAN-007 ("Ticketbook wrap-up — clean primitives, ship portable") already sketched the deferred list. This plan **validates it against the current task state** and fills in the gaps (items created after PLAN-007 was written, items without the `deferred-desktop` tag, and items where the classification was ambiguous).

## How extraction candidates are marked

Every extraction candidate below gets the **`agent-editor` tag** added (in addition to existing tags — no tag loss, no project changes). This is the bit we filter on when the extraction happens. Rationale:

- **Additive.** A tag doesn't clobber existing project/epic metadata. The `deferred-desktop` tag that several items already carry is close but semantically different ("defer until the desktop app" vs. "belongs in a different repo"), so we layer a second tag on top rather than overloading the existing one.
- **Filterable.** `list_tasks tags=["agent-editor"]` returns the exact extraction set. `list_plans tags=["agent-editor"]` does the same for plans.
- **Reversible.** If classification is wrong, removing a tag is cheap.

Tasks that are already `done` are **not tagged**. They represent code that already landed; the code (terminal, copilot, shell-integration stubs) will travel with the extraction, but the task records themselves are historical and stay in ticketbook's history.

## Plans classification

### Plans to extract → `agent-editor`

| ID | Title | Status | Why extract |
|---|---|---|---|
| **PLAN-003** | Flexible code-editor-style UI: design exploration | draft | The entire plan is a design exploration for the Agent Editor desktop app: session as the noun, pin-vs-follow bindings, workspace = layout, view registry, dockview. Already tagged `deferred`, `v2`. Zero ticketbook-wrap-up relevance. |
| **PLAN-004** | V1 Foundations — Session & Workspace Primitives | draft | Defines the Session/Workspace primitives, OSC 133/633 shell integration, worktree detection, session feed, session MCP tools, diff review scoped by session. PLAN-007 explicitly marks this plan for archival/extraction. |

### Plans that stay in ticketbook

| ID | Title | Status | Why keep |
|---|---|---|---|
| **PLAN-005** | Portable ticketbook — install, init, onboard, upgrade | completed | Core ticketbook packaging. Already shipped. History stays. |
| **PLAN-006** | primitive rename from task to task | completed | Core ticketbook rename. Already shipped. History stays. |
| **PLAN-007** | Ticketbook wrap-up — clean primitives, ship portable | active | The active ticketbook roadmap. Stays as-is. |

## Tasks classification (open / backlog / draft)

### Tasks to extract → `agent-editor`

Grouped by theme. Each row's "Why extract" is one line; reference the original task body for the full rationale.

#### Desktop app & UI shell

| ID | Title | Existing tags | Why extract |
|---|---|---|---|
| **TKTB-044** | Agent Editor App | `brainstorm`, `deferred-desktop` | The literal mission statement for the separate app. |
| **TKTB-068** | Workspace view — three-panel layout with polymorphic tabs | `ui`, `workspace`, `agent-experience`, `v1-foundations` | Session/workspace IDE-style layout. Its "Reuse existing TicketDetail/PlanDetail" note will become an inter-repo dependency. |
| **TKTB-061** | Custom plugins | `plugins`, `extensibility`, `architecture`, `ideas`, `deferred-desktop` | Plugin framework for custom agent-authored UI inside the editor. |
| **TKTB-059** | Native Mac terminal exploration (watch-only) | `terminal`, `native`, `watch`, `deferred-desktop` | Explicitly a watch-only ticket for the libghostty/SwiftUI pivot of the editor's terminal. |

#### Terminal + shell integration + session model

| ID | Title | Existing tags | Why extract |
|---|---|---|---|
| **TKTB-054** | Terminal session event stream + OSC 133/633 shell integration | `terminal`, `shell-integration`, `agent-experience`, `v1-foundations` | The semantic layer that turns a terminal into an observable agent runtime. Agent Editor's foundation. |
| **TKTB-055** | SessionRecord model tied to tickets | `terminal`, `agent-experience`, `data-model`, `v1-foundations` | Persistence for session events. Required by session feed and diff-by-session; not relevant to artifact tracking. |
| **TKTB-056** | Git diff and file review UI scoped by terminal session | `terminal`, `ui`, `review`, `v1-foundations` | Review scoped to "what this session changed" — only meaningful once sessions exist. |
| **TKTB-058** | Terminal basics audit and polish | `terminal`, `polish` | Xterm.js WebGL, latency budget, search addon, etc. The terminal is Agent Editor's surface, not ticketbook's. |
| **TKTB-064** | Worktree/branch detection for terminal sessions | `terminal`, `workspace`, `agent-experience`, `v1-foundations` | Resolve session cwd → repo/worktree/branch. Pure session infra. |
| **TKTB-065** | Workspace model and discovery | `workspace`, `data-model`, `agent-experience`, `v1-foundations` | Defines the Workspace primitive (git context grouping sessions). Not a ticketbook concept. |
| **TKTB-066** | Session feed view (grouped by workspace) | `ui`, `workspace`, `agent-experience`, `v1-foundations` | UI for the session primitive. |
| **TKTB-067** | Session MCP tools | `mcp`, `agent-experience`, `v1-foundations` | MCP CRUD surface for sessions. Ticketbook's MCP surface is plans/tasks/docs only. |

#### Copilot & chat

| ID | Title | Existing tags | Why extract |
|---|---|---|---|
| **TKTB-057** | TicketBook-native planning chat (scoped PM agent) | `agent-experience`, `chat`, `planning`, `deferred-desktop` | Self-describes as "the ONE place we do a deep agent integration" — that place is the editor, not ticketbook. |
| **TKTB-060** | Open copilot conversation in terminal | `agent-experience`, `copilot`, `terminal` | Bridge between the existing in-app copilot and a PTY — depends on copilot + terminal existing, both editor surfaces. |
| **TKTB-063** | Add Codex as a selectable copilot provider | `copilot`, `codex`, `claude`, `providers` | Multi-provider refactor for the in-app copilot panel. Copilot panel stays with the editor. |

#### Platform agents & ambient infra

| ID | Title | Existing tags | Why extract |
|---|---|---|---|
| **TKTB-047** | Agent harness observability and skill evaluation | `agent-experience`, `important`, `deferred-desktop` | Skill usage tracking, eval agent, harness inventory view. Editor-scope observability. |
| **TKTB-049** | Ambient and proactive agents | `agent-experience`, `important`, `deferred-desktop` | Background agents (code reviewer, daily briefing, project manager). Requires the platform runtime below. |
| **TKTB-050** | Platform agent runtime and model gateway | `agent-experience`, `architecture`, `important`, `deferred-desktop` | Local/cheap/capable model routing for ambient agents. Core editor infra, not ticketbook. |
| **TKTB-048** | Saved prompts with smart suggestions | `agent-experience` | Prompt curator agent + autocomplete in chat. PLAN-007 lists this for cancellation; we extract rather than cancel so the idea travels. |
| **TKTB-051** | Project soul and developer philosophy | `agent-experience`, `important` | Strategic project-direction doc consumed by ambient agents. Depends on the platform runtime. |
| **TKTB-053** | Saving blurbs from claude code to claude.md/skills | `ideas`, `agent-experience` | Selection-to-artifact capture from claude code output — needs the editor's copilot integration. |

#### Scheduling / agent runtime

| ID | Title | Existing tags | Why extract |
|---|---|---|---|
| **TKTB-022** | Scheduled tasks | *(none)* | **Borderline.** The core idea (ticket with a `runAt`) is ticketbook-shaped, but the body explicitly says "for one, we'll need to have better integration with coding agents" and the real value lands once an agent runtime can kick off sessions. Extract; the editor is the right home once the runtime lands. If a thin "deadline/reminder" version is wanted inside ticketbook later, file it as a new task with clearer scope. |

### Tasks that stay in ticketbook

| ID | Title | Status | Rationale |
|---|---|---|---|
| **TKTB-020** | Screenshots support | backlog | Paste screenshots into a task body. Pure task-tracking feature. |
| **TKTB-028** | Task sync | backlog | Support alternate backends (beads, seeds, ralph json, Linear). This is ticketbook's own portability story. |
| **TKTB-041** | Command menu | open | PLAN-007 Phase 4 UI QoL. Ship the ticketbook-scoped version (tickets/plans/actions) — the workspace/session search layer described in the body becomes a non-goal and the task body should be trimmed when picked up. |
| **TKTB-043** | Click tickets from home | open | PLAN-007 Phase 4. Small nav fix, pure ticketbook. |
| **TKTB-046** | Agent feedback loop and validation workflow | open | PLAN-007 Phase 3 — the artifact ↔ agent handoff pattern is the centerpiece of ticketbook. `feedback` status, confidence field, structured debrief. |
| **TKTB-052** | Ticket feedback (comments) | backlog | Comments/discussions on tasks. Pure task-tracking feature, enhances the feedback loop from TKTB-046. |
| **TKTB-062** | AI Task filters | open | AI-assisted task metadata + filter building. Lives entirely inside the task list UI. |
| **TKTB-072** | Pin UI port per-repo in .tasks/.config.yaml (follow-up) | backlog | Ticketbook packaging follow-up from PLAN-005 Phase 0. Already `project: ticketbook`. Pure install/config ergonomics. |

### Tasks flagged for cancellation (not extraction)

| ID | Title | Why cancel |
|---|---|---|
| **TKTB-024** | Agent instructions | "We need a way to inform the agent how to use ticketbook. Maybe a skill?" — **already done.** A full ticketbook skill ships in `.claude/skills/ticketbook/SKILL.md` and is loaded by Claude Code today. Mark `cancelled` with a note pointing at the skill. |

## Done tasks relevant to the extraction

These are `done` and won't be tagged or moved (task records stay in ticketbook's history). They're listed here because the **code they produced** is the thing that has to travel to the Agent Editor repo during the actual extraction pass. When someone carves out the agent-editor code, these are the surface areas to look at:

- **TKTB-042** — Terminal shell in the web (xterm.js + headless mirror + PTY backend)
- **TKTB-026** — App copilot (headless claude code copilot in the right rail, `CopilotManager`)
- **TKTB-025** — Copilot context refs (@-mentions and hand-off presets for the copilot)
- **TKTB-009** — Better agent interactions
- **TKTB-018** — Plan mode ideation

All of these produced code paths that live entirely in the editor layer (terminal pane, copilot panel, right rail). None of them wire into the plan/task/doc primitives. They should come out cleanly when the code extraction happens.

## Counts (sanity check)

- **Plans:** 5 total → 2 extract (PLAN-003, PLAN-004), 3 stay (PLAN-005/006/007).
- **Open/backlog/draft tasks:** 31 total →
  - **Extract (22):** TKTB-022, TKTB-044, TKTB-047, TKTB-048, TKTB-049, TKTB-050, TKTB-051, TKTB-053, TKTB-054, TKTB-055, TKTB-056, TKTB-057, TKTB-058, TKTB-059, TKTB-060, TKTB-061, TKTB-063, TKTB-064, TKTB-065, TKTB-066, TKTB-067, TKTB-068
  - **Stay (8):** TKTB-020, TKTB-028, TKTB-041, TKTB-043, TKTB-046, TKTB-052, TKTB-062, TKTB-072
  - **Cancel (1):** TKTB-024
  - **Total:** 22 + 8 + 1 = 31 ✓

## Execution checklist

- [ ] Add `agent-editor` tag to each plan in the extract set (PLAN-003, PLAN-004)
- [ ] Add `agent-editor` tag to each task in the extract set (22 tasks listed above)
- [ ] Mark TKTB-024 as `cancelled` with a note pointing at `.claude/skills/ticketbook/SKILL.md`
- [ ] Leave `done` tasks untouched (they are historical)
- [ ] Open a PR describing the cataloging and linking this plan

## Non-goals

- **Actually moving code.** This plan is a catalog, not a code extraction. The code move is a separate effort.
- **Reshaping the kept tasks.** TKTB-041's body still talks about workspace/session search; PLAN-007's Phase 4 scope already implicitly trims that — don't rewrite it here.
- **Re-classifying `done` work.** History is history.
- **Creating the new Agent Editor repo.** That's a parallel effort; this plan just gives it a clean backlog to start from.

## How to pull the extraction set later

```
# via the ticketbook MCP
list_tasks tags=["agent-editor"]
list_plans tags=["agent-editor"]
```

Or via the CLI once that's available. The tag is the single source of truth for "what belongs in the other repo."
