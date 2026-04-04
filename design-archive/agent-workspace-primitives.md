# Agent Workspace: Primitives & Flexibility

## The Problem With "Ticket"

The word "ticket" carries baggage. It implies something small, scoped, atomic — a Jira ticket, a bug report, a user story with a single acceptance criterion. But agents have blown up that assumption. A single unit of work might be "implement SMS notifications end-to-end" — something that would have been an entire sprint of tickets in the old world. An agent can take that on as one task, running for 30 minutes, producing dozens of files across multiple services.

At the same time, quick captures still happen — "fix the typo in the readme" is also a valid unit of work. And everything in between.

So the primitives need to be scale-agnostic. A "work item" can be anything from a one-liner to a multi-phase project. The tool can't assume size, and the UX can't treat small and large items fundamentally differently. A one-liner and a PRD with 15 subtasks should both feel natural in the same system.

---

## The Core Primitives

Three primitives. Everything in the workspace is built on these.

### 1. Work Item

The universal unit of work. Deliberately vague because it needs to map onto many different mental models and external systems.

A work item has:

- **Identity** — a title and a unique reference (TB-42, LIN-1234, whatever the backend assigns)
- **Body** — freeform content, typically markdown. Could be one sentence or a 500-line PRD. Could contain subtasks (checkboxes), acceptance criteria, architecture diagrams, whatever. The body is the plan AND the task description — there's no artificial separation.
- **Status** — a lifecycle state. The workspace understands a minimal set: not started, in progress, done, blocked. Backends can have richer states (Linear's "triage", "in review", etc.) that map onto these.
- **Relationships** — a work item can reference other work items (parent, blocks, relates to). This is how large work decomposes without forcing a rigid hierarchy.
- **Sessions** — zero or more agent sessions linked to this work item. This is the bridge between planning and execution.
- **Metadata** — everything else: priority, labels/tags, assignee, branch, PR, dates. Backends vary here; the workspace shows what's available.

What a work item is NOT:

- It's not constrained to a size. A one-line bug fix and a multi-week feature are both work items.
- It's not required to have a plan. Some work items are just "do this thing" and you kick off an agent immediately. Others have elaborate plans with inline comments and multiple review cycles.
- It's not required to have an agent session. Some work items are manual, or tracked for reference, or represent work happening outside the tool.

### 2. Plan (Document)

A plan is just a work item whose body is substantial enough to warrant the Document+Agent pane treatment. There's no hard line — the workspace doesn't enforce "this is a ticket" vs. "this is a plan." A work item with a three-sentence body opens in a simple view. A work item with a multi-section markdown body opens in Document+Agent. The user can always toggle between views.

This means plans aren't a separate concept from tickets in the data model. A ticket can grow into a plan (you start with "implement SMS notifications" and then flesh it out into a full PRD). A plan can be distilled back down to a focused task (you realize the scope should be smaller). The body is just markdown — it stretches to fit.

Where this matters for UX: the left rail doesn't need separate "Plans" and "Tasks" sections in the long run. It's all work items. The distinction is visual — items with rich bodies show a small document icon, items with simple bodies show a checkbox icon. But they're the same thing underneath.

### 3. Session

An agent execution. This is the primitive that already exists in the v2 design doc — a running or completed agent process with its event log, linked to a work item (optionally), operating in a mode (Plan, Build, Review, Test, Git, Explore), rendered in a pane.

Sessions are ephemeral in a way work items are not. A work item might have five sessions over its lifetime — a planning session, two build sessions (one that failed and one that succeeded), a review session, and a test session. The work item persists; the sessions are its execution history.

---

## The Backend Abstraction

Here's the architectural insight: the workspace doesn't own the work items. It renders and interacts with them through a backend interface.

### What a Backend Provides

Any task tracking backend needs to support these operations:

**Read operations:**
- List work items (with filtering by status, project, labels, etc.)
- Get a single work item with full body and metadata
- Get relationships between work items
- Search work items (full text)

**Write operations:**
- Create a work item (title + body, at minimum)
- Update a work item (body, status, metadata)
- Create relationships (link items together)

**Real-time (optional but important):**
- Notify when a work item changes (for live updates in the rail and views)

### Ticketbook as the Default Backend

Ticketbook is the zero-config backend. It works immediately because it's local, git-based, and requires no external service. When you install the workspace, ticketbook is there. Your work items are markdown files in `.tickets/`. They're in your repo, in version control, available to agents through the filesystem.

This is the right default because:

- No signup, no SaaS, no database to provision
- Work items live next to the code, so agents can read them directly
- Everything is git-diffable and auditable
- Solo developers and small teams don't need the overhead of Linear
- It just works

### Linear as an Integrated Backend

Linear (and eventually other tools — GitHub Issues, Jira, Asana, whatever) plugs in as an additional backend. When connected, Linear issues appear in the left rail alongside ticketbook items. The workspace treats them identically from a UX perspective — same rendering, same interactions, same ability to spawn sessions.

The key is that Linear integration doesn't replace ticketbook. It augments it. A developer might use:

- **Ticketbook** for personal tasks, quick captures, plans that live close to the code
- **Linear** for team-visible issues, sprint tracking, things that need external visibility

Both show up in the same left rail, differentiated by a small backend icon (a local file icon for ticketbook, the Linear logo for Linear items). The developer doesn't have to think about which system to use when glancing at their work — it's all in one place.

### What Integration Actually Looks Like in the UX

**Left rail, multi-backend:**

```
┌─ ACTIVE ──────────────────────────────────┐
│                                           │
│  ● TB-12: SMS notification service        │
│    📄 ticketbook  BUILD  ■ Running        │
│                                           │
│  ● LIN-456: Fix auth token expiry         │
│    ◇ Linear  BUILD  ■ Running             │
│                                           │
├─ BACKLOG ─────────────────────────────────┤
│                                           │
│  □ TB-15: Rate limiting on webhooks       │
│    📄 ticketbook                          │
│                                           │
│  □ LIN-460: Update onboarding flow        │
│    ◇ Linear  Sprint 24                    │
│                                           │
│  □ LIN-461: Database migration for v2     │
│    ◇ Linear  Sprint 24                    │
│                                           │
└───────────────────────────────────────────┘
```

**Quick capture routing:** When you `Cmd+K` to capture a task, the default backend is ticketbook (fast, local, zero friction). But you can prefix with a backend tag — `@linear Fix the auth token bug` — to create it directly in Linear. Or capture locally first and promote to Linear later if it becomes team-relevant.

**Status sync:** When an agent session linked to a Linear issue completes and a PR is merged, the workspace can update the Linear issue status. The developer confirms this ("Mark LIN-456 as Done?") rather than it happening silently, because status changes in team tools have visibility implications.

**Plan authoring, any backend:** The Document+Agent pane works identically for a ticketbook work item and a Linear issue. The body content is rendered the same way, inline comments work the same way, spawning sessions works the same way. The backend is an implementation detail.

---

## Scale Flexibility: How Work Items Decompose

Since agents handle everything from one-liners to massive features, the decomposition model needs to be natural and non-prescriptive.

### The Spectrum

**Atomic task** — "Fix the typo in README.md." No plan needed. Quick capture → spawn agent → done. The work item body is one sentence.

**Focused task** — "Add rate limiting to the webhook endpoint." Might warrant a few lines of description and acceptance criteria. Could be done in one agent session. The work item body is a paragraph or two.

**Feature** — "Implement SMS notifications." Needs a real plan — architecture decisions, API design, integration points. The work item body is a multi-section document. Probably decomposes into several child work items, each handled by separate agent sessions.

**Project** — "Build the notification platform (SMS, email, push, in-app)." The body is a full PRD. Decomposes into multiple features, each of which decomposes further. Might span weeks.

The workspace handles all of these with the same primitives. The difference is just how much body content the work item has and how many child items it references.

### Decomposition in Practice

When you're in a Document+Agent pane working on a large work item, a natural conversation is: "Break this into implementable pieces." The agent reads the plan and suggests child work items. These appear as a structured list in the document:

```markdown
## Implementation Tasks

- [ ] TB-13: Twilio SMS adapter (Phase 1)
- [ ] TB-14: Notification preferences API (Phase 1)
- [ ] TB-15: Email provider integration (Phase 2)
- [ ] TB-16: Template engine (Phase 2)
- [ ] TB-17: Push notification service (Phase 3)
```

Each checkbox is a linked work item. Clicking one opens it. The parent work item's status reflects the aggregate progress of its children.

But this decomposition isn't mandatory. You could also just kick off a single massive agent session on the entire PRD without breaking it down. The tool doesn't force you into a particular granularity.

### The Glue Layer, Revisited

In the v2 doc, we described injecting cross-session awareness so parallel agents know what each other is working on. With the work item abstraction, this gets richer. The context injected into agent sessions can include:

- The full body of the linked work item (the plan/description)
- The parent work item's body (the broader context)
- Sibling work items and their statuses (what else is being worked on in parallel)
- Which files other active sessions are touching (conflict prevention)

This works regardless of backend. The workspace reads from ticketbook or Linear, composes the context, and injects it. The agent doesn't know or care where the work items live.

---

## What This Means for the UX Design

### Left Rail: Backend-Aware but Visually Unified

The left rail shows all work items from all connected backends in a unified list. Grouping can be by:

- **Status** (the default) — not started, in progress, done
- **Backend** — ticketbook items, Linear items, etc.
- **Project/Sprint** — if the backend supports these concepts
- **Priority** — urgent at top

The user toggles grouping with a dropdown or keyboard shortcut. The point is that you never have to open Linear in a browser to see your assigned issues — they're right there in the rail, actionable with the same keyboard shortcuts as local tasks.

### Quick Capture: Lightweight-First

`Cmd+K` always captures to ticketbook by default. Zero friction, zero network latency, zero configuration. The task is a local markdown file instantly.

From there, the work item can be:
- Kept local (most quick captures stay in ticketbook)
- Promoted to Linear (right-click → "Create in Linear" or command palette)
- Expanded into a full plan (open in Document+Agent, flesh out the body)
- Immediately executed (spawn an agent session)

This means ticketbook isn't just the "local alternative to Linear." It's the **capture layer** — the fast, frictionless inbox where everything starts. Some items stay there permanently. Others graduate to team-visible systems when they need broader visibility.

### Settings: Backend Configuration

A workspace settings panel (accessible from command palette) where you connect backends:

- **Ticketbook** — always on, configured per-repo (which `.tickets/` directory to use)
- **Linear** — connect via API key or OAuth. Configure which team/project to sync. Choose whether to sync all issues or just assigned ones.
- **GitHub Issues** — connect via `gh` CLI auth. Choose which repos to track.
- Future backends follow the same pattern.

The settings panel is simple — it's not the interesting part. The interesting part is that once connected, everything just shows up in the unified left rail and works with the same keyboard shortcuts and interaction patterns.

---

## Revised Principles

Adding to the principles from v2:

8. **Scale-agnostic.** A one-liner and a 500-line PRD are both work items. The tool adapts its presentation (simple view vs. Document+Agent) without forcing the user to choose a "type."
9. **Local-first, integrate-later.** Ticketbook is the default, zero-config backend. Linear and others are additive. The tool is fully useful with nothing but local markdown files.
10. **Backend-transparent.** Work items from any source render and behave identically in the workspace. The backend is a small icon in the corner, not a workflow difference.
11. **Capture is sacred.** `Cmd+K` is the fastest path from thought to tracked item. It should never require choosing a backend, filling out metadata, or making any decision beyond typing the thought. Everything else can be added later.
