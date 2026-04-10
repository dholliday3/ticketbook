import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { slugify, formatId, formatFilename, nextId } from "./id.js";

describe("slugify", () => {
  test("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Add Task Search")).toBe("add-task-search");
  });

  test("removes non-alphanumeric characters", () => {
    expect(slugify("Fix bug #42: crash on save!")).toBe("fix-bug-42-crash-on-save");
  });

  test("trims leading and trailing hyphens", () => {
    expect(slugify("---hello---")).toBe("hello");
  });

  test("truncates at 50 chars on word boundary", () => {
    const long = "this is a very long title that should be truncated at word boundaries to stay under fifty chars";
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).not.toEndWith("-");
  });

  test("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});

describe("formatId", () => {
  test("zero-pads to 3 digits", () => {
    expect(formatId("TKT", 1)).toBe("TKT-001");
    expect(formatId("TKT", 42)).toBe("TKT-042");
    expect(formatId("TKT", 100)).toBe("TKT-100");
  });

  test("grows past 999 naturally", () => {
    expect(formatId("TKT", 1000)).toBe("TKT-1000");
    expect(formatId("TKT", 12345)).toBe("TKT-12345");
  });

  test("respects custom prefix", () => {
    expect(formatId("ART", 7)).toBe("ART-007");
  });
});

describe("formatFilename", () => {
  test("produces correct filename", () => {
    expect(formatFilename("TKT-042", "Add Task Search")).toBe(
      "TKT-042-add-task-search.md",
    );
  });

  test("handles empty title", () => {
    expect(formatFilename("TKT-001", "")).toBe("TKT-001.md");
  });
});

describe("nextId", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("starts at 1 when no counter file exists", async () => {
    const result = await nextId(dir);
    expect(result.id).toBe("TASK-001");
    expect(result.number).toBe(1);
  });

  test("increments counter", async () => {
    await writeFile(join(dir, ".counter"), "5", "utf-8");
    const result = await nextId(dir);
    expect(result.id).toBe("TASK-006");
    expect(result.number).toBe(6);

    // Verify counter was written
    const counter = await readFile(join(dir, ".counter"), "utf-8");
    expect(counter).toBe("6");
  });

  test("uses prefix from config", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".config.yaml"), "prefix: ART\ndeleteMode: archive\n", "utf-8");
    const result = await nextId(dir);
    expect(result.id).toBe("ART-001");
  });

  test("filename function produces correct output", async () => {
    const result = await nextId(dir);
    expect(result.filename("My Cool Feature")).toBe("TASK-001-my-cool-feature.md");
  });

  test("concurrent calls produce unique IDs", async () => {
    // Fire N nextId calls at the same time — the lock must serialize them
    // so every call sees a distinct counter value.
    const N = 10;
    const results = await Promise.all(
      Array.from({ length: N }, () => nextId(dir)),
    );
    const ids = results.map((r) => r.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(N);
  });
});
