import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runOnboard,
  onboardSnippet,
  findTargetFile,
  detectStatus,
  ONBOARD_VERSION,
} from "./onboard.js";
import { START_MARKER, END_MARKER } from "./markers.js";

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("runOnboard", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "relay-onboard-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("create", () => {
    test("creates CLAUDE.md at project root when no candidate file exists", async () => {
      const result = await runOnboard({ baseDir: dir });
      expect(result).toEqual({
        action: "created",
        file: join(dir, "CLAUDE.md"),
      });

      const content = await readFile(join(dir, "CLAUDE.md"), "utf-8");
      expect(content).toContain(START_MARKER);
      expect(content).toContain(END_MARKER);
      expect(content).toContain("## Relay");
      expect(content).toContain(`relay-onboard-v:${ONBOARD_VERSION}`);
    });

    test("does not create .claude/CLAUDE.md or AGENTS.md when creating from scratch", async () => {
      await runOnboard({ baseDir: dir });
      expect(await fileExists(join(dir, ".claude", "CLAUDE.md"))).toBe(false);
      expect(await fileExists(join(dir, "AGENTS.md"))).toBe(false);
    });
  });

  describe("candidate file preference", () => {
    test("prefers CLAUDE.md over .claude/CLAUDE.md and AGENTS.md when all three exist", async () => {
      await writeFile(join(dir, "CLAUDE.md"), "# Root CLAUDE\n", "utf-8");
      await mkdir(join(dir, ".claude"), { recursive: true });
      await writeFile(
        join(dir, ".claude", "CLAUDE.md"),
        "# Nested CLAUDE\n",
        "utf-8",
      );
      await writeFile(join(dir, "AGENTS.md"), "# Agents\n", "utf-8");

      const result = await runOnboard({ baseDir: dir });
      expect(result).toMatchObject({
        action: "appended",
        file: join(dir, "CLAUDE.md"),
      });

      // The other two candidates must be untouched byte-for-byte.
      expect(await readFile(join(dir, ".claude", "CLAUDE.md"), "utf-8")).toBe(
        "# Nested CLAUDE\n",
      );
      expect(await readFile(join(dir, "AGENTS.md"), "utf-8")).toBe(
        "# Agents\n",
      );
    });

    test("falls through to .claude/CLAUDE.md when root CLAUDE.md is absent", async () => {
      await mkdir(join(dir, ".claude"), { recursive: true });
      await writeFile(
        join(dir, ".claude", "CLAUDE.md"),
        "# Nested\n",
        "utf-8",
      );
      await writeFile(join(dir, "AGENTS.md"), "# Agents\n", "utf-8");

      const result = await runOnboard({ baseDir: dir });
      expect(result).toMatchObject({
        action: "appended",
        file: join(dir, ".claude", "CLAUDE.md"),
      });

      // Root CLAUDE.md was NOT created, AGENTS.md is unchanged.
      expect(await fileExists(join(dir, "CLAUDE.md"))).toBe(false);
      expect(await readFile(join(dir, "AGENTS.md"), "utf-8")).toBe(
        "# Agents\n",
      );
    });

    test("falls through to AGENTS.md when neither CLAUDE.md variant exists", async () => {
      await writeFile(join(dir, "AGENTS.md"), "# Agents\n", "utf-8");

      const result = await runOnboard({ baseDir: dir });
      expect(result).toMatchObject({
        action: "appended",
        file: join(dir, "AGENTS.md"),
      });

      expect(await fileExists(join(dir, "CLAUDE.md"))).toBe(false);
    });
  });

  describe("append", () => {
    test("appends to existing file without a marker section, preserving prior content", async () => {
      const existing = "# My Project\n\nExisting content that must be preserved.\n";
      await writeFile(join(dir, "CLAUDE.md"), existing, "utf-8");

      const result = await runOnboard({ baseDir: dir });
      expect(result).toMatchObject({
        action: "appended",
        file: join(dir, "CLAUDE.md"),
      });

      const content = await readFile(join(dir, "CLAUDE.md"), "utf-8");
      expect(content.startsWith(existing)).toBe(true);
      expect(content).toContain(START_MARKER);
      expect(content).toContain("## Relay");
    });

    test("inserts a blank line between existing content and the appended section", async () => {
      await writeFile(join(dir, "CLAUDE.md"), "# Only line\n", "utf-8");
      await runOnboard({ baseDir: dir });
      const content = await readFile(join(dir, "CLAUDE.md"), "utf-8");
      // "# Only line\n" + "\n" (separator) + "<start>\n..." = "# Only line\n\n<start>"
      expect(content).toContain(`# Only line\n\n${START_MARKER}`);
    });
  });

  describe("unchanged", () => {
    test("is idempotent — second run reports unchanged and does not rewrite the file", async () => {
      await runOnboard({ baseDir: dir });
      const first = await readFile(join(dir, "CLAUDE.md"), "utf-8");

      const result = await runOnboard({ baseDir: dir });
      expect(result).toMatchObject({
        action: "unchanged",
        file: join(dir, "CLAUDE.md"),
      });

      const second = await readFile(join(dir, "CLAUDE.md"), "utf-8");
      expect(second).toBe(first);
    });
  });

  describe("outdated", () => {
    test("surgically replaces an outdated section, preserving content outside markers byte-for-byte", async () => {
      const before = "# My Project\n\nSome important notes I wrote myself.\n\n";
      const oldWrapped = `${START_MARKER}\n## Relay\n<!-- relay-onboard-v:0 -->\n\nold body\n${END_MARKER}`;
      const after = "\n\n## Some other tool's section\n\nMore stuff the user cares about.\n";
      const initial = `${before}${oldWrapped}${after}`;

      await writeFile(join(dir, "CLAUDE.md"), initial, "utf-8");

      const result = await runOnboard({ baseDir: dir });
      expect(result).toMatchObject({
        action: "updated",
        file: join(dir, "CLAUDE.md"),
      });

      const content = await readFile(join(dir, "CLAUDE.md"), "utf-8");

      // Content outside the markers is preserved byte-for-byte.
      expect(content.startsWith(before)).toBe(true);
      expect(content.endsWith(after)).toBe(true);

      // The outdated marker and body are gone.
      expect(content).not.toContain("relay-onboard-v:0");
      expect(content).not.toContain("old body");

      // The current version marker is present.
      expect(content).toContain(`relay-onboard-v:${ONBOARD_VERSION}`);
    });
  });

  describe("--check mode", () => {
    test("reports missing when no candidate file exists and touches nothing", async () => {
      const result = await runOnboard({ baseDir: dir, check: true });
      expect(result).toEqual({
        action: "checked",
        status: "missing",
        file: null,
      });

      expect(await fileExists(join(dir, "CLAUDE.md"))).toBe(false);
    });

    test("reports missing when a candidate file exists but has no marker section", async () => {
      await writeFile(join(dir, "CLAUDE.md"), "# Just a file\n", "utf-8");

      const result = await runOnboard({ baseDir: dir, check: true });
      expect(result).toEqual({
        action: "checked",
        status: "missing",
        file: join(dir, "CLAUDE.md"),
      });

      // File unchanged.
      expect(await readFile(join(dir, "CLAUDE.md"), "utf-8")).toBe(
        "# Just a file\n",
      );
    });

    test("reports current after a fresh onboard and leaves the file byte-identical", async () => {
      await runOnboard({ baseDir: dir });
      const snapshot = await readFile(join(dir, "CLAUDE.md"), "utf-8");

      const result = await runOnboard({ baseDir: dir, check: true });
      expect(result).toEqual({
        action: "checked",
        status: "current",
        file: join(dir, "CLAUDE.md"),
      });

      expect(await readFile(join(dir, "CLAUDE.md"), "utf-8")).toBe(snapshot);
    });

    test("reports outdated when an older version marker is present and leaves the file unchanged", async () => {
      const initial = `# Project\n\n${START_MARKER}\n## Relay\n<!-- relay-onboard-v:0 -->\nold\n${END_MARKER}\n`;
      await writeFile(join(dir, "CLAUDE.md"), initial, "utf-8");

      const result = await runOnboard({ baseDir: dir, check: true });
      expect(result).toEqual({
        action: "checked",
        status: "outdated",
        file: join(dir, "CLAUDE.md"),
      });

      // --check must not modify the file.
      expect(await readFile(join(dir, "CLAUDE.md"), "utf-8")).toBe(initial);
    });
  });

  describe("--stdout mode", () => {
    test("returns action=stdout and does not create any files", async () => {
      const result = await runOnboard({ baseDir: dir, stdout: true });
      expect(result).toEqual({ action: "stdout" });

      expect(await fileExists(join(dir, "CLAUDE.md"))).toBe(false);
      expect(await fileExists(join(dir, ".claude", "CLAUDE.md"))).toBe(false);
      expect(await fileExists(join(dir, "AGENTS.md"))).toBe(false);
    });

    test("stdout mode does not touch an existing candidate file", async () => {
      await writeFile(join(dir, "CLAUDE.md"), "# Unchanged\n", "utf-8");
      await runOnboard({ baseDir: dir, stdout: true });
      expect(await readFile(join(dir, "CLAUDE.md"), "utf-8")).toBe(
        "# Unchanged\n",
      );
    });
  });

  describe("helpers", () => {
    test("onboardSnippet includes heading, version marker, and key body content", () => {
      const snippet = onboardSnippet();
      expect(snippet).toContain("## Relay");
      expect(snippet).toContain(`relay-onboard-v:${ONBOARD_VERSION}`);
      expect(snippet).toContain(".relay/tasks/");
      expect(snippet).toContain(".relay/plans/");
      expect(snippet).toContain(".relay/docs/");
      expect(snippet).toContain("MCP server");
    });

    test("detectStatus classifies all three cases", () => {
      expect(detectStatus("no markers here")).toBe("missing");
      expect(
        detectStatus(
          `${START_MARKER}\n<!-- relay-onboard-v:${ONBOARD_VERSION} -->\n${END_MARKER}`,
        ),
      ).toBe("current");
      expect(
        detectStatus(
          `${START_MARKER}\n<!-- relay-onboard-v:999 -->\n${END_MARKER}`,
        ),
      ).toBe("outdated");
    });

    test("findTargetFile returns null when no candidate exists in the directory", async () => {
      expect(await findTargetFile(dir)).toBeNull();
    });

    test("findTargetFile returns the path when CLAUDE.md exists", async () => {
      await writeFile(join(dir, "CLAUDE.md"), "", "utf-8");
      expect(await findTargetFile(dir)).toBe(join(dir, "CLAUDE.md"));
    });
  });
});
