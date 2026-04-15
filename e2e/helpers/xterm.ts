/**
 * Playwright helpers for asserting on xterm.js terminal content.
 *
 * Requires the page to have been initialized with `__RELAY_E2E__ = true`
 * before navigation (see test.beforeEach). That flag makes Terminal.tsx
 * populate `window.__terminals` and `window.__terminalsReady` so we can
 * read the actual xterm buffer from tests.
 */

import type { Page } from "@playwright/test";

interface TerminalLike {
  buffer: { active: { length: number; getLine(i: number): { translateToString(trimRight: boolean): string } | undefined } };
}
interface WindowWithTerminals {
  __terminals?: Map<string, TerminalLike>;
  __terminalsReady?: Map<string, boolean>;
}

/**
 * Read the visible buffer of an xterm by its sessionId. Returns the joined
 * line contents (one per line). Returns empty string if the terminal isn't
 * registered yet.
 */
export async function readTerminalBuffer(page: Page, sessionId: string): Promise<string> {
  return await page.evaluate((id) => {
    const w = window as unknown as WindowWithTerminals;
    const term = w.__terminals?.get(id);
    if (!term) return "";
    const buf = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    return lines.join("\n");
  }, sessionId);
}

/**
 * Return the sessionId of the single currently-mounted terminal, or null.
 * TerminalPane.tsx only mounts the active tab's Terminal, so there should
 * only ever be one entry in the registry.
 */
export async function getActiveSessionId(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const w = window as unknown as WindowWithTerminals;
    if (!w.__terminals || w.__terminals.size === 0) return null;
    return [...w.__terminals.keys()][0] ?? null;
  });
}

/**
 * Wait until the terminal with the given sessionId has completed its
 * handshake with the server. Prefer the explicit ready marker, but treat a
 * populated buffer as ready too because replayed terminals after reload can
 * race the test harness and render before the marker is observed.
 */
export async function waitForTerminalReady(
  page: Page,
  sessionId: string,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate((id) => {
      const w = window as unknown as WindowWithTerminals;
      if (w.__terminalsReady?.get(id) === true) return true;

      const term = w.__terminals?.get(id);
      if (!term) return false;

      const buf = term.buffer.active;
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i);
        if (line && line.translateToString(true).trim().length > 0) return true;
      }

      return false;
    }, sessionId);
    if (ready) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`waitForTerminalReady timed out for sessionId=${sessionId}`);
}

/**
 * Wait until the active terminal's buffer contains the given substring or
 * matches the given regex.
 */
export async function waitForTerminalText(
  page: Page,
  needle: string | RegExp,
  opts: { timeoutMs?: number; sessionId?: string } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const re = typeof needle === "string"
    ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    : needle;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const id = opts.sessionId ?? (await getActiveSessionId(page));
    if (id) {
      const buf = await readTerminalBuffer(page, id);
      if (re.test(buf)) return buf;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`waitForTerminalText timed out for ${re}`);
}

/** Click the terminal container to focus it, then type via the keyboard. */
export async function typeIntoTerminal(page: Page, text: string): Promise<void> {
  await page.locator(".terminal-container").first().click();
  await page.keyboard.type(text);
}

/**
 * Delete every terminal session on the server via REST. Used in beforeEach
 * for test isolation.
 */
export async function deleteAllSessions(page: Page): Promise<void> {
  const res = await page.request.get("/api/terminal/sessions");
  if (!res.ok()) return;
  const { sessions } = await res.json() as { sessions: Array<{ id: string }> };
  for (const s of sessions) {
    await page.request.delete("/api/terminal/sessions", { data: { id: s.id } });
  }
}
