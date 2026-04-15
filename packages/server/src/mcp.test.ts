import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveMcpServerName } from "./mcp.js";

describe("resolveMcpServerName", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "relay-mcp-name-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("returns relay-<name> when config has a name field", async () => {
    await writeFile(
      join(dir, "config.yaml"),
      'name: "projA"\nprefix: TASK\n',
      "utf-8",
    );
    const name = await resolveMcpServerName(dir);
    expect(name).toBe("relay-projA");
  });

  test("returns plain relay when config has no name field", async () => {
    await writeFile(join(dir, "config.yaml"), "prefix: TASK\n", "utf-8");
    const name = await resolveMcpServerName(dir);
    expect(name).toBe("relay");
  });

  test("returns plain relay when config file is missing", async () => {
    // dir exists but has no config.yaml
    const name = await resolveMcpServerName(dir);
    expect(name).toBe("relay");
  });

  test("returns plain relay when config is malformed (does not throw)", async () => {
    // Invalid YAML that getConfig's parser will choke on.
    await writeFile(join(dir, "config.yaml"), "prefix: [unclosed\n", "utf-8");
    const name = await resolveMcpServerName(dir);
    expect(name).toBe("relay");
  });

  test("returns plain relay when name is an empty string", async () => {
    await writeFile(
      join(dir, "config.yaml"),
      'name: ""\nprefix: TASK\n',
      "utf-8",
    );
    const name = await resolveMcpServerName(dir);
    expect(name).toBe("relay");
  });
});
