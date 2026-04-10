import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withLock } from "./lock.js";

describe("withLock", () => {
  let dir: string;
  let target: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-lock-"));
    target = join(dir, "resource");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("runs fn and returns its value", async () => {
    const result = await withLock(target, async () => 42);
    expect(result).toBe(42);
  });

  test("cleans up lock file on success", async () => {
    await withLock(target, async () => "ok");
    await expect(stat(target + ".lock")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("cleans up lock file when fn throws", async () => {
    await expect(
      withLock(target, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(stat(target + ".lock")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("serializes concurrent callers — no interleaving", async () => {
    const log: string[] = [];

    const a = withLock(target, async () => {
      log.push("a-start");
      await new Promise((r) => setTimeout(r, 20));
      log.push("a-end");
    });

    const b = withLock(target, async () => {
      log.push("b-start");
      await new Promise((r) => setTimeout(r, 20));
      log.push("b-end");
    });

    await Promise.all([a, b]);

    // Whichever ran first must have fully completed before the other started
    const aFirst = log[0] === "a-start";
    if (aFirst) {
      expect(log).toEqual(["a-start", "a-end", "b-start", "b-end"]);
    } else {
      expect(log).toEqual(["b-start", "b-end", "a-start", "a-end"]);
    }
  });

  test("second caller succeeds after first releases even if first threw", async () => {
    await expect(
      withLock(target, async () => {
        throw new Error("first fails");
      }),
    ).rejects.toThrow();

    // Lock should be gone — second call must not hang
    const result = await withLock(target, async () => "second ok");
    expect(result).toBe("second ok");
  });
});
