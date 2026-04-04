# Agent Workspace: UX Design v2

This builds on v1 with three major additions: the Document+Agent pane (the native plannotator experience), Agent Modes as a visual and functional concept, and agent config management as a first-class workflow.

---

## The Big Reframe: Documents and Agents Are Interleaved

v1 treated agent sessions and documents as separate things — you have an agent session pane where output streams, and you have view panes where you look at files. But the workflow you actually do blurs these constantly. You draft a PRD while talking to an agent. You edit a plan while the agent refines sections. You leave inline comments on agent-generated code and the agent responds. You tweak claude.md while testing how the agent behaves.

The core UX primitive isn't "agent session" or "document view" — it's **a document with an agent alongside it**. Sometimes the document is prominent and the agent is a copilot helping you write. Sometimes the agent is prominent and the document is the artifact being produced. The balance shifts fluidly.

This means the workspace has four pane types, not three:

1. **Shell** — raw terminal (unchanged from v1)
2. **Agent Session** — streaming agent output with rich rendering (unchanged from v1)
3. **Document+Agent** — the new one: a rendered, editable document with an agent conversation alongside it
4. **View** — lightweight read-only panels (unchanged from v1)

---

## The Document+Agent Pane

This is the native plannotator experience. It's the most novel piece of the UX and probably the hardest to get right.

### Layout

