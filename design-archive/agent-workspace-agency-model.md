# Agent Workspace: Agency Model

## Agents at the Core, Humans at the Helm

The workspace isn't a tool where humans do things and occasionally ask agents for help. It's a tool where agents are the primary execution layer for nearly everything, and the human's job is to direct, observe, and make decisions.

This is a fundamental shift from how most developer tools are architected. In VS Code, the human is the actor — they edit files, run commands, click buttons. Extensions and copilots are assistants. In this workspace, agents are the actors — they write code, run tests, manage git, read tickets, propose plans. The human is the director.

But "director" doesn't mean passive. It means the human decides what happens, when it happens, and whether the output is good enough. The tool's job is to make that decision-making fast and well-informed.

---

## The Three Layers

### Layer 1: Autonomous Agent Activity

Agents do things without being explicitly asked. This is the background hum of the workspace.

Examples of autonomous activity:

- When you capture a quick task, an agent pre-reads the codebase to understand scope and surfaces a complexity estimate ("this touches 3 files and has test coverage" vs. "this is a new subsystem with no existing patterns").
- When you open a plan, an agent pre-fetches relevant context — related files, recent changes to the area, existing tickets that might conflict.
- When a build session completes, an agent automatically runs the test suite and reports results without you having to ask.
- When CI fails, an agent reads the error logs and drafts a diagnosis before you even look at it.
- When you connect Linear, an agent periodically syncs issues and surfaces ones that are relevant to your current work context.
- When multiple sessions are running in parallel, an agent monitors for file conflicts and flags them proactively.

This activity is invisible unless you look for it. It's the workspace being smart on your behalf — pre-computing things so that when you turn your attention to something, the context is already assembled.

**Visibility:** Autonomous activity shows up as subtle indicators in the UI — a small "context loaded" badge when you open a work item, a "pre-analyzed" tag on a quick capture, an auto-populated CI diagnosis alongside a failure notification. The human doesn't need to see the agent working; they see the result when it's relevant.

### Layer 2: Directed Agent Sessions

This is what the v2 doc covers extensively — you explicitly tell an agent to do something (plan, build, review, test) and watch it work. The human initiates, the agent executes, the human observes and intervenes as needed.

**Visibility:** Full streaming output in agent session panes. Mode-specific rendering. Progress indicators. Approval requests when the agent needs a decision.

### Layer 3: Consequential Actions (Human Approval Required)

Some actions are irreversible or have external consequences. These always require human approval, regardless of whether they were initiated by a directed session or autonomous activity.

Consequential actions include:

- **Git operations that affect shared state** — pushing to remote, creating PRs, merging branches, force-pushing
- **External system mutations** — updating Linear issue status, closing issues, posting comments on PRs, deploying
- **Destructive changes** — deleting files, reverting commits, dropping worktrees with uncommitted changes
- **Cost-bearing actions** — anything that spends money (cloud resources, API calls to paid services)
- **Communication** — sending messages, posting to Slack, emailing team members

The workspace surfaces these as approval prompts:

