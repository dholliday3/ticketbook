---
id: TKTB-035
title: Create ticket uses modal
status: done
relatedTo:
  - TKTB-032
created: '2026-04-04T01:41:34.973Z'
updated: '2026-04-04T01:49:38.876Z'
---

When clicking on any new ticket button (on the kanban board or list view or anywhere) we should ONLY use the modal. So in the kanban board view, when we click the new ticket button, don't open the side panel, just open the modal. When we click on an existing ticket, we can open the side panel. 

\
Similar pattern for the List view, just use the modal for creating new tickets. We still want to open tickets in central view where we can see them and edit, but creating new tickets, we use the modal. This helps because now we can open and close the modal without saving an Untitled empty ticket cleanly.
