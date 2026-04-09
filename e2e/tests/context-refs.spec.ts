/**
 * Context refs e2e — exercises the TKTB-025 copilot context-ref flows
 * against the Tiptap-based CopilotPromptEditor:
 *
 *   - "Add to chat" button on task/plan detail inserts a ContextRef
 *     chip into the copilot input.
 *   - "Get feedback" / "Brainstorm" preset buttons pre-fill the input
 *     with a templated message containing an embedded chip.
 *   - Typing `@` opens a mention popover; Enter inserts the highlighted
 *     task/plan as a chip.
 *   - Sent messages render the marker as an interactive chip in the
 *     assistant conversation.
 *
 * The input is a contenteditable (not a textarea), so we assert on DOM
 * structure (chip elements) and text content rather than `toHaveValue`.
 * Runs against the stub copilot provider — expansion to `<context>`
 * blocks is covered by server unit tests and not re-asserted here.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";

const ASSISTANT_BUTTON_NAME = "Open assistant";
const EDITOR_TEST_ID = "copilot-prompt-editor";
const CHIP_TEST_ID = "copilot-input-context-ref";

interface CreatedTask {
  id: string;
  title: string;
}

interface CreatedPlan {
  id: string;
  title: string;
}

async function createTask(page: Page, title: string): Promise<CreatedTask> {
  const res = await page.request.post("/api/tasks", { data: { title } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as CreatedTask;
}

async function createPlan(page: Page, title: string): Promise<CreatedPlan> {
  const res = await page.request.post("/api/plans", { data: { title } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as CreatedPlan;
}

async function clearAllConversations(page: Page): Promise<void> {
  const res = await page.request.get("/api/copilot/conversations");
  if (!res.ok()) return;
  const data = (await res.json()) as { conversations: Array<{ id: string }> };
  for (const c of data.conversations) {
    await page.request.delete(`/api/copilot/conversations/${c.id}`);
  }
}

async function deleteAllTasks(page: Page): Promise<void> {
  const res = await page.request.get("/api/tasks");
  if (!res.ok()) return;
  const tasks = (await res.json()) as Array<{ id: string }>;
  for (const t of tasks) {
    await page.request.delete(`/api/tasks/${t.id}`);
  }
}

async function deleteAllPlans(page: Page): Promise<void> {
  const res = await page.request.get("/api/plans");
  if (!res.ok()) return;
  const plans = (await res.json()) as Array<{ id: string }>;
  for (const p of plans) {
    await page.request.delete(`/api/plans/${p.id}`);
  }
}

async function openTaskDetail(page: Page, task: CreatedTask): Promise<void> {
  await page.goto("/tasks");
  await page.getByRole("button", { name: new RegExp(task.title) }).click();
  await expect(page.getByRole("heading", { name: task.title })).toBeVisible();
}

async function openPlanDetail(page: Page, plan: CreatedPlan): Promise<void> {
  await page.goto("/plans");
  await page.getByRole("button", { name: new RegExp(plan.title) }).click();
  await expect(page.getByRole("heading", { name: plan.title })).toBeVisible();
}

function editor(page: Page): Locator {
  return page.getByTestId(EDITOR_TEST_ID);
}

async function waitForCopilotReady(page: Page): Promise<void> {
  await expect(editor(page)).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
}

/** Read the editor's current text content (chips render their id + title inside). */
async function editorText(page: Page): Promise<string> {
  return (
    (await editor(page).evaluate((el) => el.textContent?.trim() ?? "")) ?? ""
  );
}

async function openAssistant(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: ASSISTANT_BUTTON_NAME });
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
  }
}

test.beforeEach(async ({ page, context }) => {
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
  await deleteAllTasks(page);
  await deleteAllPlans(page);
});

test.describe('"Add to chat" button on task detail', () => {
  test("opens copilot panel and inserts a task chip into the input", async ({ page }) => {
    const task = await createTask(page, "Context ref target");
    await openTaskDetail(page, task);

    await page.getByRole("button", { name: "Add to copilot chat" }).click();
    await waitForCopilotReady(page);

    // A chip should be rendered inside the editor, carrying the task id.
    const chip = editor(page).getByTestId(CHIP_TEST_ID);
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute("data-id", task.id);
    await expect(chip).toHaveAttribute("data-kind", "task");
    // The chip renders the id + title as text.
    await expect(chip).toContainText(task.id);
    await expect(chip).toContainText("Context ref target");
  });

  test("appends with a leading space when the input already has text", async ({ page }) => {
    const task = await createTask(page, "Appendable");
    await openTaskDetail(page, task);

    await openAssistant(page);
    await waitForCopilotReady(page);

    // Type some prose into the editor.
    await editor(page).click();
    await page.keyboard.type("tell me about");

    // Click "Add to chat" — marker should append after the existing text.
    await page.getByRole("button", { name: "Add to copilot chat" }).click();

    const chip = editor(page).getByTestId(CHIP_TEST_ID);
    await expect(chip).toHaveCount(1);
    const text = await editorText(page);
    // "tell me about" followed by the chip (id + title concatenated by
    // textContent). The prose prefix must appear first.
    expect(text.startsWith("tell me about")).toBe(true);
    expect(text).toContain(task.id);
  });
});

