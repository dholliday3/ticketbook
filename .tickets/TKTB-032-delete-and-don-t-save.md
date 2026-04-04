---
id: TKTB-032
title: Delete and don't save
status: done
created: '2026-04-04T01:33:56.609Z'
updated: '2026-04-04T01:50:01.374Z'
---

When you click new ticket, but then close, we shouldn't automatically save that ticket until something has been changed about the ticket. Is that possible to cleanly do? \
\
So if a ticket gets added initially, the user shouldnt' be forced to archive/delete, it just shouldn't save. But if they save anything, then it gets created and they have to explicitly delete/archive.

I think this is only happening for the sidepanel (which we're getting rid of) look at TKTB-035, and for the in page ticket component?

This should be handled by having all new tickets be opened in a modal. Can you confirm that? 
