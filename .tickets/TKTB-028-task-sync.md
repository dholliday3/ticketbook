---
id: TKTB-028
title: Task sync
status: backlog
tags:
  - ideas
created: '2026-04-04T00:04:08.167Z'
updated: '2026-04-04T00:04:20.710Z'
---

I want the ability to create, view, and collaborate on tickets. The tradeoff of using git is that we need git operations to modify code. I'm wondering if there's a streamlined way to create tickets from any client that could maybe automatically open a PR in github to pull them in? Maybe this is overkill for now, we don't want to over do it. 

The other thing is we should support different types of task tracking. There's beads, seeds, and json that people use for ralph wiggum and other agentic frameworks, it'd be nice to support those options. Especially bc our UI would win over current users of those task tracking systems. In the future, it'd be nice to potentially support Linear or just a deployable or managed database for tasks so that we can decouple from the codebase and in that case our CLI would need a different way to plugin to coding agents and the UI to still maintain the same streamlined brainstorming, planning, task tracking, agent handoff, and observability.
