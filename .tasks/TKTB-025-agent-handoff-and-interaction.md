---
id: TKTB-025
title: 'Copilot context refs — @-mentions, quick-add, and hand-off presets'
status: done
priority: high
order: 1000
tags:
  - ideas
  - copilot
created: '2026-04-03T22:28:31.700Z'
updated: '2026-04-11T07:46:26.813Z'
---

I want rich primitive references in the copilot chat. When I'm talking to the agent I should be able to pull tasks and plans in as first-class context — inline via `@`-mentions in the input, and via one-click "Add to chat" buttons on detail views. Referenced primitives should render as chips (both in the input and in sent messages) with hovercards so I can glance at them without navigating away, and the agent should receive the full, current content of each referenced primitive when the message is forwarded.

This task is scoped narrowly to the copilot chat surface. The original "agent handoff" framing (terminal mode, CLI paste, bulk kickoff, in-app agent spawning) is **out of scope** here — if we decide to build any of it, it lives in its own ticket.

## The context ref primitive

References use two distinct XML forms — one for storage/display, one for what the agent actually sees.

### Marker form (stored, typed, rendered as chip)

Self-closing, carries `id` + a `title` snapshot so chips stay readable even if the primitive is later deleted or renamed:

```xml
<task id="TKTB-025" title="Copilot context refs" />
<plan id="PLAN-006" title="Primitive rename from ticket to task" />
```

Marker form is what the user types (or inserts via the popover / quick-add button), what lives in the serialized editor value, and what persists in `copilot_messages.parts_json`.

### Expansion form (sent to the provider)

A distinct `<context>` wrapper so it can never collide with a literal `<task />` in user prose:

```xml
<context type="task" id="TKTB-025" title="Copilot context refs" status="open" priority="high">
---
id: TKTB-025
title: Copilot context refs
status: open
priority: high
tags: [ideas, copilot]
---

[full task body]
</context>
```

### Freshness: live refs, not snapshots

Only the marker is persisted. On every send, the server walks the outgoing message, regex-matches markers, fetches each primitive's current state from the filesystem, and substitutes the expansion form inline. Benefits:

