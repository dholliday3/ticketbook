---
id: TKTB-049
title: Ambient and proactive agents
status: open
tags:
  - agent-experience
  - important
  - deferred-desktop
created: '2026-04-05T07:45:00.000Z'
updated: '2026-04-08T05:19:38.239Z'
---

## The Idea

The platform should enhance the developer without needing to be initiated each time. Ambient agents act as evaluators, assistants, and coworkers — running in the background, surfacing insights, and proactively helping with work as it gets executed.

Think of it as: the CEO has employees, the IC has coworkers. These agents fill those roles.

## Default Agents (Smart Defaults)

Ship with a set of pre-configured agents that provide immediate value out of the box. Users can tweak, disable, or add their own — but they shouldn't have to configure anything to get started.

### Code Reviewer
- Watches for completed tickets or new commits
- Runs automated review: correctness, patterns, security, test coverage
- Posts findings to the notification feed (TKTB-047)
- Configurable: review depth, focus areas, auto-approve thresholds

### Daily Briefing Assistant
- Generates a morning summary: what happened overnight (if agents ran), what's in progress, what's blocked, what needs attention
- Surfaces risks: stale tickets, tickets with low confidence, PRs waiting for review
- Could be a scheduled agent that writes to a briefing document or notification feed
- Configurable: schedule, verbosity, delivery method (notification, document, terminal output)

### Project Manager
- Monitors overall project status: ticket velocity, blocked items, scope creep
- Highlights risks: "3 tickets have been in-progress for 3+ days", "no tests written for last 5 tickets"
- Could evaluate real signals: build failures, test flakiness, PR cycle time
- Provides current status on demand or proactively when things drift
- Configurable: what signals to monitor, alert thresholds, reporting frequency

### Harness Evaluator (connects to TKTB-047)
- Monitors skill usage and effectiveness
- Suggests harness improvements via notification feed
- Already described in TKTB-047 but fits here as one of the ambient agents

### Prompt Curator (connects to TKTB-048)
- Watches for repeated prompt patterns
- Suggests saving prompts or promoting to skills
- Already described in TKTB-048 but fits here as well

## Architecture

### Agent Runtime
- Agents are configured as entries in a config (SQLite or `.agents/` directory)
- Each agent has: name, description, schedule (cron or event-triggered), prompt/instructions, enabled/disabled
- Agents run via the terminal (Bun.spawn or the PTY system) or as lightweight background processes
- Output goes to the notification feed, ticket comments, or dedicated documents

### Triggers
- **Scheduled**: cron-like (daily briefing at 9am, weekly review on Monday)
- **Event-driven**: on ticket status change, on commit, on PR creation, on build failure
- **Continuous**: always watching (file watcher pattern, like our SSE system)

### Configuration Philosophy

**The VS Code / code editor philosophy applies:**
- Smart defaults so any user gets immediate value on first use
- Everything is configurable — enable/disable individual agents, change schedules, modify prompts
- Power users can create entirely custom agents
- No agent is mandatory — the system works fine with all of them disabled
- Settings are layered: global defaults → user preferences → project overrides

This is the same tension as code editor extensions: too many defaults and it's bloated, too few and it's useless. The right balance is shipping 3-4 well-tuned default agents that cover the 80% use case, with a clean API for building custom ones.

### Agent Definition Format

```yaml
# .agents/code-reviewer.yaml
name: Code Reviewer
description: Reviews completed tickets for code quality
trigger:
  event: ticket.status.feedback  # runs when a ticket moves to feedback
schedule: null  # or "0 9 * * *" for daily
prompt: |
  Review the changes for ticket {{ticket_id}}. Focus on:
  - Correctness and edge cases
  - Adherence to project patterns
  - Test coverage
  - Security concerns
  Post your findings as agent notes on the ticket.
enabled: true
```

## The Balance

Can't over-prescribe agents — everything configurable, but smart defaults up front. The key insight from code editors:

1. **First 5 minutes**: user opens the tool, default agents are already running, they see a daily briefing, a code review on their last PR, a harness health check. Immediate value, no configuration.
2. **First week**: user disables the daily briefing (too verbose), tweaks the code reviewer to focus on security, adds a custom agent for their specific workflow.
3. **Ongoing**: user has a customized set of agents that match their workflow. Some default, some custom. They can share agent configs with teammates.

## Connection to Other Tickets

- **TKTB-047** (Harness observability): The harness evaluator is one of the ambient agents
- **TKTB-048** (Saved prompts): The prompt curator is one of the ambient agents  
- **TKTB-046** (Feedback loop): The code reviewer agent is the automated side of the feedback loop
- **TKTB-018** (Plan mode): Agents could help with plan creation and refinement

## Open Questions

- How do agents communicate with each other? Can the code reviewer trigger the project manager to update risk status?
- Where do agent outputs live? Notification feed vs. dedicated documents vs. ticket annotations?
- How do we prevent agent noise? Too many notifications = ignored notifications.
- Resource management: how many agents can run concurrently? Cost implications for API-calling agents?
- Should agents have memory across runs? Or is each invocation stateless?
- How does this relate to claude code's existing `/schedule` and hooks? Should we build on those or build our own runtime?
