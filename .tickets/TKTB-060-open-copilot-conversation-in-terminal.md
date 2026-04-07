---
id: TKTB-060
title: Open copilot conversation in terminal
status: backlog
tags:
  - agent-experience
  - copilot
  - terminal
created: '2026-04-07T00:00:00.000Z'
updated: '2026-04-07T00:00:00.000Z'
---

Add a button on the right-rail copilot panel that drops the user into a real PTY-backed `claude` session that **resumes the same conversation** (`claude --resume <conversationId>`). This is the escape hatch for things headless mode can't do well: native slash commands (`/clear`, `/plan`, `/skills`), image paste, custom hooks, and richer interactive flows.

## Context

TKTB-026 (App copilot, in-progress on the `app-copilot` branch) ships a headless Claude Code copilot in the right-rail panel. The headless flow is great for chat + MCP tool calls but it deliberately skips the interactive shell features. The terminal already exists in the same right rail — we just need to wire them together so the user can flip the same conversation over to the PTY when they want to.

## Design sketch

The headless `CopilotManager` already exposes `getSession(sessionId).conversationId` (the ID Claude assigned on the first turn — used today for `--resume` between programmatic turns). We need to:

1. **Surface `conversationId` in `useCopilotSession`** — already in the hook's session metadata, just needs to be exposed via the public API.
2. **Add an "Open in terminal" button** to `CopilotPanel` header (next to the "New conversation" / close buttons).
3. **Click handler:**
   - Switch the right rail to the terminal panel (`handleToggleTerminal`).
   - `POST /api/terminal/sessions` to create a new tab.
   - Wait for the new tab's WebSocket to connect and the PTY to be ready.
   - Inject `claude --resume <conversationId>\r` as input on the new session.
4. **Plumb `startupCommand` through the terminal layer.** The cleanest path is probably a new `POST /api/terminal/sessions` body field `startupCommand?: string` that gets passed to the backend, and the WS init handshake replays it to the PTY once the prompt is ready (or sends it via `session.write()` after `onData` first fires).

Open question: does the terminal need to know about shell readiness, or can we just `setTimeout(() => session.write(cmd + "\r"), 200)` after the WS goes ready? The hacky version is fine for v1; OSC 133/634 prompt detection (TKTB-054) would make it robust.

## Acceptance

- [ ] `CopilotPanel` has an "Open in terminal" icon button in its header
- [ ] Clicking it: closes the assistant, opens a new terminal tab, runs `claude --resume <conversationId>` in the new tab
- [ ] The terminal session continues the same conversation — the user sees the prior turns in the CLI history
- [ ] If no conversation ID is set yet (panel opened but no message sent), the button is disabled
- [ ] Works regardless of whether terminal panel was previously open
