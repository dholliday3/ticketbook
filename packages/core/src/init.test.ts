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
import { initRelay, codexMcpInstructions } from "./init.js";

const FIXTURE_SKILL = `---
name: relay
description: Test fixture skill for initRelay tests.
---

# Relay test fixture
`;

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("initRelay", () => {
  let dir: string;
  let skillSourcePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "relay-init-"));
    // Create a fixture skill file in a sibling temp location to simulate
    // the bundled SKILL.md in the relay package.
    const skillDir = await mkdtemp(join(tmpdir(), "relay-skill-src-"));
    skillSourcePath = join(skillDir, "SKILL.md");
    await writeFile(skillSourcePath, FIXTURE_SKILL, "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("creates .relay/ with tasks/, plans/, docs/ subdirs, config, and counters", async () => {
    const result = await initRelay({ baseDir: dir, skillSourcePath });

    expect(result.createdRelayDir).toBe(true);
    expect(result.wroteConfig).toBe(true);

    expect(await fileExists(join(dir, ".relay", "tasks", ".archive"))).toBe(true);
    expect(await fileExists(join(dir, ".relay", "plans", ".archive"))).toBe(true);
    expect(await fileExists(join(dir, ".relay", "docs", ".archive"))).toBe(true);

    const config = await readFile(
      join(dir, ".relay", "config.yaml"),
      "utf-8",
    );
    expect(config).toContain("prefix: TASK");
    expect(config).toContain("planPrefix: PLAN");
    expect(config).toContain("docPrefix: DOC");
    expect(config).toContain("worktreeMode: local");
    // name is auto-populated from basename(baseDir) so each repo gets a
    // distinguishable MCP identity.
    expect(config).toContain(`name: "${basename(dir)}"`);

    const ticketsCounter = await readFile(
      join(dir, ".relay", "tasks", ".counter"),
      "utf-8",
    );
    expect(ticketsCounter).toBe("0");

    const plansCounter = await readFile(
      join(dir, ".relay", "plans", ".counter"),
      "utf-8",
    );
    expect(plansCounter).toBe("0");

    const docsCounter = await readFile(
      join(dir, ".relay", "docs", ".counter"),
      "utf-8",
    );
    expect(docsCounter).toBe("0");
  });

  test("copies SKILL.md into both Claude and Codex discovery paths", async () => {
    const result = await initRelay({ baseDir: dir, skillSourcePath });

    expect(result.wroteSkill).toBe(true);

    const claudeSkill = await readFile(
      join(dir, ".claude", "skills", "relay", "SKILL.md"),
      "utf-8",
    );
    const codexSkill = await readFile(
      join(dir, ".agents", "skills", "relay", "SKILL.md"),
      "utf-8",
    );

    expect(claudeSkill).toBe(FIXTURE_SKILL);
    expect(codexSkill).toBe(FIXTURE_SKILL);
  });

  test("skips skill copy when skillSourcePath is missing", async () => {
    const result = await initRelay({
      baseDir: dir,
      skillSourcePath: join(tmpdir(), "nonexistent-skill-file.md"),
    });

    expect(result.wroteSkill).toBe(false);
    expect(
      await fileExists(join(dir, ".claude", "skills", "relay", "SKILL.md")),
    ).toBe(false);
  });

  test("writes a fresh .mcp.json with the published-mode relay entry", async () => {
    const result = await initRelay({ baseDir: dir, skillSourcePath });

    expect(result.wroteMcpConfig).toBe(true);
    expect(result.mergedMcpConfig).toBe(false);
    expect(result.devMode).toBe(false);

    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.relay).toEqual({
      command: "relay",
      args: ["--mcp"],
    });
  });

  test("writes a dev-mode .mcp.json when baseDir is the relay source repo", async () => {
    // Plant the signals that detectRelaySourceRepo looks for:
    // a package.json with name "relay" AND a bin/relay.ts file.
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "relay", version: "0.1.0" }),
      "utf-8",
    );
    await mkdir(join(dir, "bin"), { recursive: true });
    await writeFile(join(dir, "bin", "relay.ts"), "// stub\n", "utf-8");

    const result = await initRelay({ baseDir: dir, skillSourcePath });

    expect(result.devMode).toBe(true);
    expect(result.wroteMcpConfig).toBe(true);

    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.relay).toEqual({
      command: "bun",
      args: ["bin/relay.ts", "--mcp"],
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
    await writeFile(join(dir, "bin", "relay.ts"), "// stub\n", "utf-8");

    const result = await initRelay({ baseDir: dir, skillSourcePath });

    expect(result.devMode).toBe(false);
    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.relay.command).toBe("relay");
  });

  test("does not trigger dev mode when bin/relay.ts is missing", async () => {
    // package.json has the right name but no bin/relay.ts — a user might
    // legitimately have a package called "relay" in an unrelated project.
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "relay" }),
      "utf-8",
    );

    const result = await initRelay({ baseDir: dir, skillSourcePath });

    expect(result.devMode).toBe(false);
    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.relay.command).toBe("relay");
  });

  test("merges relay into an existing .mcp.json without clobbering other entries", async () => {
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

    const result = await initRelay({ baseDir: dir, skillSourcePath });

    expect(result.wroteMcpConfig).toBe(false);
    expect(result.mergedMcpConfig).toBe(true);

    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.other).toEqual({
      command: "other-cmd",
      args: ["--foo"],
    });
    expect(mcp.mcpServers.relay).toEqual({
      command: "relay",
      args: ["--mcp"],
    });
  });

  test("leaves an existing relay entry in .mcp.json untouched", async () => {
    const existingConfig = {
      mcpServers: {
        relay: { command: "custom-bun", args: ["--custom"] },
      },
    };
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify(existingConfig, null, 2),
      "utf-8",
    );

    const result = await initRelay({ baseDir: dir, skillSourcePath });

    expect(result.mergedMcpConfig).toBe(false);

    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.relay).toEqual({
      command: "custom-bun",
      args: ["--custom"],
    });
  });

  test("does not write AGENTS.md (onboard owns agent instructions)", async () => {
    // Regression test for the TKTB-073 init/onboard split: init scaffolds data
    // and MCP config only; writing agent instructions into CLAUDE.md or
    // AGENTS.md is the job of `relay onboard`. If init ever starts
    // touching AGENTS.md again, that's a scope violation and this test
    // catches it.
    await initRelay({ baseDir: dir, skillSourcePath });
    expect(await fileExists(join(dir, "AGENTS.md"))).toBe(false);
  });

  test("adds archive patterns to .gitignore, creating it if needed", async () => {
    const result = await initRelay({ baseDir: dir, skillSourcePath });
    expect(result.updatedGitignore).toBe(true);

    const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".relay/tasks/.archive/");
    expect(gitignore).toContain(".relay/plans/.archive/");
    expect(gitignore).toContain(".relay/docs/.archive/");
  });

  test("preserves existing .gitignore entries and only appends missing patterns", async () => {
    await writeFile(
      join(dir, ".gitignore"),
      "node_modules\n.env\n",
      "utf-8",
    );

    await initRelay({ baseDir: dir, skillSourcePath });

    const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("node_modules");
    expect(gitignore).toContain(".env");
    expect(gitignore).toContain(".relay/tasks/.archive/");
    expect(gitignore).toContain(".relay/plans/.archive/");
    expect(gitignore).toContain(".relay/docs/.archive/");
  });

  test("leaves an existing config.yaml without a name field alone on re-init", async () => {
    // Simulate a pre-0.x project whose config was written before the `name`
    // field existed. Re-running init should not overwrite or augment it.
    const preexisting = "prefix: TASK\nplanPrefix: PLAN\ndocPrefix: DOC\ndeleteMode: archive\n";
    await mkdir(join(dir, ".relay"), { recursive: true });
    await writeFile(join(dir, ".relay", "config.yaml"), preexisting, "utf-8");

    const result = await initRelay({ baseDir: dir, skillSourcePath });
    expect(result.wroteConfig).toBe(false);

    const after = await readFile(join(dir, ".relay", "config.yaml"), "utf-8");
    expect(after).toBe(preexisting);
    expect(after).not.toContain("name:");
  });

  test("is idempotent — running twice does not overwrite anything", async () => {
    await initRelay({ baseDir: dir, skillSourcePath });

    // Modify a file to prove init doesn't clobber it.
    const claudeSkillPath = join(
      dir,
      ".claude",
      "skills",
      "relay",
      "SKILL.md",
    );
    await writeFile(claudeSkillPath, "# modified by user\n", "utf-8");

    const second = await initRelay({ baseDir: dir, skillSourcePath });

    expect(second.wroteConfig).toBe(false);
    expect(second.wroteSkill).toBe(false);
    expect(second.wroteMcpConfig).toBe(false);

    const afterSkill = await readFile(claudeSkillPath, "utf-8");
    expect(afterSkill).toBe("# modified by user\n");
  });

  test("handles malformed .mcp.json gracefully (does not clobber)", async () => {
    await writeFile(join(dir, ".mcp.json"), "{ this is not json", "utf-8");

    const result = await initRelay({ baseDir: dir, skillSourcePath });
    expect(result.wroteMcpConfig).toBe(false);
    expect(result.mergedMcpConfig).toBe(false);

    const after = await readFile(join(dir, ".mcp.json"), "utf-8");
    expect(after).toBe("{ this is not json");
  });

  test("codexMcpInstructions returns a valid TOML snippet", () => {
    const toml = codexMcpInstructions();
    expect(toml).toContain("[mcp_servers.relay]");
    expect(toml).toContain('command = "relay"');
    expect(toml).toContain('args = ["--mcp"]');
  });
});
