/**
 * Terminal emulator e2e tests — mirrors the manual scenarios we validated
 * after the handshake refactor. Each test exercises a different part of
 * the lifecycle (spawn, input, tab switch/reattach, refresh persistence,
 * pane close/reopen).
 */

import { test, expect } from "@playwright/test";
import {
  waitForTerminalReady,
  waitForTerminalText,
  typeIntoTerminal,
  getActiveSessionId,
  deleteAllSessions,
} from "../helpers/xterm.js";

test.beforeEach(async ({ page }) => {
  // Expose the e2e registry. Playwright gives each test a fresh browser
  // context by default, so localStorage is already clean — we only need to
  // set the flag that gates Terminal.tsx's registry exposure.
  // (Crucially: we do NOT clear localStorage here, because addInitScript
  // runs on every navigation including page.reload(), and clearing
  // relay-terminal-open would prevent the reload test from restoring
  // the pane.)
  await page.addInitScript(() => {
    (window as unknown as { __RELAY_E2E__: boolean }).__RELAY_E2E__ = true;
  });
  // Wipe any sessions left behind by the previous test on the shared backend.
  await deleteAllSessions(page);
});

test("opens terminal pane and renders Terminal 1 prompt", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open terminal" }).click();
  await expect(page.getByRole("button", { name: /^Terminal 1$/ })).toBeVisible();

  const id = await waitForSessionId(page);
  await waitForTerminalReady(page, id);
});

test("typing echo produces output in the terminal", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open terminal" }).click();
  const id = await waitForSessionId(page);
  await waitForTerminalReady(page, id);

  await typeIntoTerminal(page, "echo HELLO_E2E\n");
  await waitForTerminalText(page, /HELLO_E2E/);
});

test("clicking + creates Terminal 2 and activates it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open terminal" }).click();
  const id1 = await waitForSessionId(page);
  await waitForTerminalReady(page, id1);

  await page.getByRole("button", { name: "New terminal" }).click();
  await expect(page.getByRole("button", { name: /^Terminal 2$/ })).toBeVisible();

  const id2 = await waitForSessionId(page);
  expect(id2).not.toBe(id1);
  await waitForTerminalReady(page, id2);
});

test("switching back to Terminal 1 replays previous output (not just a blank prompt)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open terminal" }).click();
  const id1 = await waitForSessionId(page);
  await waitForTerminalReady(page, id1);

  // Type a marker so we can verify it appears in the buffer AFTER reattach
  await typeIntoTerminal(page, "echo SWITCH_PERSIST_MARK_E2E\n");
  await waitForTerminalText(page, /SWITCH_PERSIST_MARK_E2E/);

  // Create Terminal 2 and wait for it to be ready
  await page.getByRole("button", { name: "New terminal" }).click();
  const id2 = await waitForSessionId(page);
  await waitForTerminalReady(page, id2);

  // Switch back to Terminal 1 — new xterm instance mounts, reattach happens
  await page.getByRole("button", { name: /^Terminal 1$/ }).click();
  await waitForTerminalReady(page, id1);

  // The previous marker should be visible in the reattached Terminal 1
  // WITHOUT typing anything new (this is the whole point of persistence)
  await waitForTerminalText(page, /SWITCH_PERSIST_MARK_E2E/, { timeoutMs: 3000 });
});

test("page reload restores tabs AND previous output", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open terminal" }).click();
  const id1 = await waitForSessionId(page);
  await waitForTerminalReady(page, id1);

  // Type a marker in Terminal 1 before reloading
  await typeIntoTerminal(page, "echo RELOAD_PERSIST_MARK_E2E\n");
  await waitForTerminalText(page, /RELOAD_PERSIST_MARK_E2E/);

  await page.getByRole("button", { name: "New terminal" }).click();
  const id2 = await waitForSessionId(page);
  await waitForTerminalReady(page, id2);

  await page.reload();
  // Both tabs restored
  await expect(page.getByRole("button", { name: /^Terminal 1$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Terminal 2$/ })).toBeVisible();

  // Activate Terminal 1 (which tab is active after reload depends on
  // localStorage; click explicitly to be sure)
  await page.getByRole("button", { name: /^Terminal 1$/ }).click();
  const id1After = await waitForSessionId(page);
  await waitForTerminalReady(page, id1After);

  // The marker from before the reload should be visible in the replayed buffer
  await waitForTerminalText(page, /RELOAD_PERSIST_MARK_E2E/, { timeoutMs: 3000 });
});

test("closing the last tab closes the pane; reopening restores the session", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open terminal" }).click();
  const id1 = await waitForSessionId(page);
  await waitForTerminalReady(page, id1);

  // Close the only tab — should close the pane (not create a new tab)
  await page.getByRole("button", { name: "Close terminal tab" }).click();

  // The pane is gone: the "Open terminal" button is back
  await expect(page.getByRole("button", { name: "Open terminal" })).toBeVisible();

  // Reopen — the persisted session should reattach
  await page.getByRole("button", { name: "Open terminal" }).click();
  await expect(page.getByRole("button", { name: /^Terminal 1$/ })).toBeVisible();
  const idAfter = await waitForSessionId(page);
  await waitForTerminalReady(page, idAfter);
});

/**
 * Poll until a terminal is registered in window.__terminals and return its
 * sessionId. Short retry loop — the registry entry appears synchronously
 * inside the Terminal.tsx effect after xterm.open.
 */
async function waitForSessionId(page: import("@playwright/test").Page, timeoutMs = 5_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const id = await getActiveSessionId(page);
    if (id) return id;
    await page.waitForTimeout(50);
  }
  throw new Error("waitForSessionId timed out — no terminal in registry");
}
