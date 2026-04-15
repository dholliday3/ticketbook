---
id: TKTB-045
title: Get rid of sheet for kanban view
status: done
created: '2026-04-05T06:21:23.509Z'
updated: '2026-04-09T12:15:09.303Z'
---

in the kanban view, we need to get rid of the sheet for viewing a ticket. Instead, let's just use a modal. Here's the key, we need a modal that will open in the center of the kanban view, not the screen, because we now have a terminal window. Also, it should only close if we click on the outside of the modal in the kanban board area, but stay open if we click on the terminal or in any of the app chrome. 

If there isn't a clean way to implement this, we need to just open the ticket in its own individual page, when clicking from the kanban view. The idea is that we need to be able to reference tickets from the terminal as we'll likely be multi-tasking.
