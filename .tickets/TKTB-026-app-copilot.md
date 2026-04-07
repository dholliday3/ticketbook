---
id: TKTB-026
title: App copilot
status: in-progress
tags:
  - ideas
  - agent-experience
created: '2026-04-03T22:34:41.396Z'
updated: '2026-04-07T00:00:00.000Z'
---

It would be awesome to have an in-app copilot that can interact with any context in the app (add tickets or plans) and take actions. It should run a coding agent headlessly so a user can use their own personal subscription instead of an API key.

It would be interesting to use pi.dev bc it supports oauth right now, but the best route is to support claude code and maybe codex for now. We should design this to be provider agnostic.

This is similar to how i implemented roundtable so we can reference that.

## Status — 2026-04-07

First implementation landed on the `app-copilot` branch.

**What works end-to-end:**
- Headless Claude Code provider in `packages/server/src/copilot/` — spawns `claude -p --output-format stream-json` per turn, captures conversation ID for `--resume`, parses stream-json into normalized message parts (text/thinking/tool_use/tool_result/error). 13 parser unit tests covering the dedup edge cases.
- Per-session MCP config pointing the spawned CLI back at ticketbook's own MCP server, so the copilot has read/write access to tickets and plans for free without a parallel tool layer.
- Tool scoping via `--allowed-tools "mcp__ticketbook__*,Read,Glob,Grep,WebSearch"` + `--disallowed-tools "Bash,Edit,Write,NotebookEdit,WebFetch"` — copilot is a planning/ticket assistant, not a coding agent.
- REST endpoints (`/api/copilot/{health,sessions,sessions/:id/messages}`) + a push-only WebSocket bridge at `/api/copilot/:sessionId` for streaming.
- Right-rail UI: terminal + assistant share the collapsible pane via two stacked icon buttons (mutually exclusive). Real assistant panel built on Vercel's `ai-elements` registry (Conversation, Message, Reasoning, PromptInput, etc.) plus Tailwind v4 + shadcn baseline (preset `b1a1caPUw`).
- `useCopilotSession` hook owns the lifecycle — start, stream merging, send, reset (which DELETEs the old session and starts a fresh one), teardown on unmount.
- Lazy-loaded so the ai-elements/streamdown/shiki tree (~1MB) only downloads when the user first opens the panel.
- Verified end-to-end via Chrome devtools: prompt → reasoning → ToolSearch → multiple `mcp__ticketbook__list_tickets`/`get_ticket` calls → final markdown response with no duplication.

**Provider abstraction status:** intentionally inlined as one concrete `ClaudeCodeProvider`. We'll factor out the seam when a second provider (Codex) actually arrives — premature abstraction was a mistake in roundtable.

## Follow-ups

- **TKTB-060** — "Open in terminal" escape hatch (drop the user into a real PTY claude session that resumes the same conversation, for slash-commands and richer interactions)
- Pair `tool_use` and `tool_result` parts on the server so we can switch the panel from the custom `ToolBlock` to ai-elements' canonical `<Tool>` component
- Codex provider (when needed) — extract `ClaudeCodeProvider` into a thin interface
- Persist conversation state across panel toggles (currently re-mounts unmount the session — UX papercut, not a bug)

