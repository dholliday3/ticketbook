---
id: TKTB-018
title: Plan mode ideation
status: done
order: 750
tags:
  - brainstorm
created: '2026-04-03T21:47:13.407Z'
updated: '2026-04-09T03:03:17.241Z'
---

We need a way to better connect plan mode with a clean UX. Right now, this is about tasks. But agents can take on large efforts, and each task should be flexible enough to handle various sizes of tasks from plans to little tickets.

I'm wondering if i need to rethink the mental model a bit. We might not even need epics and cycles for instance, that's not a mental model that solo developers are going to use. We need to think through a better mental model so that relay fits cleanly in the development lifecycle. It can't be everything, but it needs to be generally flexible and useful at planning, tracking, and observing implementation by coding agents. Keep in mind, this is all about coding agents and humans, not about organizing work in larger organizations. Now you can't implement everything at once. There's a theoretical limit of how much you can work on at once with agents. There's natural project sequencing. We also can't do everything. But relay should be more than just small tickets, but it should overall evolve to slot well into the whole new developer approach where devs are focusing more on planning, prompting, and observing/guiding agents as the agents implement. This means that humans aren't as aware of all the nitty gritty details, are potentially juggling multiple tasks, experincing lots of context switching, and don't have context of important implementation details. Of course, relay doesn't replace documenation and simply asking an agent for context based on the code. Code is self-documenting. The part that isn't self-documenting is the planning, ticketing, agent observation. That's the parth taht we need to figure out.

I'm wondering if we just need a separate planning space that's separate from tickets. And then make it easy to create a plan, use claude code to edit the plan, and then have it either cut tickets and track them with relay tickets or just simply implement. Either way, tickets and plans are individually useful and also useful in combo. The developer needs to have choice with good opinions that fit most mental models and workflows.\
\
\
A few other tangential ideas:

