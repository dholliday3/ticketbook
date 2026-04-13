---
id: TKTB-055
title: SessionRecord model tied to tickets
status: backlog
tags:
  - terminal
  - agent-experience
  - data-model
  - v1-foundations
  - agent-editor
blockedBy:
  - TKTB-054
relatedTo:
  - TKTB-064
  - TKTB-065
  - TKTB-067
created: '2026-04-06T07:29:26.491Z'
updated: '2026-04-12T03:56:44.372Z'
---

## Context

Once the terminal emits structured `SessionEvent`s (from the OSC 133 ticket), we can persist them into a `SessionRecord` that's tied to a ticket. This is the data model that makes 'what did the agent do while working on this ticket' a concrete, queryable answer.

Foundation for:
- Agent feedback loop (TKTB-046) — agent debrief can auto-populate from the session record
- Harness observability (TKTB-047) — skill invocations can reference the session that invoked them
- Diff / file review UI — the diff is scoped by session, not by a raw git range
- Native planning chat — the planning agent reads session records to know what's been tried

## Data model

New SQLite table(s):

```sql
CREATE TABLE terminal_sessions (
  id TEXT PRIMARY KEY,         -- terminal session id (same as terminal_tabs.id)
  ticket_id TEXT,              -- optional FK to a ticket
  started_at TEXT NOT NULL,
  ended_at TEXT,               -- null while alive
  shell TEXT NOT NULL,
  initial_cwd TEXT NOT NULL
);

CREATE TABLE session_events (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES terminal_sessions(id),
  seq INTEGER NOT NULL,        -- monotonic per session
  at TEXT NOT NULL,
  type TEXT NOT NULL,          -- commandStart | commandEnd | cwdChanged
  payload TEXT NOT NULL        -- JSON blob matching SessionEvent shape
);

CREATE INDEX idx_session_events_session_seq ON session_events(session_id, seq);
CREATE INDEX idx_terminal_sessions_ticket ON terminal_sessions(ticket_id);
```

## Wiring

In the server:
- When a new `TerminalSession` is created, write the `terminal_sessions` row.
- Subscribe to `session.onEvent` at the backend level; persist every event as a `session_events` row.
- Expose REST endpoints:
  - `GET /api/terminal/sessions/:id/events` — paginated event stream
  - `GET /api/tickets/:id/sessions` — list sessions linked to a ticket
  - `POST /api/terminal/sessions/:id/link` — link session to ticket

In the UI:
- Terminal pane gets an optional 'linked ticket' chip — click to link the active session to a ticket.
- Ticket detail view gets a 'terminal activity' section listing linked sessions with command history.

## Dependencies

- Persistence refactor (this PR, TKTB-042)
- OSC 133 / event stream (TKTB-054)

## Open questions

- Do we capture the raw output text per command (for searchability), or only the structured event metadata? Probably just metadata for now; raw output lives in the headless xterm scrollback and is lost on session destroy.
- Auto-link sessions to the ticket that was active in the UI when the terminal pane was opened? Or require explicit linking?
- Retention policy — when does a session record get garbage collected?