- Long-running conversations always see the current task state
- Chat DB stays small (task bodies aren't duplicated into every message)
- Hovercards reflect truth, even on old messages
- If a primitive is deleted, expansion substitutes `<context type="task" id="..." deleted="true" />` and the UI chip shows a muted "(deleted)" state

Expansion happens server-side in the copilot manager's send path so additional clients (CLI, mobile) share the same logic.

## UX

### Rich input with inline chips

The copilot input is a Tiptap-based contenteditable editor (not a plain textarea). A custom `contextRef` inline atom node renders each task/plan reference as a compact pill (icon + ID + truncated title) inside the input. Users can navigate past chips with arrow keys and delete them as single units with Backspace. On submit, the editor doc is serialized back to marker-form text and sent through the existing copilot send path.

### @-mention popover

- Typing `@` anywhere in the editor opens a floating popover anchored near the caret (driven by `@tiptap/suggestion`, same pattern as the existing SlashCommand for task bodies)
- Popover hosts a shadcn `Command`-style list with up to 5 results
- Matches across tasks **and** plans, on ID substring + title substring, prioritising exact ID prefix hits
- Arrow keys navigate, Enter selects, Escape closes
- On select, the `@query` text is replaced with a `contextRef` node at the caret plus a trailing space
- **Category prefix filter:** typing `@task ` / `@tasks ` narrows results to tasks; `@plan ` / `@plans ` narrows to plans; without a prefix the popover searches across both. Both singular and plural forms accepted. Enabled via `allowSpaces: true` on the Suggestion plugin + a `parseQuery` helper in `MentionExtension` that splits the query into `{ category, needle }` before filtering

### Quick-add button on detail views

- `TaskDetail.tsx` and `PlanDetail.tsx` get an "Add to chat" button in the header row next to Copy/Delete
- Clicking:
  - Opens the copilot panel if closed
  - Inserts a `contextRef` chip into the editor at the end (with a leading space if the input already has content)
- Wired via `AppContext` exposing `insertIntoCopilotInput(marker: string)` and a `pendingCopilotInsertion` queue that `CopilotPromptEditor` drains when the editor is ready

### Context ref chips in rendered messages

- Text parts in `CopilotPartView` go through a custom renderer that splits on the marker regex
- Text runs render via the existing markdown path
- Matched runs render as `<ContextRefChip>` — a small inline pill: type icon (task/plan), ID, truncated title
- Chip is wrapped in a shadcn `<HoverCard>`; on hover, shows: status, priority, tags, first ~200 chars of body, plus an **Open** button that navigates to the detail route
- Deleted primitives render with a muted style and the hovercard shows "This [task/plan] has been deleted"

### Hand-off preset buttons

Pure UX sugar on top of the context ref primitive — same markers, just pre-filled templated messages. **Pre-fill only, never auto-send** (avoids wasting tokens on accidental clicks).

- **"Get feedback" button** on task and plan detail views
  - Opens copilot, pre-fills:
    ```
    Please review <task id="TKTB-025" title="Copilot context refs" /> and give me feedback on scope, approach, and any gaps.
    ```
- **"Brainstorm" button** on plan detail view
  - Opens copilot, pre-fills:
    ```
    Let's brainstorm <plan id="PLAN-006" title="Primitive rename from ticket to task" />. Walk me through your thinking and help me refine it.
    ```

The user reviews and edits before sending. These buttons live next to "Add to chat" in the header row.

## Implementation surface

**Shared** (`packages/core/src/context-refs.ts`, `context-refs-expansion.ts`)
- Pure string/regex helpers: `parseContextRefs`, `splitByContextRefs`, `renderContextRefMarker`, `createContextRefRegex`
- Server-only rendering: `renderContextRefExpansion`, `renderDeletedContextRef` (uses gray-matter, split into its own module so the UI bundle doesn't pull it)
- Subpath exports: `@ticketbook/core/context-refs` is the client-safe entry point

**Server** (`packages/server/src/copilot/`)
- `context-refs.ts` — `expandContextRefs(text, {tasksDir, plansDir})` walking markers, parallel-fetching primitives, substituting `<context>` expansions, handling deleted state
- Wired into the send path in `manager.ts` before forwarding to the provider; stored user message keeps marker form intact
- `CopilotManagerConfig.plansDir` plumbed through from `index.ts`

**Client** (`packages/ui/src/components/copilot/`)
- `ContextRefNode.tsx` — Tiptap inline atom node with React NodeView
- `CopilotPromptEditor.tsx` — useEditor with StarterKit + Placeholder + ContextRefNode + MentionExtension; handles serialization to/from marker string, syncs to PromptInput controller; drains `pendingCopilotInsertion` from AppContext (with a double-RAF defer to wait for Tiptap's view to attach)
- `MentionExtension.ts` — @tiptap/suggestion-based extension filtering tasks+plans, inserting `contextRef` nodes
- `MentionPopover.tsx` — presentational dropdown rendered via portal, positioned at caret via suggestion's `clientRect`
- `ContextRefChip.tsx` — the message-bubble chip (not the input chip) with `HoverCard` preview
- `CopilotPanel.tsx` — wraps in `PromptInputProvider`, replaces `PromptInputTextarea` with `CopilotPromptEditor`, interleaves chips with markdown in `CopilotPartView`
- `AppContext` — `pendingCopilotInsertion` state + `insertIntoCopilotInput(text)` / `prefillCopilotInput(text)` / `consumePendingCopilotInsertion` handlers
- "Add to chat" / "Get feedback" / "Brainstorm" buttons in `TaskDetail.tsx` and `PlanDetail.tsx`

## Out of scope (own tickets if we build them)

- Start-agent buttons that spawn coding agents
- CLI paste / "copy as claude command"
- In-app terminal agent spawning
- Bulk "kick off all open tickets"
- Session linking (owned by TKTB-055, TKTB-067)
- Worktree-aware agent launching (owned by TKTB-064)
- Fuzzy (fzf-style) search ranking — currently substring with ID-prefix priority

## Open questions

- Mention search: simple substring or fuzzy (fzf-style)? Currently substring with ID-prefix priority; upgrade if it feels bad.
- Hovercard extras: would it be useful to show "Last touched by agent X, Yh ago"? Nice-to-have, not v1.
- Should chips inside the input have a dismiss "×" button on hover, or is Backspace-to-delete enough?