The pane has two regions arranged side-by-side (or top-bottom, user's choice):

```
┌─────────────────────────────────┬──────────────────────────┐
│         DOCUMENT                │       AGENT              │
│                                 │                          │
│  # SMS Notification Service     │  You: Can you break this │
│                                 │  into smaller impl       │
│  ## Overview                    │  steps? I want to start  │
│  This service handles...        │  with just the SMS       │
│                                 │  provider integration.   │
│  ## Architecture                │                          │
│  ┌─────────────────────────┐    │  Agent: Sure. Here's a   │
│  │ The notification system │    │  phased approach:        │
│  │ will use a provider     │    │                          │
│  │ pattern with...         │    │  Phase 1 would focus on  │
│  │      📝 You: "Should   │    │  the Twilio adapter and  │
│  │      this be async?"   │    │  a minimal send endpoint.│
│  │                        │    │  I've updated the plan   │
│  └─────────────────────────┘    │  to reflect this.        │
│                                 │                          │
│  ## Implementation Phases       │  [The Architecture       │
│  ### Phase 1: SMS Provider      │   section above updates  │
│  - Twilio adapter              │   in real-time as the    │
│  - POST /api/notify/sms        │   agent edits]           │
│  - Basic rate limiting         │                          │
│  ...                           │                          │
│                                 │                          │
├─────────────────────────────────┤                          │
│ [Edit] [Preview] [Commenting]   │ > Ask the agent...    ⏎ │
└─────────────────────────────────┴──────────────────────────┘
```

### How It Works

**The document side** renders the file (markdown, typically) in a rich preview with inline editing. You can click into any section to edit it directly — it's a real editor, not just a viewer. The rendering is clean: headings, code blocks, lists, task checkboxes all render properly. But you can toggle to raw markdown mode if you prefer.

**Inline comments.** You can select any range of text in the document and leave a comment (keyboard shortcut or right-click → "Comment"). The comment appears as a small annotation marker in the document margin. These comments are automatically fed to the agent as context — "The user commented on the Architecture section: 'Should this be async?'" The agent can respond in the conversation thread AND/OR modify the document section directly.

**The agent side** is a conversation thread. You talk to the agent about the document. The agent can read and modify the document. When the agent makes changes, you see them appear in the document side in real-time — new text fades in, deletions fade out, moved sections animate. You can accept, reject, or further edit any change.

**The document is the source of truth.** The conversation is the process of refining it. When you're done, the document is the artifact — the plan, the PRD, the ticket, the config file. The conversation can be collapsed or dismissed; the document persists.

### What Documents Work in This Pane

- **Plans / PRDs** — the primary use case. Drafting, refining, breaking down feature plans with agent help.
- **Tickets** — ticketbook tickets rendered with their frontmatter and body. The agent can help you write acceptance criteria, break into subtasks, estimate complexity.
- **claude.md / CLAUDE.md** — your agent configuration. Edit it in the document side, talk to the agent about what conventions you want, what the agent should know about your codebase. The agent can even suggest improvements based on patterns it sees.
- **Agent skill files** — if you have custom skills or system prompts, edit them here with the agent helping you refine instructions.
- **Any markdown file** — READMEs, ADRs, changelogs. Anything you'd want to co-author with an agent.

### The Inline Comment Flow (Plannotator, Native)

This deserves its own detailed description because it's central to the experience.

**Creating a comment:**
1. Select text in the document (click-drag or shift+arrow keys)
2. Press `Cmd+M` (for "mark") or click the comment icon that appears in the margin
3. A small input appears inline, anchored to the selection
4. Type your comment and press `Enter`
5. The comment appears as a colored margin marker (like code review comments)

**What happens next:**
- The agent sees the comment with its location context: "User commented on lines 14-18 (Architecture > Provider Pattern): 'Should this be async?'"
- The agent responds in the conversation thread, referencing the specific section
- If the agent modifies that section, the change appears in the document with a highlight, and the comment is marked as "addressed"
- You can resolve the comment (dismiss it) or reply to continue the thread

**Visual treatment:**
- Unresolved comments show as amber markers in the margin
- Addressed-but-not-resolved comments show as blue markers
- Resolved comments fade away (but are accessible in a comment history)
- When you hover a comment marker, the full comment and any agent responses expand inline

This is code review UX applied to planning and document refinement. Developers already know this interaction pattern from GitHub PRs and Google Docs. The difference is the other participant is an agent who can immediately act on feedback.

---

## Agent Modes

Right now in your workflow, you engage agents in qualitatively different activities — planning, coding, reviewing, testing, git operations — but every session looks the same visually. A planning conversation and a coding session and a code review all render as the same stream of text. You lose the cognitive signal of "what kind of work is happening here."

Modes give each type of agent engagement a distinct visual and functional identity.

### The Modes

**Plan** — Drafting, refining, breaking down work. The agent is thinking strategically about what to build and how. Typically happens in a Document+Agent pane.

**Build** — Writing code, making changes, implementing features. The agent is producing diffs, running commands, creating files. This is the standard agent session pane with its rich tool-call rendering.

**Review** — Examining code the agent (or another agent, or you) wrote. Focused on diffs with annotations. The agent is looking for issues, suggesting improvements, checking against the plan.

**Test** — Running tests, validating behavior, checking CI. Focused on pass/fail output, test coverage, error logs.

**Git** — Branch management, merging, resolving conflicts, creating PRs. Focused on git operations and their outcomes.

**Explore** — Research, codebase exploration, understanding unfamiliar code. The agent is reading files, explaining architecture, answering questions. More conversational, less action-oriented.

### How Modes Manifest in the UI

**Color accent.** Each mode has a subtle color accent that appears in the pane header and border. Not garish — just enough to create visual distinction when you have multiple panes open.

- Plan: purple/indigo
- Build: green
- Review: amber/orange
- Test: blue
- Git: cyan
- Explore: gray/neutral

**Header badge.** The pane header shows the mode as a small label next to the session name:

```
● auth-middleware  [BUILD]  feat/auth  ■ Running  12:34
```

```
● sms-notification-prd  [PLAN]  ■ Active
```

**Default rendering emphasis.** Each mode adjusts what's visually prominent in the output:

- **Plan mode** → document is prominent, reasoning is expanded, tool calls are secondary
- **Build mode** → diffs and file changes are prominent, reasoning is collapsible
- **Review mode** → diffs are front-and-center with annotation affordances, the agent's comments render like code review comments
- **Test mode** → pass/fail results are prominent, stack traces are expandable, reasoning is minimal
- **Git mode** → branch diagrams, merge status, PR state are prominent
- **Explore mode** → file contents and agent explanations are prominent, conversational feel

**Mode-specific quick actions.** The pane toolbar changes based on mode:

- Build: [View Diff] [Run Tests] [Create PR]
- Review: [Approve] [Request Changes] [View Full Diff]
- Test: [Re-run] [View Coverage] [Fix Failures]
- Git: [Merge] [Rebase] [View Conflicts]
- Plan: [Export to Ticket] [Break Into Tasks] [Start Build Session]

### Mode Transitions

Modes aren't rigid walls — they're lenses. A session can shift modes as the work evolves. You might start in Plan, and once the plan is solid, press "Start Build Session" which spawns a new Build-mode session pre-loaded with the plan as context.

Or a Build session finishes, and you shift to Review mode on the same branch — the pane re-renders to emphasize diffs and adds review-specific tooling.

**Explicit transitions** via a mode selector in the pane header (dropdown or keyboard shortcut `Cmd+Shift+M`). Or **implicit transitions** — when the workspace detects a session is primarily producing diffs, it might suggest switching from Explore to Build mode.

### Mode and Pane Type Relationships

Certain modes naturally pair with certain pane types:

- **Plan** → typically a Document+Agent pane (you're co-authoring a plan)
- **Build** → typically an Agent Session pane (you're watching an agent code)
- **Review** → could be either (Document+Agent for reviewing a plan, Agent Session for reviewing code diffs)
- **Test** → Agent Session pane or View pane (watching test output)
- **Git** → Agent Session pane (agent doing git operations)
- **Explore** → Agent Session pane (conversational Q&A about the codebase)

These are defaults, not constraints. You can run any mode in any pane type.

---

## Agent Config Management

claude.md, CLAUDE.md, agent skills, system prompts — these are the hidden levers that determine whether your agents are effective or frustrating. Currently, managing these is an afterthought: you open them in a code editor, make changes, hope for the best. There's no feedback loop telling you if your config is actually helping.

### The Config Quick View (`Cmd+Shift+.`)

A keyboard shortcut opens a quick view (right panel) showing the active agent config for the currently focused session. This answers "what instructions is this agent actually operating under?"

```
┌─ Agent Config: auth-middleware ────────────────────┐
│                                                    │
│  Source: ~/project/CLAUDE.md                       │
│  Last modified: 2 hours ago                        │
│                                                    │
│  ┌────────────────────────────────────────────┐    │
│  │ # CLAUDE.md                                │    │
│  │                                            │    │
│  │ ## Project Context                         │    │
│  │ This is a Node.js API server using...      │    │
│  │                                            │    │
│  │ ## Conventions                             │    │
│  │ - Use Zod for all validation               │    │
│  │ - Tests in __tests__ directories           │    │
│  │ - Error handling with custom AppError...   │    │
│  │                                            │    │
│  │ ## Skills                                  │    │
│  │ 3 active skills                            │    │
│  │ ▸ /review — code review checklist          │    │
│  │ ▸ /test — testing conventions              │    │
│  │ ▸ /deploy — deployment checklist           │    │
│  └────────────────────────────────────────────┘    │
│                                                    │
│  [Edit in Document+Agent]  [View Raw]              │
│                                                    │
└────────────────────────────────────────────────────┘
```

"Edit in Document+Agent" opens the config file in a Document+Agent pane — you can refine your CLAUDE.md with an agent helping you. The agent can analyze your codebase and suggest conventions to add, or help you write clearer instructions based on patterns where agents keep making the same mistakes.

### Skills Browser

A dedicated view (accessible from command palette: "skills") that shows all available agent skills across your repos. Each skill shows its name, description, trigger conditions, and which repos it's active in. You can edit any skill in a Document+Agent pane.

This replaces the current workflow of hunting through `.claude/skills/` directories manually.

---

## The Left Rail, Revised

With modes in the picture, the left rail gets richer. Sessions are now visually tagged with their mode, which makes scanning much faster.

```
┌─ ACTIVE ──────────────────────────────────┐
│                                           │
│  ● auth-middleware                        │
│    BUILD  feat/auth  ■ Running  12:34     │
│    "editing auth middleware"              │
│                                           │
│  ● sms-prd                                │
│    PLAN  ■ Active                         │
│    Document+Agent                         │
│                                           │
│  ● email-ci-fix                           │
│    BUILD  feat/email  ◷ CI Running        │
│    Waiting on pipeline                    │
│                                           │
├─ RECENT ──────────────────────────────────┤
│                                           │
│  ✓ payment-refactor                       │
│    BUILD  PR #84 merged  2h ago           │
│                                           │
│  ✓ api-docs-update                        │
│    BUILD  PR #86 ✓ CI green  45m ago      │
│                                           │
├─ TASKS ───────────────────────────────────┤
│                                           │
│  □ Update migration script                │
│  □ Look into flaky payment test           │
│  □ Rate limiting on /api/webhooks         │
│                                           │
├─ CONFIG ──────────────────────────────────┤
│                                           │
│  CLAUDE.md  (repo: ticketbook)            │
│  3 skills active                          │
│                                           │
└───────────────────────────────────────────┘
```

The rail now has four sections:

**Active** — running sessions, grouped by mode. The mode badge (PLAN, BUILD, REVIEW, etc.) with its color accent makes it immediately obvious what each session is doing.

**Recent** — completed sessions with their outcomes. Linked to PRs when applicable, showing CI status.

**Tasks** — quick-captured tasks not yet started. These can be dragged up to Active to spawn a session, or right-clicked to open in ticketbook for more detail.

**Config** — quick access to agent config files. Shows which CLAUDE.md is active and how many skills are loaded. Click to open in Document+Agent pane for editing.

---

## Revised Keyboard Shortcuts

Adding the new features:

**Document+Agent pane:**
- `Cmd+M` — add inline comment on selected text
- `Cmd+Shift+M` — change agent mode
- `Cmd+E` — toggle edit/preview in document side
- `Cmd+L` — focus the agent conversation input
- `Cmd+Shift+Enter` — send comment and agent message simultaneously

**Config:**
- `Cmd+Shift+.` — quick view agent config for focused session
- `Cmd+,` — open workspace settings (distinct from agent config)

**Mode transitions:**
- `Cmd+Shift+M` — mode selector dropdown
- Within Plan mode: `Cmd+Shift+X` — "Execute" — spawns a Build session from the current plan
- Within Build mode: `Cmd+Shift+V` — "Validate" — switches to Review mode or spawns a Test session

**Plan/ticket creation:**
- `Cmd+K` — quick capture (unchanged, for tasks)
- `Cmd+Shift+K` — new plan — opens a blank Document+Agent pane in Plan mode. More structured than quick capture: this is for when you want to sit down and draft something with agent help, not just jot a one-liner.

---

## The Session Lifecycle, Fully Realized

Here's how a feature goes from idea to production in this tool:

### 1. Capture
You're in the middle of something and think of a feature. `Cmd+K`: "Add SMS notifications to the platform." It appears in Tasks on the left rail. Takes 3 seconds.

### 2. Plan
Later, you're ready to think about it. Click the task, or `Cmd+Shift+K` to start fresh. A Document+Agent pane opens in Plan mode. You and the agent co-author a PRD. You write the high-level vision, the agent fills in technical details, you leave inline comments ("Should this be async?", "What about rate limiting?"), the agent responds and updates the doc. After 15 minutes, you have a solid plan.

### 3. Break Down
Still in Plan mode, you tell the agent: "Break this into implementable tickets." The agent creates ticketbook tickets from the plan — each one linked to a section of the PRD, each with acceptance criteria and a rough scope estimate. They appear in the left rail under Tasks.

### 4. Delegate
You pick the first ticket and hit `Cmd+Shift+X` (Execute). A Build session spawns in a new worktree with the ticket description as the prompt, plus the full PRD as background context, plus the relevant CLAUDE.md config. The agent starts coding. A new pane opens, or tabs into your current layout.

You kick off a second ticket the same way. Two Build sessions running in parallel, separate worktrees, each aware of what the other is working on (via the glue layer).

### 5. Observe
You watch both sessions in a split layout. Each is in Build mode — diffs and file changes are visually prominent. You can toggle to compact mode on one while reading the other in detail. Status dots in the left rail keep you oriented.

Session 1 finishes. Green check. You glance at the diff (`Cmd+Shift+D`). Looks good.

Session 2 hits a snag — the agent asks for approval on a design decision. Amber pulse in the rail. You click in, read the question, type a quick answer, the agent continues.

### 6. Review
Session 2 finishes. You switch it to Review mode (`Cmd+Shift+M` → Review). The pane re-renders to emphasize the full diff. The agent walks through changes, highlighting anything it's uncertain about. You leave inline comments on the diff (same comment UX as the plan, but on code). The agent responds, makes a small fix.

### 7. Test
You hit `Cmd+Shift+V` (Validate). A Test session spawns that runs the test suite against the agent's changes. Pass/fail results render prominently. One integration test fails. You hit "Ask Agent to Fix" — the failing test context goes back to a Build session on the same branch.

### 8. Ship
Tests pass. CI is green (`Cmd+Shift+C` to verify). The agent has already created a PR. You review the PR description (auto-generated from the ticket + agent's summary of changes). You merge. The ticket in ticketbook auto-transitions to Done.

### 9. Repeat
The briefing the next morning shows you everything that shipped, anything that's still in progress, and your captured tasks waiting to be planned. The cycle continues.

---

## What This Tool Actually Is

It's not a terminal emulator. It's not a code editor. It's not a project management tool. It's not an agent GUI.

It's the **developer cockpit for the agent era**. The place where you think, plan, delegate, watch, steer, and ship. The tool that makes a single developer with multiple agents feel less like chaos and more like conducting an orchestra.

The terminal's flexibility stays — you can always drop into a shell, arrange panes however you want, use keyboard shortcuts for everything. But layered on top is the structure that agents need to be truly useful: plans that flow into sessions, sessions that produce observable output, output that flows into validation, and validation that flows back into the plan when needed.

The key design principles:

1. **Keyboard-first, always.** Every feature accessible without touching the mouse.
2. **Glanceable.** The left rail + status indicators + mode colors mean you never have to "figure out what's going on." You can see it.
3. **Documents and agents are interleaved.** You don't write a plan and then separately tell an agent. You write the plan with the agent. The tool supports that fluid back-and-forth.
4. **Modes create cognitive clarity.** Planning feels different from building feels different from reviewing. The UI reflects that.
5. **The briefing recovers context.** Step away for a day, come back, know exactly where everything stands in 30 seconds.
6. **Quick capture preserves flow.** Never lose a thought because you're in the middle of something else.
7. **CI closes the loop.** The path from code to production is visible and actionable without leaving the tool.
