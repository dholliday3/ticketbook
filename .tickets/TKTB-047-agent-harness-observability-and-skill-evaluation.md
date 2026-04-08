---
id: TKTB-047
title: Agent harness observability and skill evaluation
status: open
tags:
  - agent-experience
  - important
  - deferred-desktop
created: '2026-04-05T07:15:00.000Z'
updated: '2026-04-08T05:19:38.877Z'
---

## The Problem

Developers are configuring agent harnesses — CLAUDE.md files, custom skills (user-level and project-level), MCP servers, hooks — but have no visibility into how these configurations actually perform in real agent sessions. Key questions that are impossible to answer today:

- Is my custom skill actually being invoked? How often?
- When it's invoked, does it produce good outcomes or does the agent struggle with it?
- Which skills are stale, underperforming, or conflicting with each other?
- How does my harness perform differently across projects vs. globally?
- Am I missing skills that would help with common patterns in my workflow?

This is especially critical for the validation loops — helping developers create proper validation so they can use coding agents more autonomously.

## What We Need

### 1. Harness Inventory & Visibility

A clean view of the developer's full agent harness:
- **User-level config**: `~/.claude/CLAUDE.md`, user skills, global MCP servers
- **Project-level config**: project `CLAUDE.md`, project skills, project MCP servers, hooks
- **Effective config**: the merged view of what an agent actually sees when it starts a session in this project

This is the "what's in my harness?" dashboard. Developers are cobbling this together by reading config files manually. We surface it in the UI.

### 2. Skill Usage Tracking

Track when skills are invoked across agent sessions:
- Which skill was used
- In what context (ticket, plan, ad-hoc session)
- Whether the skill's output was accepted, modified, or rejected by the human
- Timestamps and frequency

This data could come from:
- MCP tool call logs (if we can access them)
- Agent session transcripts (if the agent reports back)
- A lightweight telemetry hook that the agent skill framework calls

### 3. Skill Evaluation Framework

An eval system — potentially an eval agent — that:
- **Tracks skill performance over time**: usage frequency, success rate, human override rate
- **Identifies stale skills**: skills that haven't been invoked in N sessions or that consistently get overridden
- **Identifies gaps**: patterns where the agent struggles or the human frequently intervenes, suggesting a skill could help
- **Recommends tuning**: "Your `commit` skill is being overridden 40% of the time — here's what humans are changing"
- **Recommends new skills**: based on usage patterns, project type, community skill registry

### 4. Harness Tuning Workflow

Help developers iterate on their harness:
- A/B test skill variants (try a modified skill for N sessions, compare outcomes)
- Diff view: "here's what changed in your harness since last week"
- Guided setup: "based on your project (React + Bun + ticketbook patterns), here are recommended skills"
- Validation loop builder: help create project-specific validation rules that agents follow

### 5. Skill Organization

Clean management of the skill portfolio:
- Which skills are user-level vs. project-level
- Which skills overlap or conflict
- Skill dependencies (skill A works best when skill B is also present)
- Easy enable/disable per project without deleting
- Version tracking — skill content changes over time

## The Bigger Picture

This connects directly to the autonomy question. The more confident a developer is in their harness, the more they can trust agents to work autonomously. The feedback loop is:

```
Configure harness → Agent works → Observe outcomes → Tune harness → Agent works better → More autonomy
```

Today, step 3 (observe outcomes) is completely missing. Developers have no data on whether their CLAUDE.md instructions, custom skills, or MCP servers are actually helping. They tune by gut feel and anecdote.

## Notification Feed

The eval agent runs in the background and posts notifications to a feed that the developer can review in the UI. Think of it like a health monitor for your harness:

- "Your `commit` skill hasn't been invoked in 14 sessions — consider removing or updating"
- "Agents are overriding your CLAUDE.md instruction about test coverage 60% of the time"
- "New community skill `db-migrations` matches patterns in your recent sessions"
- "Your `review-pr` skill is performing well — 95% acceptance rate across 23 invocations"

This feed lives in the ticketbook UI — maybe as a dedicated view or as a notification panel. The eval agent writes entries to SQLite, the UI polls or subscribes via SSE. Each notification can have an action: "View skill", "Edit instruction", "Dismiss", "Create ticket to fix".

## Skills Inventory View

A dedicated view showing the developer's full skill landscape:

**Global skills** (user-level, `~/.claude/`):
- List of all installed skills with name, description, last invoked, invocation count
- Status indicator: active / stale / underperforming
- Quick actions: edit, disable, view usage stats

**Project skills** (project-level, `.claude/`):
- Same view but scoped to the current project
- Shows which global skills are also active here (effective view)
- Highlights conflicts or overlaps between global and project skills

**Merged/effective view**:
- What the agent actually sees when starting a session
- CLAUDE.md instructions (global + project, rendered)
- MCP servers and their tools
- Hooks

This is the "cockpit" for the developer's agent configuration — one place to see everything, understand what's working, and make changes.

## Open Questions

- Where does this data live? SQLite alongside tickets? Separate analytics DB?
- How do we collect skill invocation data without being intrusive? Hooks? Agent self-reporting?
- Is the eval agent a background process that runs periodically, or on-demand?
- How do we handle the cold start — no data yet, but still want to be useful?
- What's the MVP? Probably just the harness inventory view + basic usage tracking, with eval as a later phase.
- How does this relate to PostHog or other analytics? Should we dogfood our own PostHog integration here?