- an agent will implement a ticket, but even though it might mark it as done, that might not be true bc it didn't implement it properly. We need validation. So maybe instead of done, we need a confirmation status? For now, it's better for us to iron out our statuses to have defaults that make sense for 80% of people (if that's possible) and then we should introduce some flexibility just like linear or notion. \\
- we need closer interactions between creating a ticket or creating a plan and our agents. One one hand, i like that i can talk to claude and just cut it loose to work, but then i lose track of what it's done. I also like planning with claude bc it does a good job at taking my rambling thoughts and making a concrete plan based on the reality of the code or based on external research or its own knowledge. The issue is that i still want a clean UI for creating and reading my artifacts (tickets, plans). A code editor isn't enough, bc it's oriented around all files, not tickets and plans. So i'm very convinced that we need an app with UI that is more closely tied to how humans are converging to using coding agents. They're spending a lot of time planning and capturing tasks, they're brainstorming with their agents, and then they're kicking off agents to do work and then closing the loop to test, evaluate code, and gather relevant context that only the agent has bc the human isn't implementing the pieces by hand anymore. And that's only increasing bc agents are more capable and more autonomous.
- Feedback is really important. The workflow is that i create tickets, and then maybe i kick them off from the product to an agent, and then i need to be able to observe the agent and ideally give it feedback. I need the agent to be able to bring me back into the loop instead of just assuming it completed the task correctly. This is especially important for larger tickets that have multiple tasks and more subjective completion criteria. But we can't build some kind of rigid system, it needs to have a simple mental model and structure to give flexibility for humans and agents. Just capture the data necessary for our ui or agent to hook into to display something like (feedback needed).
- this is really circling on the idea that devs are mainly curators of ideas and plans and they're delating to agents. I'm immediately feeling the need for this tool to help me brainstorm, plan, track tickets etc. and maybe even handle my skills and other documentation, really as a command center of context, to better reflect the true mental model of building software which is now much more removed from the code and much more about project/product management.
- The key is that, much like a coding editor or a tool like linear, you can't be too rigid. If you're too rigid but you need the right set of opinionated design and defaults so that any user can jump in and immediately get a mental model of how to use this. Especially better if this tool just fits the majority of people's mental model, similar to how a coding editor makes a lot of sense to mose. Vim doesn't make sense to most, but vscode does, whether they love it or not. Right now, people are cobbling together different tools to build projects because none of the tools seem to reflect the way that coding has evolved. Most people are managing their projects in a different platform (linear, notion) and then kicking off their coding agents from whatever terminal or agent coding gui (codex, claude code, conductor, t3 code). But there's a real disconnect between the two, and as models get more capable, the need to shift more of the workflow focus on the project/product management side. And to that note, product management is the product brainstorming, design, and even technical implementation (mainly high level system design, patterns, libraries and less so specific code implementation) and project management is about delegation, sequencing, observing, surfacing relevant context, course correcting etc. which is already happening by humans just managing various claude code sessions + PRs, which results in a ton of context switching and overwhelm.
- The existing tools require too much jumping around. I don't want my project plans/tickets to live in a different tool, i want them close to the implementaiton to serve as context and history. I also want my coding agent to help me create plans and tickets. Of course, the limitation is git itself. Tickets should ideally be visible to all, but maybe that's a hurdle we live with. Optimize for solo devs, figure out how to build this for multiple. We're moving in a direction of solo devs being very capable, and this tool fits that model. Collaboration will eventually be useful. <https://tryhamster.com/> is a good resource for the collaboration model.

---

## Plan Mode — Concrete Requirements

**The core insight**: Users are already doing planning with agents — they're going back and forth with claude code, writing markdown files scattered in their repo or saved locally. We need to provide a clean, first-class space for this. The key reference is Plannotator — a plugin that surfaces claude code plans in a nice UI. Humans write plans with agents doing most of the writing. They're iterating.

### What we know for sure

1. **Plan mode is essential**. A distinct mode/space for creating plans that live in the codebase.
2. **Plans are collaborative artifacts** — human starts with rough ideas, agent structures them, human refines, agent adds implementation detail, etc. The back-and-forth is the feature.
3. **Plans connect to execution** — a plan can be:
   - Kicked off as a single agent session
   - Split into multiple tickets that get tracked
   - Left as documentation/context for future work
   - Any combination — flexibility is key
4. **Plans live in the code** — not in a separate SaaS. They're `.md` files in a `.plans/` directory (or similar), version-controlled, available as context for agents.
5. **Project context / system instructions** — there's a need for persistent context that isn't a plan or a ticket. Things like "this project uses Bun, not Node", "always use our shared MetaFields components", "prefer SQLite over external DBs". This is closer to CLAUDE.md but surfaced in the UI.

### The right abstraction

The risk is over-engineering. Here's a minimal model that covers the use cases:

**Three document types, one UI:**

- **Tickets** (what we have) — discrete units of work with status, assignee, metadata
- **Plans** — longer-form documents for thinking through approach before execution. A plan can reference tickets, can be converted to tickets, can be annotated.
- **Context** — persistent project-level instructions/notes (like CLAUDE.md but editable in the UI)

Plans are just markdown files with frontmatter, same as tickets. The difference is they have a different schema (no status/priority — instead they have phases, decisions, open questions) and they live in a different directory (`.plans/`).

**Plan lifecycle:**

1. Human creates a plan (blank or from a prompt)
2. Human + agent iterate on the plan via the UI or terminal
3. Plan reaches a "ready" state
4. Human can: execute it directly, cut tickets from it, or just leave it as documentation
5. Agent references the plan during implementation for context

**What this is NOT:**

- Not a full project management system
- Not a rigid workflow engine
- Not a replacement for documentation

### Implementation approach

**Phase 1 — Plans as documents:**

- `.plans/` directory with markdown files + frontmatter
- Plan schema: `id`, `title`, `status` (draft/active/completed), `created`, `updated`
- CRUD API + MCP tools (same pattern as tickets)
- UI: plan list + editor in a new view mode, using the same tiptap editor

**Phase 2 — Plan-to-ticket flow:**

- Button to "cut tickets" from a plan — parses the plan for actionable items, creates ticket drafts
- Plans can link to tickets they spawned (like `refs`)
- Tickets can reference their source plan

**Phase 3 — Agent integration:**

- MCP tools: `create_plan`, `update_plan`, `list_plans`
- Agent can read plans for context during implementation
- Agent can update plan status as work progresses

**Phase 4 — Context documents:**

- Persistent project context editable in the UI
- Automatically included in agent prompts via MCP
- Like CLAUDE.md but with a UI and version history

---

## Open Questions

- Should plans and tickets share the same editor/viewer, just with different metadata? Or should plans have a more document-oriented layout (wider, no sidebar metadata)?
- How does plan iteration with an agent actually work in the UI? Is it a chat-like interface, or just the human editing the markdown and asking the agent to review via terminal?
- What's the right granularity for "cutting tickets"? Should the agent propose tickets and the human approves, or should it be more manual?
- How do we handle the case where a plan evolves during implementation? The plan says one thing but the agent discovered something different — does the plan get updated automatically?
