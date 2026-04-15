---
id: TKTB-017
title: Ticket creation metadata UI
status: done
created: '2026-04-03T21:32:52.047Z'
updated: '2026-04-04T00:05:20.658Z'
---

- Need to update all of the ticket metadata fields to user standard components. We need to use proper shadcn components.Make sure all of the components are standardized, using shadcn components, and are shared when possible.
- i want the tags input to be the same component type and interaction pattern as the project component. That way i can see what tags I already have, search, select multiple, and create on the fly. make sure you can select multiple tags. 
- Also, we have 3 places to add new tickets - the modal, the sidebar, and the inline page (when in list view). Can we make sure we use the same components from the add ticket modal in the sidebar and inline page ticket edit/creation view? But we want all of the metadata fields to be below the ticket description in the sidepanel.
- we also should have a kebab icon button for additional settings, such as blocked by, related to, assignee, epic, sprint, and project. for now, we'll keep the others in plain view.
