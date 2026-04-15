---
id: TKTB-046
title: Agent feedback loop and validation workflow
status: open
tags:
  - agent-experience
  - v1-foundations
  - feedback-loop
relatedTo:
  - TKTB-055
  - TKTB-056
created: '2026-04-05T06:30:00.000Z'
updated: '2026-04-08T05:19:10.748Z'
---

## Context

When an agent implements a ticket, there's no clean way to surface what happened and whether it's actually done. The human needs a validation step. This ticket adds the `feedback` status to the ticket lifecycle and structures how agents report back.

## Feedback status

Add `feedback` as a valid ticket status, sitting between `in-progress` and `done`:

`open` → `in-progress` → `feedback` → `done`

### Implementation

The status enum in the ticket schema needs to include `feedback`. This affects:
- Ticket frontmatter parsing (add to allowed values)
- MCP tool validation (allow `feedback` in `update_ticket`)
- Kanban board (new column)
- List view (new filter option)
- Status badge colors (pick a distinct color — amber/yellow fits "needs review")

### When to use

- **Agent moves to `feedback`:** the agent thinks it's done but the human should validate
- **Agent moves to `done`:** the agent is highly confident AND custom rules allow skip (see below)
- **Human moves to `done`:** after reviewing the agent's work in the feedback state

## Agent debrief

When an agent moves a ticket to `feedback`, it writes a structured debrief in the agent notes section (`<!-- agent-notes -->` marker, which already exists):

```markdown
<!-- agent-notes -->
## Agent Debrief

**What was implemented:**
- Added the FooBar component with responsive layout
- Updated the API endpoint to handle the new field

**Concerns:**
- The edge case where X is empty isn't fully tested

**Validation needed:**
- Visual review of the component on mobile
- Run the integration test suite

**Confidence:** medium
```

### Confidence field

Add `confidence` to ticket frontmatter: `confidence: high | medium | low`

- **high**: agent is very confident, human can do a quick scan
- **medium**: agent completed the work but flagged concerns, human should review
- **low**: agent hit issues or the task was ambiguous, needs careful review

The UI should surface confidence prominently in the feedback state — e.g., a colored badge next to the status.

## Custom auto-resolution rules

Allow project-level config for when agents can skip `feedback` and go straight to `done`:

```yaml
# .tickets/.config.yaml
agentRules:
  autoResolve:
    - condition: "confidence == high AND hasTests"
      action: done
    - condition: "type == bugfix AND linesChanged < 20"
      action: done
  defaultStatus: feedback  # what agents use when no rule matches
```

This is a follow-up — start with always requiring `feedback`, add auto-resolution rules later.

## MCP tool updates

Update `update_ticket` tool description to include:
- When moving to `feedback`: "Include a structured debrief in agent notes with what was implemented, concerns, validation needed, and confidence level"
- When moving to `done`: "Only use if custom rules allow skipping feedback, or if the human has already validated"
- The tool should accept `confidence` as a field

Update `get_ticket` response to include confidence in the output.

## Dependencies

None — this is a schema/workflow change that can land independently.

## Non-goals (for now)

- Auto-resolution rules engine — start with manual feedback, add rules later
- Automated validation (running tests, checking CI) — that's TKTB-049 territory
- Session-based debrief auto-population — that needs TKTB-055 first, and is a nice enhancement later
