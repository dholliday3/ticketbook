---
id: TKTB-041
title: Command menu
status: open
created: '2026-04-04T07:38:20.246Z'
updated: '2026-04-04T07:39:27.238Z'
---

Create a command menu (keyboard shortcut of cmd + K, replace the search keyboard shortcut) that will allow us to take various actions in the product.

So it can do things like switch list or board, search for tickets, open settings etc. almost any action in the product should be fair game.

I also want it to have agent kickoff commands. For now, I want copy all open tickets for agent. The rough idea is that i want to be able to copy a command and just paste the command into the terminal, or even better yet it just opens my terminal app with a window that has a prompt like "work on all open tickets (ticketID, ticketID2)". We can workshop this a bit to make it robust.

Linears command menu is context aware. So if you have a ticket opened, the top items are actions that are relevant to that ticket, like adding a filter, changing status etc. \
\
I think we'll keep it simpler for now, but we should have dividers for different sections so we can evolve it over time. 
