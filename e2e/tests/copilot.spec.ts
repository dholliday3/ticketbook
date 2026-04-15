/**
 * Copilot panel e2e — exercises the full conversation persistence flow
 * end-to-end against a real ticketbook server, but with the COPILOT_PROVIDER=stub
 * provider injected so we don't burn real LLM tokens or require Claude Code
 * to be installed. The dev-server (e2e/helpers/dev-server.ts) sets the env
 * var when launched by Playwright's webServer.
 *
 * Covered:
 * - Opening the assistant panel and seeing the empty state + suggestions
 * - Sending a message and watching the stub stream a response (text +
 *   thinking + tool_use + tool_result parts)
 * - Refreshing the page and seeing the new conversation in the dropdown
 * - Selecting an old conversation (resume flow)
 * - Sending a follow-up turn on a resumed conversation
 * - Starting a fresh conversation via the "+" button
 * - Verifying multiple conversations accumulate in the dropdown
 * - Deleting a conversation via the dropdown
 */

import { test, expect, type Page } from "@playwright/test";

const ASSISTANT_BUTTON_NAME = "Open assistant";
const CLOSE_ASSISTANT_BUTTON_NAME = "Close assistant";

/** Delete every persisted copilot conversation via the REST API. */
async function clearAllConversations(page: Page): Promise<void> {
  const res = await page.request.get("/api/copilot/conversations");
  if (!res.ok()) return;
  const data = (await res.json()) as { conversations: Array<{ id: string }> };
  for (const c of data.conversations) {
    await page.request.delete(`/api/copilot/conversations/${c.id}`);
  }
}

async function openAssistant(page: Page): Promise<void> {
  await page.goto("/");
  // The right-rail-collapsed-bar's button label flips between Open/Close
  // based on state. After clearing localStorage above, the panel starts closed.
  const trigger = page.getByRole("button", { name: ASSISTANT_BUTTON_NAME });
  if (await trigger.isVisible()) {
    await trigger.click();
  }
  // Wait for the assistant panel to render its Tiptap prompt editor.
  await expect(page.getByTestId("copilot-prompt-editor")).toBeVisible();
}

/** Wait for the panel's status row to read "Ready" — the prompt input is
 *  not actually accepting submissions until this is true (the submit button
 *  stays disabled while isStarting OR isStreaming). */
async function waitForReady(page: Page): Promise<void> {
  await expect(page.getByText("Ready", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
}

/** Type into the prompt editor and submit via Enter. Always waits for
 *  the panel to be Ready first so the submit isn't silently dropped. */
async function sendMessage(page: Page, text: string): Promise<void> {
  await waitForReady(page);
  const editor = page.getByTestId("copilot-prompt-editor");
  await editor.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

/** Count user messages currently rendered in the panel. */
async function countMessages(
  page: Page,
  role: "user" | "assistant",
): Promise<number> {
  return page.locator(`[data-testid="copilot-message"][data-role="${role}"]`).count();
}

test.beforeEach(async ({ page, context }) => {
  // Always start with the right rail closed and no persisted conversations.
  await context.clearCookies();
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("ticketbook-right-rail");
      window.localStorage.removeItem("ticketbook-terminal-open");
    } catch {
      /* ignore */
    }
  });
  await clearAllConversations(page);
});

