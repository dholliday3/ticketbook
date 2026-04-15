import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atomicWriteFile } from "./atomic.js";

describe("atomicWriteFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "relay-atomic-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("writes the correct content", async () => {
    const file = join(dir, "out.md");
    await atomicWriteFile(file, "hello world");
    expect(await readFile(file, "utf-8")).toBe("hello world");
  });

  test("leaves no temp file behind on success", async () => {
    const file = join(dir, "out.md");
    await atomicWriteFile(file, "content");
    const entries = await readdir(dir);
    const temps = entries.filter((e) => e.includes(".tmp-"));
    expect(temps).toHaveLength(0);
  });

  test("overwrites an existing file", async () => {
    const file = join(dir, "out.md");
    await writeFile(file, "original", "utf-8");
    await atomicWriteFile(file, "updated");
    expect(await readFile(file, "utf-8")).toBe("updated");
  });

  test("no temp file after overwrite", async () => {
    const file = join(dir, "out.md");
    await writeFile(file, "original", "utf-8");
    await atomicWriteFile(file, "updated");
    const entries = await readdir(dir);
    const temps = entries.filter((e) => e.includes(".tmp-"));
    expect(temps).toHaveLength(0);
  });
});
