import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getConfig, updateConfig } from "./config.js";

describe("getConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "relay-cfg-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("returns defaults when config file is missing", async () => {
    const config = await getConfig(dir);
    expect(config.prefix).toBe("TASK");
    expect(config.deleteMode).toBe("archive");
    expect(config.worktreeMode).toBe("local");
  });

  test("reads config from config.yaml", async () => {
    await writeFile(
      join(dir, "config.yaml"),
      "prefix: ART\ndeleteMode: hard\nworktreeMode: shared\n",
      "utf-8",
    );
    const config = await getConfig(dir);
    expect(config.prefix).toBe("ART");
    expect(config.deleteMode).toBe("hard");
    expect(config.worktreeMode).toBe("shared");
  });

  test("fills in defaults for partial config", async () => {
    await writeFile(join(dir, "config.yaml"), "prefix: BUG\n", "utf-8");
    const config = await getConfig(dir);
    expect(config.prefix).toBe("BUG");
    expect(config.deleteMode).toBe("archive");
    expect(config.worktreeMode).toBe("local");
  });

  test("reads optional name field when present", async () => {
    await writeFile(
      join(dir, "config.yaml"),
      'name: "projA"\nprefix: TASK\n',
      "utf-8",
    );
    const config = await getConfig(dir);
    expect(config.name).toBe("projA");
  });

  test("name is undefined (not empty string) when absent", async () => {
    await writeFile(join(dir, "config.yaml"), "prefix: TASK\n", "utf-8");
    const config = await getConfig(dir);
    expect(config.name).toBeUndefined();
  });
});

describe("updateConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "relay-cfg-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("creates config file if missing", async () => {
    const config = await updateConfig(dir, { prefix: "NEW" });
    expect(config.prefix).toBe("NEW");
    expect(config.deleteMode).toBe("archive");
    expect(config.worktreeMode).toBe("local");

    const raw = await readFile(join(dir, "config.yaml"), "utf-8");
    expect(raw).toContain("prefix: NEW");
  });

  test("merges with existing config", async () => {
    await writeFile(
      join(dir, "config.yaml"),
      "prefix: OLD\ndeleteMode: archive\n",
      "utf-8",
    );
    const config = await updateConfig(dir, { deleteMode: "hard" });
    expect(config.prefix).toBe("OLD");
    expect(config.deleteMode).toBe("hard");
  });

  test("updates worktreeMode", async () => {
    const config = await updateConfig(dir, { worktreeMode: "shared" });
    expect(config.worktreeMode).toBe("shared");

    const raw = await readFile(join(dir, "config.yaml"), "utf-8");
    expect(raw).toContain("worktreeMode: shared");
  });
});