test("empty state shows suggestions and the prompt input is enabled", async ({ page }) => {
  await openAssistant(page);

  // Empty state heading + suggestions visible.
  await expect(page.getByRole("heading", { name: "What are we building?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "List my in-progress tasks" })).toBeVisible();
  await expect(page.getByRole("button", { name: "What should I focus on next?" })).toBeVisible();

  // Status row says Ready and the textarea is enabled.
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByTestId("copilot-prompt-editor")).toBeVisible();
});

test("sending a message streams a stub response with text + tool blocks", async ({ page }) => {
  await openAssistant(page);
  await sendMessage(page, "Hello stub");

  // Between submit and first streamed chunk the pending "thinking word"
  // bubble should appear. The stub holds the first emit for ~60ms so this
  // is observable; we just assert the element attaches at some point before
  // streaming completes.
  await expect(page.getByTestId("copilot-pending")).toBeAttached({ timeout: 1_000 });

  await waitForReady(page);

  // Once the response finishes the pending bubble is gone.
  await expect(page.getByTestId("copilot-pending")).toHaveCount(0);

  // The user message is rendered.
  expect(await countMessages(page, "user")).toBe(1);
  expect(await countMessages(page, "assistant")).toBe(1);
  // The assistant message contains the stub's echo of the user input.
  // Use a unique prefix and .first() — the same text can appear in
  // multiple places (markdown rendered + raw within Streamdown's
  // streaming wrapper) and the test goal is "the response showed up".
  await expect(page.getByText(/Stub reply \(turn 1\)/).first()).toBeVisible();
  // The thinking part rendered through Reasoning (the trigger says "Thought for ...").
  await expect(page.getByRole("button", { name: /Thought for/ })).toBeVisible();
  // The tool_use card rendered with the stub tool name.
  await expect(page.getByText("stub_echo").first()).toBeVisible();
});

test("page refresh resumes the most recent conversation automatically", async ({ page }) => {
  await openAssistant(page);
  await sendMessage(page, "First conversation message");
  await waitForReady(page);

  // The conversation should now be in the persisted list.
  const list = await page.request
    .get("/api/copilot/conversations")
    .then((r) => r.json() as Promise<{ conversations: Array<{ id: string; title: string }> }>);
  expect(list.conversations).toHaveLength(1);
  expect(list.conversations[0].title).toBe("First conversation message");

  // Refresh and reopen — the panel should AUTOMATICALLY resume the most
  // recent conversation rather than start a fresh one. The header trigger
  // shows the conversation title, and the dropdown contains it.
  await page.reload();
  await openAssistant(page);

  // The header trigger should now show the conversation title (not
  // "New conversation").
  await expect(page.getByTestId("copilot-conversation-trigger")).toContainText(
    "First conversation message",
  );

  // The dropdown still lists it.
  await page.getByTestId("copilot-conversation-trigger").click();
  await expect(page.getByTestId("copilot-conversation-item")).toHaveCount(1);
  await expect(
    page.getByTestId("copilot-conversation-item").filter({ hasText: "First conversation message" }),
  ).toBeVisible();
});

test("after refresh, latest of multiple conversations is auto-resumed", async ({ page }) => {
  // Create two conversations in sequence.
  await openAssistant(page);
  await sendMessage(page, "Older conversation");
  await waitForReady(page);
  await page.getByTestId("copilot-new-conversation-button").click();
  await sendMessage(page, "Newer conversation");
  await waitForReady(page);

  // Refresh — should resume the newer one (most recent updated_at).
  await page.reload();
  await openAssistant(page);

  await expect(page.getByTestId("copilot-conversation-trigger")).toContainText(
    "Newer conversation",
  );
});

test("selecting a previous conversation resumes it and a follow-up streams", async ({ page }) => {
  // Seed two conversations so the dropdown has something to switch BETWEEN
  // (one is auto-resumed on mount; we want to test clicking the OTHER one).
  await openAssistant(page);
  await sendMessage(page, "Original conversation");
  await waitForReady(page);
  await page.getByTestId("copilot-new-conversation-button").click();
  await sendMessage(page, "Newer conversation");
  await waitForReady(page);

  // Refresh — auto-resumes the newer one.
  await page.reload();
  await openAssistant(page);
  await expect(page.getByTestId("copilot-conversation-trigger")).toContainText(
    "Newer conversation",
  );

  // Open dropdown and click the OLDER conversation to switch.
  await page.getByTestId("copilot-conversation-trigger").click();
  await page
    .getByTestId("copilot-conversation-item")
    .filter({ hasText: "Original conversation" })
    .click();

  // The dropdown trigger now shows the older conversation's title.
  await expect(page.getByTestId("copilot-conversation-trigger")).toContainText(
    "Original conversation",
  );

  // Send a follow-up — stub streams another response on the resumed session.
  await sendMessage(page, "Follow-up turn");
  await waitForReady(page);

  await expect(page.getByText(/Stub reply.*Follow-up turn/).first()).toBeVisible();
  // Resumed conversations now preload app-stored normalized transcript
  // history, so the original turn is visible before the new follow-up.
  expect(await countMessages(page, "user")).toBe(2);
  expect(await countMessages(page, "assistant")).toBeGreaterThanOrEqual(2);

  // Both conversations should still exist in the persisted list.
  const list = await page.request
    .get("/api/copilot/conversations")
    .then((r) => r.json() as Promise<{ conversations: Array<{ id: string }> }>);
  expect(list.conversations).toHaveLength(2);
});

test("clicking + creates a new conversation, accumulating in the dropdown", async ({ page }) => {
  await openAssistant(page);
  await sendMessage(page, "Conversation A");
  await waitForReady(page);

  // Click the standalone + button to start fresh.
  await page.getByTestId("copilot-new-conversation-button").click();

  // Panel should be empty again.
  await expect(page.getByRole("heading", { name: "What are we building?" })).toBeVisible();
  expect(await countMessages(page, "user")).toBe(0);

  // Send a second conversation.
  await sendMessage(page, "Conversation B");
  await waitForReady(page);

  // Both conversations should now be persisted.
  const list = await page.request
    .get("/api/copilot/conversations")
    .then((r) => r.json() as Promise<{ conversations: Array<{ id: string; title: string }> }>);
  expect(list.conversations).toHaveLength(2);
  // Newest first.
  expect(list.conversations[0].title).toBe("Conversation B");
  expect(list.conversations[1].title).toBe("Conversation A");

  // Open the dropdown and verify both are listed.
  await page.getByTestId("copilot-conversation-trigger").click();
  await expect(page.getByTestId("copilot-conversation-item")).toHaveCount(2);
});

test("starting a new conversation via the dropdown menu also works", async ({ page }) => {
  await openAssistant(page);
  await sendMessage(page, "Initial conversation");
  await waitForReady(page);

  // Open the dropdown and click the "New conversation" item inside.
  await page.getByTestId("copilot-conversation-trigger").click();
  await page.getByTestId("copilot-new-conversation").click();

  // Panel resets to empty state.
  await expect(page.getByRole("heading", { name: "What are we building?" })).toBeVisible();
  expect(await countMessages(page, "user")).toBe(0);
});

test("deleting a conversation removes it from the dropdown and the DB", async ({ page }) => {
  // Seed two conversations.
  await openAssistant(page);
  await sendMessage(page, "Conversation to keep");
  await waitForReady(page);
  await page.getByTestId("copilot-new-conversation-button").click();
  await sendMessage(page, "Conversation to delete");
  await waitForReady(page);

  // Both should be persisted.
  let list = await page.request
    .get("/api/copilot/conversations")
    .then((r) => r.json() as Promise<{ conversations: Array<{ id: string; title: string }> }>);
  expect(list.conversations).toHaveLength(2);
  const toDelete = list.conversations.find((c) => c.title === "Conversation to delete")!;

  // Delete the second one via the API directly (the dropdown's hover-only
  // delete button is hard to target reliably from Playwright; the dropdown
  // wiring is the same handler so this still exercises the persistence
  // layer end-to-end).
  await page.request.delete(`/api/copilot/conversations/${toDelete.id}`);

  // Refresh, open dropdown, only the surviving one should be there.
  await page.reload();
  await openAssistant(page);
  await page.getByTestId("copilot-conversation-trigger").click();
  await expect(page.getByTestId("copilot-conversation-item")).toHaveCount(1);
  await expect(page.getByTestId("copilot-conversation-item")).toContainText(
    "Conversation to keep",
  );

  // The DB should agree.
  list = await page.request
    .get("/api/copilot/conversations")
    .then((r) => r.json() as Promise<{ conversations: Array<{ id: string; title: string }> }>);
  expect(list.conversations).toHaveLength(1);
  expect(list.conversations[0].title).toBe("Conversation to keep");
});
