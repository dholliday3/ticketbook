import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTask, createPlan } from "@ticketbook/core";
import { expandContextRefs } from "./context-refs.js";

describe("expandContextRefs", () => {
  let root: string;
  let tasksDir: string;
  let plansDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ticketbook-ctxrefs-"));
    tasksDir = join(root, ".tasks");
    plansDir = join(root, ".plans");
    await mkdir(tasksDir, { recursive: true });
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(tasksDir, ".counter"), "0", "utf-8");
    await writeFile(join(plansDir, ".counter"), "0", "utf-8");
    await writeFile(join(tasksDir, ".config.yaml"), "prefix: TKT\n", "utf-8");
    await writeFile(join(plansDir, ".config.yaml"), "prefix: PLAN\n", "utf-8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("returns text unchanged when no markers", async () => {
    const input = "Just a regular message with no refs.";
    expect(await expandContextRefs(input, { tasksDir, plansDir })).toBe(input);
  });

  test("expands a task marker with full frontmatter + body", async () => {
    const task = await createTask(tasksDir, {
      title: "Add search",
      body: "We should add search.",
      priority: "high",
      tags: ["ui", "search"],
    });

    const input = `Please review <task id="${task.id}" title="Add search" /> and tell me what you think.`;
    const expanded = await expandContextRefs(input, { tasksDir, plansDir });

    expect(expanded).toContain(`<context type="task" id="${task.id}"`);
    expect(expanded).toContain(`status="open"`);
    expect(expanded).toContain(`priority="high"`);
    expect(expanded).toContain(`title="Add search"`);
    expect(expanded).toContain(`id: ${task.id}`);
    expect(expanded).toContain("We should add search.");
    expect(expanded).toContain("</context>");
    expect(expanded).toMatch(/^Please review <context/);
    expect(expanded).toMatch(/and tell me what you think\.$/);
  });

  test("expands a plan marker", async () => {
    const plan = await createPlan(tasksDir, plansDir, {
      title: "Authentication rewrite",
      body: "Switch to OAuth2.",
      tags: ["auth"],
    });

    const input = `<plan id="${plan.id}" title="Authentication rewrite" />`;
    const expanded = await expandContextRefs(input, { tasksDir, plansDir });

    expect(expanded).toContain(`<context type="plan" id="${plan.id}"`);
    expect(expanded).toContain(`title="Authentication rewrite"`);
    expect(expanded).toContain("Switch to OAuth2.");
  });

  test("substitutes deleted markers for missing primitives", async () => {
    const input = 'See <task id="TKTB-999" title="Ghost" /> please.';
    const expanded = await expandContextRefs(input, { tasksDir, plansDir });
    expect(expanded).toContain('<context type="task" id="TKTB-999"');
    expect(expanded).toContain('deleted="true"');
    expect(expanded).toContain('title="Ghost"');
    expect(expanded).toContain("/>");
  });

  test("handles multiple refs in one message", async () => {
    const t1 = await createTask(tasksDir, { title: "First" });
    const t2 = await createTask(tasksDir, { title: "Second" });

    const input = `Compare <task id="${t1.id}" /> with <task id="${t2.id}" />.`;
    const expanded = await expandContextRefs(input, { tasksDir, plansDir });

    expect(expanded).toContain(`id="${t1.id}"`);
    expect(expanded).toContain(`id="${t2.id}"`);
    expect((expanded.match(/<context/g) ?? []).length).toBe(2);
  });

  test("deduplicates fetches for the same primitive referenced twice", async () => {
    const task = await createTask(tasksDir, { title: "Only" });
    const input = `<task id="${task.id}" /> and again <task id="${task.id}" />`;
    const expanded = await expandContextRefs(input, { tasksDir, plansDir });
    expect((expanded.match(/<context/g) ?? []).length).toBe(2);
  });

  test("preserves surrounding prose verbatim", async () => {
    const task = await createTask(tasksDir, { title: "T" });
    const input = `Line 1\n\nLine 2 with <task id="${task.id}" /> ref.\n\nLine 3.`;
    const expanded = await expandContextRefs(input, { tasksDir, plansDir });
    expect(expanded.startsWith("Line 1\n\nLine 2 with <context")).toBe(true);
    expect(expanded.endsWith("</context> ref.\n\nLine 3.")).toBe(true);
  });
});
