# Agent Workspace: UX Design

## The Analogy That Frames Everything

VS Code made developers productive by giving them an ergonomic canvas for their core workflow: editing files. The file was the atomic unit. Everything else — file tree, git panel, terminal, extensions — existed to support navigating between files and understanding context around the file you were editing.

The atomic unit has changed. It's no longer the file. It's the **task** — a unit of work that might be a 30-minute agent session, a quick bug fix you want to capture for later, a PRD you're drafting, or a CI pipeline you're watching. The developer's job has shifted from writing code to orchestrating work: brainstorming, planning, delegating to agents, observing, validating, course correcting, shipping.

This tool is the ergonomic canvas for that workflow. The way VS Code made file-editing feel fluid, this makes work-orchestration feel fluid.

---

## The Screen: Three Zones

The workspace has three conceptual zones. All are keyboard-togglable. The center is always visible; the left and right zones slide in and out.

```
┌──────────┬─────────────────────────────────┬──────────────┐
│          │                                 │              │
│  LEFT    │         CENTER                  │    RIGHT     │
│  RAIL    │         WORKSPACE               │    PANEL     │
│          │                                 │              │
│ (toggle) │    (always visible, your        │   (toggle)   │
│          │     main working area)          │              │
│          │                                 │              │
└──────────┴─────────────────────────────────┴──────────────┘
```

### Left Rail — The Work Stack

Always-accessible, narrow sidebar. Think of it like the VS Code activity bar + sidebar combined, but for tasks instead of files. It shows **everything you have going on** in a glanceable list.

**What's on the rail:**

- **Active Sessions** — every running or recently completed agent session, grouped by repo. Each entry shows:
  - A short label (the ticket title, or a user-given name, or auto-generated from the prompt)
  - Status indicator: a colored dot or icon — running (animated), waiting for input (amber pulse), done (green check), failed (red x)
  - Branch name
  - Elapsed time for running sessions
  - One-line summary of current activity ("editing auth middleware", "running tests", "waiting for approval")

- **Quick Tasks** — captured ideas and one-off tasks that haven't been delegated yet. These are lightweight — just a title and maybe a priority flag. You capture them fast and deal with them later.

- **Plans / Tickets** — if ticketbook is connected, your open tickets appear here grouped by project/sprint. Each shows status and whether an agent session is linked to it.

- **Repos** — the repos you're working in, with a count of active sessions per repo.

**Interaction pattern:** Click or keyboard-navigate to any item to open it in the center workspace. The rail is always up to date — session statuses update in real time, so a glance tells you what's running, what's stuck, what's done.

**Key shortcut:** `Cmd+B` toggles the rail. When collapsed, a thin strip of status dots remains visible so you never fully lose awareness.

### Center Workspace — The Flexible Canvas

This is where the actual work happens. It's a **tiling layout** — you split it however you want with panes of different types.

The center workspace supports the same pane types from the earlier design doc (shell, agent session, view), but let me get specific about what each looks like and how you interact with them.

### Right Panel — Contextual Intelligence

A slide-out panel on the right side, similar to Wharf's diff panel. It shows contextual information relevant to whatever is focused in the center workspace. It's the "glance and dismiss" layer.

**What can appear in the right panel:**

- **Git diff** — the diff on the current branch, syntax-highlighted, collapsible by file. Appears when you focus an agent session or shell that's on a branch with changes. (`Cmd+Shift+D`)
- **CI status** — pipeline status for the current PR. Shows pass/fail per check, with expandable failure logs. (`Cmd+Shift+C`)
- **File preview** — television-style fuzzy file finder that shows a syntax-highlighted preview of the selected file. You search, you glance, you grab a path or snippet to paste into an agent prompt. (`Cmd+P`)
- **Session summary** — auto-generated briefing of what an agent session has done so far. Useful when you step away and come back, or when you want to understand a completed session without scrolling through the full log. (`Cmd+Shift+S`)
- **Ticket detail** — the full ticket view from ticketbook, editable. (`Cmd+Shift+T`)

