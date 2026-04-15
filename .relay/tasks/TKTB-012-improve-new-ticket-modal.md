---
id: TKTB-012
title: Improve new ticket modal.
status: done
created: '2026-04-03T20:49:08.159Z'
updated: '2026-04-03T21:02:24.859Z'
---

Metadata tags: \
The dropdowns for the new ticket modal should use shadcn components properly. It seems like the dropdown menu is the native html menu. We need to use all of the same components that we're using with the default in page ticket view/edit component that is used by default. We need to ensure we use shared components so we don't duplicate logic and potentially have different experiences. The project one is in particular incorrect. It also needs to include create new project.

Instead of using a title and then the input, let's have the button for the input have the title and then clicking on it will open a dropdown or focus the input field to make a change. So when something is selected, it'll show the value, and when it isn't it'll show the input title (i.e. the dropdown shows Open when selected, or Status). When it's the default title, make the font more muted, when selected it should be the main primary font color. \
\
Ticket Modal: \
The ticket modal should also expand as you write more, so the modal will expand vertically as more text is entered. Make it about 30% wider as well by default and maybe 20% taller. Include an expand button at the top that has a nice animated expand and expands the modal to be maybe 80% vh. 

Clicking escape before creating the ticket should save the ticket to draft.

Also, the cmd + N keyboard shortcut, because we're in a browser, will open a new browser window. Is there a way to capture the keyboard shortcut for this window? If not, we'll need a new one. cmd + shift + n opens an incognito window, so we can't use that.

Also, slash commands don't work in this new modal.\
\
\
Also, I want the ticket component to be more similar to linear where you have the ticket title, and the next input is the ticket description. And then on the modal, put all of the metadata interactions at the bottom after the description. In the desktop view, put them to the right in a vertical list. 
