---
id: TKTB-051
title: Project soul and developer philosophy
status: backlog
tags:
  - agent-experience
  - important
  - agent-editor
relatedTo:
  - TKTB-049
  - TKTB-018
created: '2026-04-05T08:15:00.000Z'
updated: '2026-04-12T03:56:42.253Z'
---

## The Gap

There's a layer above plans and tickets that doesn't have a clean home. Two distinct but related things:

1. **Project soul** — the overarching vision, direction, and principles of what you're building. Not "implement feature X" (that's a ticket) or "how should we build the auth system" (that's a plan). It's "what is this project trying to be, what's the philosophy behind our decisions, where are we headed." Projects evolve, and this evolves with them — but it should be explicit, not just vibes scattered across commit messages and slack threads.

2. **Developer philosophy** — your personal approach to building. "I prefer simplicity over completeness." "Ship fast, refine later." "Never add a dependency when 20 lines of code will do." These shape every decision an agent makes on your behalf, but right now they're implicit — maybe partially captured in CLAUDE.md, maybe not captured at all.

## Why This Matters for Agents

CLAUDE.md and skills handle the tactical: "use Bun not Node", "run tests before committing." But they don't capture the strategic: "we're building a local-first dev tool for solo developers, not a SaaS for teams" or "keep the scope tight — if it's not directly useful for the plan-execute-observe loop, it's out of scope."

Without this, agents drift. They add features nobody asked for, over-engineer solutions, or build in a direction that doesn't align with where the project is going. The developer has to constantly course-correct, which defeats the purpose of autonomous agents.

### The soul.md / openclaw analogy

Similar to openclaw's `soul.md` concept — a living document that defines the identity and direction of the project. But more actionable:

- Not just descriptive ("we value simplicity") but prescriptive ("when choosing between two approaches, pick the one with fewer moving parts")
- Not static — it evolves as the project evolves, and the tool should help surface when it needs updating
- Not just for coding agents — it's also context for the ambient platform agents (TKTB-049) who are evaluating, summarizing, and course-correcting

## What This Looks Like

### Project Soul Document

A first-class document type (alongside tickets and plans):

```markdown
# Project Soul: Ticketbook

## Vision
A local-first, git-backed project management tool that fits how developers
actually work with coding agents. Not a SaaS. Not for large teams. For solo
developers and small teams who live in the terminal and want their project
context close to their code.

## Principles
- Simple over complete — ship what's needed now, not what might be needed
- Local-first — everything works offline, data lives in the repo
- Agent-native — every feature should be usable by both humans and agents
- Opinionated defaults, flexible overrides — like a good code editor

## Current Direction
Building the core loop: plan → ticket → execute → observe → validate.
Not yet focused on: collaboration, cloud sync, marketplace.

## Anti-patterns
- Don't add features that only make sense for large organizations
- Don't build integrations before the core is solid
- Don't optimize for scale before optimizing for usefulness
```

### Developer Philosophy Document

User-level, applies across all projects:

```markdown
# My Philosophy

## Building
- Keep things simple, focus on what makes sense to build now
- Prefer fewer abstractions over premature generalization
- If I'm getting out of hand, remind me to focus

## Working with Agents
- For small changes with test coverage, trust the agent and move to done
- For UI changes, always validate visually
- I prefer concise debriefs — tell me what changed and what to check

## Decision Making
- When in doubt, ship the simpler version
- It's ok to hardcode now and abstract later
- Don't block on perfect — good enough that works beats perfect that doesn't
```

### How Agents Use This

**Coding agents**: The soul/philosophy is included as context (like CLAUDE.md but higher-level). When an agent is about to make a design decision, it references the principles. "The project soul says 'simple over complete' — I'll implement the straightforward version."

**Ambient agents**: This is where it gets really interesting. The project manager agent from TKTB-049 can use the soul to evaluate whether work is aligned:
- "You've created 5 tickets this week for collaboration features, but the soul says 'not yet focused on collaboration.' Want to revisit priorities?"
- "The last 3 PRs added significant complexity. Your philosophy says 'keep things simple.' Flagging for review."
- "Current velocity is spread across 8 different areas. The soul says the current direction is the core plan-execute-observe loop. 3 of these tickets are outside that scope."

**This isn't hard-coded behavior** — the agent reads the soul document and reasons about alignment. Different projects with different souls get different feedback. A project whose soul says "move fast and break things" gets very different nudges than one that says "stability above all."

### Integration Points

- **Every LLM turn (for planning)**: Soul document included as system-level context when doing planning or brainstorming
- **Ambient agents**: Included as core context for evaluation and course-correction agents
- **Ticket creation**: Agent can reference soul when suggesting priority or scope
- **Plan review**: "Does this plan align with the project soul?" as an automatic check

## The Living Document Problem

The soul should evolve. But it shouldn't change on every commit. The right cadence:
- Review quarterly (or when major direction shifts happen)
- Ambient agent can suggest updates: "Based on your last month of work, your actual priorities seem to have shifted from X to Y. Update the soul?"
- Version-controlled like everything else — git history shows how the project's direction evolved

## Storage

- Project soul: `.soul.md` or `.ticketbook/soul.md` at the project root
- Developer philosophy: `~/.ticketbook/philosophy.md` or similar user-level location
- Both rendered and editable in the ticketbook UI
- Both included via MCP when agents request project context

## Open Questions

- How much of this overlaps with CLAUDE.md? Should the soul replace CLAUDE.md or complement it? (Probably complement — CLAUDE.md is tactical, soul is strategic)
- How do we prevent the soul from becoming stale? Auto-review reminders? Ambient agent nudges?
- Should the soul be structured (YAML frontmatter with key fields) or freeform markdown?
- How verbose should the ambient feedback be? A gentle nudge vs. a blocking warning?
- Can the soul document itself be co-created with an agent? "Help me define my project soul based on what we've built so far"