**Interaction pattern:** Each right panel mode has its own shortcut. Press the shortcut to open it, press again (or `Esc`) to dismiss. The panel doesn't disrupt your center layout — it overlays or pushes the center content slightly. It's meant for quick reference, not sustained work. If you want something persistent, promote it to a pane in the center workspace.

---

## Pane Types: What They Look Like

### Agent Session Pane

This is the most important pane type. It replaces the terminal-as-agent-viewer with something purpose-built.

**Layout of an agent session pane:**

```
┌─────────────────────────────────────────────────────────┐
│ ● auth-middleware-refactor     main → feat/auth    12:34│
│ Ticket: TB-42                  ■ Running                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ▸ Reading src/middleware/auth.ts                  [1/5] │
│                                                         │
│  Agent: "I'll refactor the auth middleware to use       │
│  the new session token format. Let me first             │
│  understand the current implementation."                │
│                                                         │
│  ┌─ Read: src/middleware/auth.ts ──────────────────┐    │
│  │  ▸ 245 lines read                    [collapse] │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Agent: "I see the issue. The token validation is       │
│  happening after the rate limiter, but it should        │
│  happen before. I'll also update the type               │
│  definitions to match the new format."                  │
│                                                         │
│  ┌─ Edit: src/middleware/auth.ts ──────────────────┐    │
│  │  @@ -45,8 +45,12 @@                            │    │
│  │  - const token = req.headers.authorization;     │    │
│  │  + const token = parseSessionToken(             │    │
│  │  +   req.headers.authorization                  │    │
│  │  + );                                           │    │
│  │  ▸ Show full diff (+14/-8)           [collapse] │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─ Shell: npm test ──────────────────────────────┐    │
│  │  ✓ 42 tests passed                             │    │
│  │  ✗ 2 tests failed                              │    │
│  │  ▸ Show output                       [collapse] │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ > Type a message to the agent...              [Send ⏎] │
└─────────────────────────────────────────────────────────┘
```

**Key design decisions:**

**The header** is persistent at the top of the pane. It shows session name, branch, linked ticket, elapsed time, and a status badge. This means even in a small pane, you can identify what's happening at a glance.

**Content blocks** are the core rendering unit. Each block has a type (reasoning, tool call, diff, shell output, approval request) and renders accordingly. Tool calls and diffs are collapsible — you can expand to see detail or collapse to skim through the session history quickly. When an agent does a file read, you don't need to see all 245 lines — the collapsed state tells you what was read, and you expand only if you care.

**The progress indicator** in the header ("1/5") shows step progress when the agent is working through a multi-step plan. This gives you a sense of phase — "it's on step 1 of 5" is much more useful than a spinner.

**The input bar** at the bottom is always available. You can type feedback, corrections, or new instructions to the agent mid-session. This is how you course correct without stopping the session.

**Auto-scroll behavior:** The pane auto-scrolls to follow new output while the agent is running. But if you scroll up to review earlier content, auto-scroll pauses (with a "Jump to latest" button at the bottom). This prevents the "trying to read something while the agent keeps pushing it off screen" problem.

**Density toggle:** A control to switch between "detailed" (showing reasoning blocks and expanded tool calls) and "compact" (collapsing everything to one-liners, showing just the flow of actions). Compact mode is for when you're monitoring multiple sessions and just want to know the shape of progress without reading every thought.

### Shell Pane

Visually identical to a terminal emulator pane. No chrome except a minimal header with the current directory and shell name. Full terminal emulation. Your aliases, your prompt, your tools all work.

The one addition: if you run an agent command in a shell pane (like `claude` or `codex`), the workspace could offer to "promote" the session to an agent session pane for richer rendering. A small non-intrusive prompt: "Render as agent session? [y/n]". This is the bridge between raw terminal flexibility and rich agent UI.

### View Pane

Minimal chrome. Content depends on the view type. Examples:

**File view:** Syntax-highlighted code with line numbers. A search bar at the top. No editing — this is for reference. If you need to edit, open your editor.