```
┌─ Approval Required ─────────────────────────────────┐
│                                                      │
│  Session: auth-middleware [BUILD]                     │
│                                                      │
│  The agent wants to:                                 │
│  Create PR "Refactor auth middleware for new          │
│  session token format" on feat/auth → main            │
│                                                      │
│  Changes: 4 files, +142/-68 lines                    │
│  Tests: ✓ All passing                                │
│  CI prediction: Likely green (no config changes)     │
│                                                      │
│  [View Diff]  [Approve]  [Deny]  [Edit PR First]    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

The approval prompt gives you enough context to make the decision quickly — what's changing, what's the risk, what are your options. "View Diff" opens the right panel. "Edit PR First" opens the PR description in a Document+Agent pane so you can refine it before it goes out.

**Key UX principle:** Approvals should never block the agent from continuing other work. If an agent session has a consequential action pending and also has more non-consequential work to do, it continues working while waiting for approval. The approval is queued, and you can batch-approve multiple pending actions when you're ready.

---

## The Agent Service Layer

Agents in this workspace aren't just the visible sessions you interact with. There's a service layer of agents that power the tool's intelligence.

### Background Agents

These run continuously (or on triggers) and don't have visible sessions:

**Context Agent** — Monitors your active work items and sessions. Keeps a running summary of "what's happening right now" that powers the briefing and the glue layer. When you switch focus to a different session, the context agent pre-fetches relevant information so it's ready instantly.

**Sync Agent** — Handles backend synchronization. Pulls Linear issues on a schedule, pushes status updates when you approve them, resolves conflicts between local ticketbook state and remote backend state.

**CI Agent** — Watches CI pipelines for active PRs. When a pipeline finishes, it reads the results and generates a summary. When something fails, it pre-diagnoses the failure. This means by the time you look at a CI failure, the agent has already identified the likely cause and can present it alongside the error.

**Conflict Agent** — Monitors parallel sessions for overlapping file changes. Flags potential merge conflicts before they happen. Can suggest an order of operations ("merge session A first, then rebase session B") to minimize conflicts.

### How Background Agents Communicate

Background agents talk to external services through MCP or CLI tools. The workspace provides them with the same tool access that session agents get — filesystem, git, GitHub CLI, Linear API, etc.

But background agents also communicate back to the workspace. They produce **signals** — lightweight notifications that the UI can render:

- `ci.failure.diagnosed` → shows up as a diagnosis block alongside the CI status indicator
- `conflict.detected` → shows up as a warning icon on the affected sessions in the left rail
- `sync.linear.updated` → shows up as a brief toast ("3 Linear issues updated")
- `context.preloaded` → invisible signal, just means the context is warm when the human turns attention

Signals don't interrupt the human. They decorate the existing UI — making status indicators richer, pre-populating context panels, adding badges to work items. The human sees the outcome of background agent activity as the tool being smart, not as a separate process demanding attention.

---

## Visibility Spectrum

The core design challenge: how much of what agents are doing should be visible?

Too much visibility → the tool is noisy, the human is overwhelmed, it feels like babysitting.

Too little → the human loses trust, doesn't understand what happened, can't course-correct.

The answer is a **visibility spectrum** that the human controls:

### Glance Level (Default)

What you see without looking for it:

- Status dots in the left rail (running, done, failed, waiting)
- Mode badges (PLAN, BUILD, REVIEW, etc.)
- One-line activity summaries ("editing auth middleware")
- Approval prompts (these are always prominent)
- CI pass/fail indicators
- Conflict warnings

This is enough to maintain awareness while focused on something else. You can monitor 5-6 parallel sessions at glance level.

### Focus Level

What you see when you turn your attention to a specific session:

- Full streaming output in the agent session pane
- Diffs, tool calls, reasoning — the rich rendering from v2
- Progress indicators (step 3/7)
- The agent's full plan (if it has one)
- Session history (everything the agent has done so far)

This is for active observation and intervention. You're watching this session closely, maybe providing real-time feedback.

### Audit Level

What you see when you want to understand everything that happened:

- Complete event log for the session
- Every file read, every command run, every decision point
- Token usage and cost
- Time breakdown (how long each step took)
- Diff between initial and final state of every modified file
- The full prompt context the agent was operating with

This is for after-the-fact review, debugging, and building trust. You probably only use audit level when something went wrong or when you want to deeply understand the agent's approach.

### How the Spectrum Manifests

The left rail is always at glance level. Opening a session pane brings it to focus level. A "Show full log" toggle in the pane header drops to audit level.

The briefing (the morning catch-up) presents things at glance level by default, with the ability to expand any session to focus level.

The right panel (Cmd+Shift+S for session summary) gives you a smart middle ground — more than glance, less than focus. It's the "give me the important parts in 10 seconds" view, powered by the context agent's running summary.

---

## Decision Points

The human's main job is making decisions. The workspace should make decision points obvious, contextualized, and fast to resolve.

### Types of Decisions

**Approval decisions** — "should the agent do this consequential thing?" (merge, push, deploy, update external system). Binary: approve or deny. Context provided inline.

**Direction decisions** — "which approach should the agent take?" The agent is at a fork and presents options. Happens during Build and Plan modes. The agent surfaces the decision in the session pane with clear options:

```
┌─ Decision ──────────────────────────────────────┐
│                                                  │
│  For the notification preferences API, I can:    │
│                                                  │
│  A) Add preferences to the existing User model   │
│     + Simpler, fewer files                       │
│     - Tighter coupling, harder to extend later   │
│                                                  │
│  B) Create a separate NotificationPrefs model    │
│     + Clean separation, extensible               │
│     - More files, extra DB migration             │
│                                                  │
│  [A]  [B]  [Let me think — pause this session]   │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Quality decisions** — "is this output good enough?" After a session completes, you review the changes and decide whether to accept, refine, or redo. The Review mode is designed for this.

**Priority decisions** — "what should I work on next?" The briefing and the left rail inform this. The tool might surface suggestions ("CI is red on feat/auth — might be worth fixing before continuing feat/sms") but never makes this decision for you.

### Decision Aggregation

When you step away and come back, there might be multiple pending decisions across sessions. The briefing groups these:

- 2 approval requests pending (create PR, update Linear status)
- 1 direction decision pending (agent paused waiting for input)
- 3 quality reviews available (completed sessions awaiting review)

You can batch through approvals quickly — the briefing provides enough context for each that you don't need to open the full session. For direction decisions and quality reviews, you click into the relevant session.

---

## What This Means for Architecture

The agent service layer means the workspace needs:

1. **A process manager** for background agents — starting, stopping, monitoring their health, restarting on failure.

2. **A signal bus** for background agents to communicate results back to the UI — lightweight pub/sub that the frontend subscribes to.

3. **An MCP/CLI gateway** that both session agents and background agents use to talk to external services — this centralizes auth credentials and rate limiting.

4. **A decision queue** that collects pending approvals and decisions across all agents — the briefing and approval UX read from this queue.

5. **An event store** that persists everything (session events, background agent signals, decisions made) — this powers audit level visibility and the context agent's summaries.

These are backend concerns, not UX concerns. But the UX depends on them: the glanceability of the left rail, the richness of the briefing, the speed of context loading, the reliability of CI diagnoses — all of these are powered by background agents running on this infrastructure.

---

## Revised Principle

Adding to the principles from v2 and the primitives doc:

12. **Agents at the core, humans at the helm.** The workspace assumes agents are doing most of the work. The human's job is to direct, observe, and decide. The UI is optimized for fast, well-informed decision-making — not for doing the work yourself.
13. **Visibility on a spectrum.** Glance for parallel awareness, focus for active observation, audit for deep understanding. The human dials the depth. The default is glance — most sessions most of the time don't need more.
14. **Consequential actions always surface.** Anything irreversible or externally visible requires explicit approval. The tool never silently does something the human would want to know about.
15. **Background intelligence is invisible until useful.** Pre-analysis, context loading, CI diagnosis, conflict detection — these happen silently and manifest as the tool "just knowing" things when the human needs them.
