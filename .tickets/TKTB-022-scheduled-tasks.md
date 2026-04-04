---
id: TKTB-022
title: Scheduled tasks
status: backlog
created: '2026-04-03T22:03:35.371Z'
updated: '2026-04-03T22:03:39.561Z'
---

It would be awesome if we could have scheduled tasks somehow. Even if it's just a button that adds to a users claude.md or agents.md and tells their agent to scan for scheduled tasks and execute them. 

The idea is that you might have scheduled tasks you want your agent to take on so we need a way to specify that and then whether we're running some kind of daemon process that scans and queues of tasks, or if we just surface the scheduled tasks in the UI with a button that kicks them off in a coding agent session, or just automatically gets picked up in the background by a headless agent, it'd be great to have this. 

This could be both a one time schedule (do this in the future) or running on a cron. One use case is you create a plan with your coding agent, but you don't want to be rate limited, so you wait for your subscription to reset, and then you schedule it to trigger. 

For one, we'll need to have better integration with coding agents so a person can kick off things from the UI to their coding agent whether that's headlessly, with certain permissions, or in their default terminal.