**Diff view:** Side-by-side or unified diff with syntax highlighting. File selector at the top to jump between changed files.

**Plan/ticket view:** The ticketbook ticket rendered with its full detail — title, description, subtasks with checkboxes, metadata. Subtask checkboxes are interactive. Linked agent sessions show their status inline.

---

## Key Interactions

### Quick Capture (`Cmd+K`)

The most important interaction for flow preservation. You're watching an agent session and suddenly think "oh, I also need to update the migration script." You don't want to context switch. You don't want to open ticketbook in a browser. You want to capture the thought and get back to what you were doing.

`Cmd+K` opens a floating input at the top center of the screen (like Spotlight or VS Code's command palette, but simpler):

```
┌────────────────────────────────────────────────────┐
│ ⚡ Update migration script for new token format    │
│                                                    │
│ [Capture]  [Capture + Run Agent]  [Esc to cancel]  │
└────────────────────────────────────────────────────┘
```

You type a short description. Then:
- **Capture** saves it as a quick task in the left rail (and in ticketbook if connected). You deal with it later.
- **Capture + Run Agent** saves the task AND immediately spawns an agent session to work on it. A new pane opens (or a new tab in your current layout) with the agent already starting.

The input can be as terse as you want — "fix typo in readme" or as detailed as a multi-line prompt with file references. For file references, you can use the same `Cmd+P` fuzzy finder inline to insert file paths.

### Spawn Agent From Anywhere

Multiple entry points for starting agent sessions:

1. **From a ticket** — in the left rail, hover a ticket → "Run" button appears. Or keyboard: navigate to ticket, press `Enter` to open it as a view pane, then `Cmd+Enter` to spawn an agent with the ticket's description as the prompt.

2. **From quick capture** — the "Capture + Run Agent" flow described above.

3. **From a shell pane** — you're in a shell, you realize this task should be an agent session. Type a command like `ws run "refactor the auth middleware"` (or just start `claude` and promote it).

4. **From the command palette** — `Cmd+Shift+P` opens a command palette. Type "new session", pick a repo/branch, type a prompt.

5. **From another agent session** — while watching an agent work, you realize a related task should happen in parallel. `Cmd+N` while focused on a session opens the new-session flow pre-populated with the same repo/branch context.

### The Briefing (Context Recovery)

This is the feature for the "I stepped away for the weekend and now I need to pick up all the pieces" problem.

When you open the workspace (or explicitly request it with `Cmd+Shift+B`), you get a **briefing overlay**:

```
┌─────────────────────────────────────────────────────────┐
│                    Weekend Briefing                      │
│                    Since Fri 5:30pm                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ✓ COMPLETED                                            │
│  ┌──────────────────────────────────────────────────┐   │
│  │ TB-42: Auth middleware refactor                   │   │
│  │ Branch: feat/auth  •  PR #87 opened              │   │
│  │ CI: ✓ All checks passed                          │   │
│  │ Summary: Refactored token validation, updated    │   │
│  │ 4 files, added 12 tests. Ready for review.       │   │
│  │                                    [View Session] │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ✗ FAILED                                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │ TB-45: Email notification service                │   │
│  │ Branch: feat/email-notify                        │   │
│  │ Failed at: test suite — 3 integration tests      │   │
│  │ Summary: Implemented SMTP service and templates. │   │
│  │ Tests fail on connection timeout in CI.           │   │
│  │                        [View Session] [Resume]    │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ⏸ WAITING FOR INPUT                                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Quick task: "fix migration script"               │   │
│  │ Agent asking: "Should I also update the seed     │   │
│  │ data, or just the migration?"                    │   │
│  │                                    [View Session] │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  📋 CAPTURED (not started)                              │
│  • Update API docs for new auth flow                    │
│  • Look into flaky test in payments module              │
│  • Consider rate limiting on /api/webhooks              │
│                                                         │
│                                          [Dismiss ⏎]    │
└─────────────────────────────────────────────────────────┘
```

The briefing is generated from session event logs and ticket state. It groups things by outcome (completed, failed, waiting, captured-but-not-started) and gives you a one-paragraph summary of each. You can click into any session to see the full history. You can resume failed sessions or respond to waiting ones directly from here.

This is the single most important feature for the "agents run while you're away" workflow. Without it, you come back to a mess of terminal tabs and have to manually reconstruct what happened. With it, you get a structured debrief in 30 seconds.

### Inline Git Diff (`Cmd+Shift+D`)

Exactly like your Wharf workflow, but context-aware. When you press the shortcut:

- If you're focused on an agent session pane → shows the diff on that session's branch/worktree
- If you're focused on a shell pane → shows the diff for the repo you're in
- If you're focused on a ticket with a linked session → shows that session's diff

The diff panel slides in from the right. Files are listed at the top, collapsible. Syntax highlighted. Expand/collapse per file. Dismiss with `Esc` or the same shortcut.

### File Finder (`Cmd+P`)

Television/Telescope-style fuzzy finder. But context-aware:

- Searches files in the repo that's relevant to your current focus (the agent session's worktree, or the shell's cwd)
- Shows a live syntax-highlighted preview of the selected file on the right side of the finder
- `Enter` opens the file as a view pane in the center workspace
- `Cmd+Enter` inserts the file path at your cursor (if you're typing in an agent input bar or shell). This is for when you're composing a prompt and want to reference a specific file.
- `Cmd+Shift+Enter` inserts the file's contents (or a selection of it) — useful for giving an agent context

### CI Dashboard (`Cmd+Shift+C`)

Opens in the right panel. Shows CI status for the PR associated with the focused session or branch.

```
┌─ CI: PR #87 (feat/auth) ──────────────────────────┐
│                                                    │
│  ✓ lint           12s                              │
│  ✓ typecheck      8s                               │
│  ✓ unit-tests     45s                              │
│  ✗ integration    2m 13s                           │
│    ▸ FAIL: test/auth/session.test.ts:42            │
│      Expected 200, received 401                    │
│      ▸ Full log                                    │
│  ◷ deploy-preview  waiting...                      │
│                                                    │
│  [Re-run Failed]  [Ask Agent to Fix]               │
│                                                    │
└────────────────────────────────────────────────────┘
```

The "Ask Agent to Fix" button takes the failing test output and sends it to the linked agent session (or spawns a new one) as context: "CI is failing on this test. Here's the error. Fix it."

This closes the loop from implementation → CI → feedback → fix without you having to copy-paste error messages between tools.

---

## The Glue Layer: Cross-Session Awareness

One of your pain points: agents in parallel worktrees don't know about each other. The workspace can help.

**Session context file.** The workspace maintains a lightweight context file (or injects context into agent prompts) that summarizes what other sessions are working on. When you spawn a new agent session, the prompt includes something like:

> "Note: There are 2 other active sessions in this repo. Session 'auth-refactor' is modifying src/middleware/auth.ts and src/types/session.ts. Session 'email-notify' is adding src/services/email/. Be aware of potential conflicts."

This doesn't require agents to communicate with each other — the workspace just injects awareness. It's a lightweight coordination mechanism that prevents two agents from editing the same file or making incompatible changes.

**Conflict detection.** If two sessions modify the same file, the workspace flags it in the left rail with a warning icon. You can open a diff view showing both sessions' changes to the same file and decide how to resolve it before either gets merged.

---

## The Command Palette (`Cmd+Shift+P`)

The universal entry point for everything. All features are accessible through it. Partial list:

- `new session` — spawn a new agent session
- `new shell` — open a new shell pane
- `split right/left/up/down` — split the current pane
- `zoom` — maximize current pane
- `briefing` — show the briefing overlay
- `capture` — quick task capture (also `Cmd+K`)
- `diff` — show git diff panel
- `ci` — show CI status
- `find file` — file finder
- `sessions` — list and filter all sessions
- `tickets` — list and filter all tickets
- `switch repo` — change repo context
- `settings` — workspace settings
- `layout: save` / `layout: load` — save/restore layout configurations

---

## Keyboard-First Design

Every action has a keyboard shortcut. The most frequent ones are direct (single chord). Less frequent ones go through the command palette.

**Navigation:**
- `Cmd+1/2/3/...` — focus pane by position (or tab)
- `Cmd+Alt+Arrow` — move focus between panes directionally
- `Cmd+Shift+]` / `[` — next/prev tab in current tab group
- `Cmd+\` — split current pane right
- `Cmd+Shift+\` — split current pane down
- `Cmd+Shift+Z` — zoom/unzoom current pane

**Quick views (right panel):**
- `Cmd+Shift+D` — git diff
- `Cmd+Shift+C` — CI status
- `Cmd+Shift+S` — session summary
- `Cmd+Shift+T` — ticket detail
- `Cmd+P` — file finder

**Actions:**
- `Cmd+K` — quick capture
- `Cmd+N` — new agent session
- `Cmd+Shift+N` — new shell pane
- `Cmd+Shift+B` — briefing
- `Cmd+Shift+P` — command palette
- `Cmd+B` — toggle left rail

**Within agent sessions:**
- `Cmd+Enter` — send message to agent
- `Cmd+.` — interrupt agent
- `Cmd+Shift+R` — resume/restart session
- `Space` (when not in input) — toggle compact/detailed view

---

## Visual Language

**Color as signal, not decoration.** The UI should be predominantly dark with muted tones. Color is reserved for status:
- Green — completed, passing
- Amber/yellow — in progress, waiting for input
- Red — failed, error
- Blue — informational, active focus
- Muted/gray — idle, collapsed, historical

**Typography hierarchy:** Agent reasoning in regular weight, tool calls in monospace, diffs in a code font with standard green/red highlighting. Session headers in slightly larger/bolder text.

**Density.** The default should be dense — more like a terminal than a typical GUI app. Experienced developers want to see a lot of information at once. But there should be clear visual separation between content blocks so scanning is easy.

**Animations.** Minimal. Status transitions (running → done) can have a subtle color fade. Panels slide in/out. No bouncing, no unnecessary motion. The tool should feel fast and quiet.

---

## Putting It All Together: A Scenario

It's Monday morning. You open the workspace.

**9:00am** — The briefing shows you what happened over the weekend. Two sessions completed successfully, one failed on CI, and you have three quick tasks captured from Friday. You dismiss the briefing.

**9:05am** — You click the failed session (email notifications). The right panel opens with CI status showing an integration test timeout. You press "Ask Agent to Fix" — a new session spawns in the same branch to address the CI failure. You don't even look at the code; the agent gets the error context automatically.

**9:10am** — While that runs, you open a ticket for the next feature (SMS notifications). You've already drafted a PRD. You hit `Cmd+Enter` on the ticket to spawn an agent session. The workspace splits your center view: the email-fix session on the left, the SMS agent on the right. Both are running in parallel in separate worktrees.

**9:15am** — You're reading through the SMS agent's initial approach when you notice it's about to create a new notification service from scratch. But you know the email agent already created a base `NotificationService` class. You type in the SMS session's input bar: "Check src/services/notification/base.ts — there's already a base class from the email implementation. Extend that instead." The agent adjusts course.

**9:20am** — The email CI fix agent finishes. Green check in the left rail. You glance at the diff with `Cmd+Shift+D` — looks good, it was just a test timeout configuration. CI re-runs automatically.

**9:25am** — While the SMS agent works, you suddenly remember you need to update the API docs. `Cmd+K`, type "update API docs for notification endpoints", hit "Capture." It appears in the left rail under Quick Tasks. You go back to monitoring the SMS session.

**9:40am** — SMS session finishes. You check the diff, it looks solid. But you want to verify locally. You open a shell pane below the session (`Cmd+\` to split), `cd` into the worktree, run the tests yourself. They pass. You push and open a PR.

**9:45am** — You grab that "update API docs" task from the left rail, hit Enter to start an agent on it. Three sessions have completed, one is running, and your CI is green across two PRs. You're 45 minutes in.

That's the workflow this tool makes fluid.