test.describe('"Get feedback" preset on task detail', () => {
  test("pre-fills a templated review prompt referencing the task", async ({ page }) => {
    const task = await createTask(page, "Feedback me");
    await openTaskDetail(page, task);

    await page.getByRole("button", { name: "Get agent feedback on this task" }).click();
    await waitForCopilotReady(page);

    const chip = editor(page).getByTestId(CHIP_TEST_ID);
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute("data-id", task.id);

    const text = await editorText(page);
    expect(text).toContain("Please review");
    expect(text).toContain("give me feedback on scope");
    expect(text).toContain(task.id);
  });
});

test.describe('"Brainstorm" preset on plan detail', () => {
  test("pre-fills a brainstorm prompt referencing the plan", async ({ page }) => {
    const plan = await createPlan(page, "Big idea");
    await openPlanDetail(page, plan);

    await page.getByRole("button", { name: "Brainstorm this plan with the agent" }).click();
    await waitForCopilotReady(page);

    const chip = editor(page).getByTestId(CHIP_TEST_ID);
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute("data-id", plan.id);
    await expect(chip).toHaveAttribute("data-kind", "plan");

    const text = await editorText(page);
    expect(text).toContain("Let's brainstorm");
    expect(text).toContain("Walk me through your thinking");
  });
});

test.describe("@-mention popover", () => {
  test("typing @ opens the popover with matching tasks and plans", async ({ page }) => {
    const task = await createTask(page, "Mentionable task");
    const plan = await createPlan(page, "Mentionable plan");

    await page.goto("/tasks");
    await openAssistant(page);
    await waitForCopilotReady(page);

    await editor(page).click();
    await page.keyboard.type("@");

    const popover = page.getByRole("listbox", { name: "Context reference search" });
    await expect(popover).toBeVisible();
    await expect(popover.getByText(task.id)).toBeVisible();
    await expect(popover.getByText(plan.id)).toBeVisible();
  });

  test("selecting an item with Enter inserts a chip at the caret", async ({ page }) => {
    const task = await createTask(page, "Pick me");
    await page.goto("/tasks");
    await openAssistant(page);
    await waitForCopilotReady(page);

    await editor(page).click();
    await page.keyboard.type("hey @");
    // Only one task exists — it should be highlighted. Enter selects it.
    await page.keyboard.press("Enter");

    const chip = editor(page).getByTestId(CHIP_TEST_ID);
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute("data-id", task.id);

    const text = await editorText(page);
    expect(text.startsWith("hey ")).toBe(true);
    expect(text).toContain(task.id);
  });

  test("Escape closes the popover without inserting", async ({ page }) => {
    await createTask(page, "Escape test");
    await page.goto("/tasks");
    await openAssistant(page);
    await waitForCopilotReady(page);

    await editor(page).click();
    await page.keyboard.type("@");
    await expect(
      page.getByRole("listbox", { name: "Context reference search" }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("listbox", { name: "Context reference search" }),
    ).toHaveCount(0);
    // No chip was inserted.
    await expect(editor(page).getByTestId(CHIP_TEST_ID)).toHaveCount(0);
  });

  test("the popover floats above the caret, not pinned to the input edge", async ({ page }) => {
    await createTask(page, "Position test");
    await page.goto("/tasks");
    await openAssistant(page);
    await waitForCopilotReady(page);

    await editor(page).click();
    // Type enough prose that the caret sits well past the editor's
    // left padding. A caret-anchored popover should follow horizontally.
    await page.keyboard.type("look at this cool thing @");

    const popover = page.getByRole("listbox", { name: "Context reference search" });
    await expect(popover).toBeVisible();

    const editorBox = await editor(page).boundingBox();
    const popoverBox = await popover.boundingBox();
    expect(editorBox).not.toBeNull();
    expect(popoverBox).not.toBeNull();

    // The popover should sit above the editor's visible content.
    expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(
      editorBox!.y + 8,
    );
    // And its left edge should be noticeably inside the editor — the
    // caret after "look at this cool thing @" is well past the padding.
    expect(popoverBox!.x).toBeGreaterThan(editorBox!.x + 20);
  });
});

test.describe("chip rendering in sent messages", () => {
  test("a sent message containing a task chip renders as an interactive chip in the message bubble", async ({ page }) => {
    const task = await createTask(page, "Chip target");
    await openTaskDetail(page, task);

    // Use the "Add to chat" button to produce a chip, then submit by
    // pressing Enter in the editor.
    await page.getByRole("button", { name: "Add to copilot chat" }).click();
    await waitForCopilotReady(page);
    await editor(page).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");

    // Wait for the stub to finish streaming before asserting.
    await expect(page.getByText("Ready", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // The chip renders in the user message bubble as a button with an
    // accessible label of the form "Task <id>: <title>".
    const chipInMessage = page.getByRole("button", {
      name: new RegExp(`Task ${task.id}: Chip target`),
    });
    await expect(chipInMessage.first()).toBeVisible();
  });
});
