import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  stat,
} from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { initTicketbook, codexMcpInstructions } from "./init.js";

const FIXTURE_SKILL = `---
name: ticketbook
description: Test fixture skill for initTicketbook tests.
---

# Ticketbook test fixture
`;

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("initTicketbook", () => {
  let dir: string;
  let skillSourcePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-init-"));
    // Create a fixture skill file in a sibling temp location to simulate
    // the bundled SKILL.md in the ticketbook package.
    const skillDir = await mkdtemp(join(tmpdir(), "ticketbook-skill-src-"));
    skillSourcePath = join(skillDir, "SKILL.md");
    await writeFile(skillSourcePath, FIXTURE_SKILL, "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("creates .tasks/, .plans/, and .docs/ with config and counters", async () => {
    const result = await initTicketbook({ baseDir: dir, skillSourcePath });

    expect(result.createdTasksDir).toBe(true);
    expect(result.createdPlansDir).toBe(true);
    expect(result.createdDocsDir).toBe(true);
    expect(result.wroteConfig).toBe(true);

    expect(await fileExists(join(dir, ".tasks", ".archive"))).toBe(true);
    expect(await fileExists(join(dir, ".plans", ".archive"))).toBe(true);
    expect(await fileExists(join(dir, ".docs", ".archive"))).toBe(true);

    const config = await readFile(
      join(dir, ".tasks", ".config.yaml"),
      "utf-8",
    );
    expect(config).toContain("prefix: TASK");
    expect(config).toContain("planPrefix: PLAN");
    expect(config).toContain("docPrefix: DOC");
    // name is auto-populated from basename(baseDir) so each repo gets a
    // distinguishable MCP identity.
    expect(config).toContain(`name: "${basename(dir)}"`);

    const ticketsCounter = await readFile(
      join(dir, ".tasks", ".counter"),
      "utf-8",
    );
    expect(ticketsCounter).toBe("0");

    const plansCounter = await readFile(
      join(dir, ".plans", ".counter"),
      "utf-8",
    );
    expect(plansCounter).toBe("0");

    const docsCounter = await readFile(
      join(dir, ".docs", ".counter"),
      "utf-8",
    );
    expect(docsCounter).toBe("0");
  });

  test("copies SKILL.md into both Claude and Codex discovery paths", async () => {
    const result = await initTicketbook({ baseDir: dir, skillSourcePath });

    expect(result.wroteSkill).toBe(true);

    const claudeSkill = await readFile(
      join(dir, ".claude", "skills", "ticketbook", "SKILL.md"),
      "utf-8",
    );
    const codexSkill = await readFile(
      join(dir, ".agents", "skills", "ticketbook", "SKILL.md"),
      "utf-8",
    );

    expect(claudeSkill).toBe(FIXTURE_SKILL);
    expect(codexSkill).toBe(FIXTURE_SKILL);
  });

  test("skips skill copy when skillSourcePath is missing", async () => {
    const result = await initTicketbook({
      baseDir: dir,
      skillSourcePath: join(tmpdir(), "nonexistent-skill-file.md"),
    });

    expect(result.wroteSkill).toBe(false);
    expect(
      await fileExists(join(dir, ".claude", "skills", "ticketbook", "SKILL.md")),
    ).toBe(false);
  });

  test("writes a fresh .mcp.json with the published-mode ticketbook entry", async () => {
    const result = await initTicketbook({ baseDir: dir, skillSourcePath });

    expect(result.wroteMcpConfig).toBe(true);
    expect(result.mergedMcpConfig).toBe(false);
    expect(result.devMode).toBe(false);

    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.ticketbook).toEqual({
      command: "bunx",
      args: ["ticketbook", "--mcp"],
    });
  });

  test("writes a dev-mode .mcp.json when baseDir is the ticketbook source repo", async () => {
    // Plant the signals that detectTicketbookSourceRepo looks for:
    // a package.json with name "ticketbook" AND a bin/ticketbook.ts file.
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "ticketbook", version: "0.1.0" }),
      "utf-8",
    );
    await mkdir(join(dir, "bin"), { recursive: true });
    await writeFile(join(dir, "bin", "ticketbook.ts"), "// stub\n", "utf-8");

    const result = await initTicketbook({ baseDir: dir, skillSourcePath });

    expect(result.devMode).toBe(true);
    expect(result.wroteMcpConfig).toBe(true);

    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.ticketbook).toEqual({
      command: "bun",
      args: ["bin/ticketbook.ts", "--mcp"],
    });
  });

  test("does not trigger dev mode when package.json name differs", async () => {
    // The package.json exists but has the wrong name — should stay in published mode.
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "some-other-project" }),
      "utf-8",
    );
    await mkdir(join(dir, "bin"), { recursive: true });
    await writeFile(join(dir, "bin", "ticketbook.ts"), "// stub\n", "utf-8");

    const result = await initTicketbook({ baseDir: dir, skillSourcePath });

    expect(result.devMode).toBe(false);
    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.ticketbook.command).toBe("bunx");
  });

  test("does not trigger dev mode when bin/ticketbook.ts is missing", async () => {
    // package.json has the right name but no bin/ticketbook.ts — a user might
    // legitimately have a package called "ticketbook" in an unrelated project.
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "ticketbook" }),
      "utf-8",
    );

    const result = await initTicketbook({ baseDir: dir, skillSourcePath });

    expect(result.devMode).toBe(false);
    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.ticketbook.command).toBe("bunx");
  });

  test("merges ticketbook into an existing .mcp.json without clobbering other entries", async () => {
    const existingConfig = {
      mcpServers: {
        other: { command: "other-cmd", args: ["--foo"] },
      },
    };
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify(existingConfig, null, 2),
      "utf-8",
    );

    const result = await initTicketbook({ baseDir: dir, skillSourcePath });

    expect(result.wroteMcpConfig).toBe(false);
    expect(result.mergedMcpConfig).toBe(true);

    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.other).toEqual({
      command: "other-cmd",
      args: ["--foo"],
    });
    expect(mcp.mcpServers.ticketbook).toEqual({
      command: "bunx",
      args: ["ticketbook", "--mcp"],
    });
  });

  test("leaves an existing ticketbook entry in .mcp.json untouched", async () => {
    const existingConfig = {
      mcpServers: {
        ticketbook: { command: "custom-bun", args: ["--custom"] },
      },
    };
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify(existingConfig, null, 2),
      "utf-8",
    );

    const result = await initTicketbook({ baseDir: dir, skillSourcePath });

    expect(result.mergedMcpConfig).toBe(false);

    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.ticketbook).toEqual({
      command: "custom-bun",
      args: ["--custom"],
    });
  });

  test("writes AGENTS.md when absent and leaves it alone when present", async () => {
    const first = await initTicketbook({ baseDir: dir, skillSourcePath });
    expect(first.wroteAgentsMd).toBe(true);

    const agentsMd = await readFile(join(dir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("ticketbook");
    expect(agentsMd).toContain(".tasks/");
    expect(agentsMd).toContain(".docs/");

    // Simulate user editing the file.
    await writeFile(join(dir, "AGENTS.md"), "# Custom\n", "utf-8");

    const second = await initTicketbook({ baseDir: dir, skillSourcePath });
    expect(second.wroteAgentsMd).toBe(false);

    const after = await readFile(join(dir, "AGENTS.md"), "utf-8");
    expect(after).toBe("# Custom\n");
  });

  test("adds archive patterns to .gitignore, creating it if needed", async () => {
    const result = await initTicketbook({ baseDir: dir, skillSourcePath });
    expect(result.updatedGitignore).toBe(true);

    const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".tasks/.archive/");
    expect(gitignore).toContain(".plans/.archive/");
    expect(gitignore).toContain(".docs/.archive/");
  });

  test("preserves existing .gitignore entries and only appends missing patterns", async () => {
    await writeFile(
      join(dir, ".gitignore"),
      "node_modules\n.env\n",
      "utf-8",
    );

    await initTicketbook({ baseDir: dir, skillSourcePath });

    const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("node_modules");
    expect(gitignore).toContain(".env");
    expect(gitignore).toContain(".tasks/.archive/");
    expect(gitignore).toContain(".plans/.archive/");
    expect(gitignore).toContain(".docs/.archive/");
  });

  test("leaves an existing .config.yaml without a name field alone on re-init", async () => {
    // Simulate a pre-0.x project whose config was written before the `name`
    // field existed. Re-running init should not overwrite or augment it.
    const preexisting = "prefix: TASK\nplanPrefix: PLAN\ndocPrefix: DOC\ndeleteMode: archive\n";
    await mkdir(join(dir, ".tasks"), { recursive: true });
    await writeFile(join(dir, ".tasks", ".config.yaml"), preexisting, "utf-8");

    const result = await initTicketbook({ baseDir: dir, skillSourcePath });
    expect(result.wroteConfig).toBe(false);

    const after = await readFile(join(dir, ".tasks", ".config.yaml"), "utf-8");
    expect(after).toBe(preexisting);
    expect(after).not.toContain("name:");
  });

  test("is idempotent — running twice does not overwrite anything", async () => {
    await initTicketbook({ baseDir: dir, skillSourcePath });

    // Modify a file to prove init doesn't clobber it.
    const claudeSkillPath = join(
      dir,
      ".claude",
      "skills",
      "ticketbook",
      "SKILL.md",
    );
    await writeFile(claudeSkillPath, "# modified by user\n", "utf-8");

    const second = await initTicketbook({ baseDir: dir, skillSourcePath });

    expect(second.wroteConfig).toBe(false);
    expect(second.wroteSkill).toBe(false);
    expect(second.wroteMcpConfig).toBe(false);
    expect(second.wroteAgentsMd).toBe(false);

    const afterSkill = await readFile(claudeSkillPath, "utf-8");
    expect(afterSkill).toBe("# modified by user\n");
  });

  test("handles malformed .mcp.json gracefully (does not clobber)", async () => {
    await writeFile(join(dir, ".mcp.json"), "{ this is not json", "utf-8");

    const result = await initTicketbook({ baseDir: dir, skillSourcePath });
    expect(result.wroteMcpConfig).toBe(false);
    expect(result.mergedMcpConfig).toBe(false);

    const after = await readFile(join(dir, ".mcp.json"), "utf-8");
    expect(after).toBe("{ this is not json");
  });

  test("codexMcpInstructions returns a valid TOML snippet", () => {
    const toml = codexMcpInstructions();
    expect(toml).toContain("[mcp_servers.ticketbook]");
    expect(toml).toContain('command = "bunx"');
    expect(toml).toContain('args = ["ticketbook", "--mcp"]');
  });
});
