import { describe, test, expect } from "bun:test";
import {
  parseLsofListenPid,
  parsePsRow,
  parseEtime,
  isRelayCommand,
  formatElapsed,
  formatPortInUseMessage,
} from "./port-diagnose.js";

describe("parseLsofListenPid", () => {
  test("extracts pid from real macOS lsof output", () => {
    // Captured from a real `lsof -i :4242 -sTCP:LISTEN -n -P` run.
    const output = `COMMAND   PID           USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
bun     40575 danielholliday    5u  IPv6 0x2db4a690ac4945ec      0t0  TCP *:4242 (LISTEN)
`;
    expect(parseLsofListenPid(output)).toBe(40575);
  });

  test("returns null for empty output", () => {
    expect(parseLsofListenPid("")).toBeNull();
  });

  test("returns null when only the header row is present", () => {
    expect(parseLsofListenPid("COMMAND   PID           USER   FD   TYPE\n")).toBeNull();
  });

  test("returns the first pid when multiple rows are present", () => {
    const output = `COMMAND   PID           USER   FD   TYPE
bun     12345 alice          5u  IPv6
node    67890 bob            6u  IPv6
`;
    expect(parseLsofListenPid(output)).toBe(12345);
  });

  test("returns null when the second column is not a number", () => {
    expect(parseLsofListenPid("bun    notapid user\n")).toBeNull();
  });
});

describe("parsePsRow", () => {
  test("parses a realistic macOS ps row (etime + full command)", () => {
    const output = "40575 01-18:29:45 bun bin/relay.ts --port 4242 --no-ui\n";
    const row = parsePsRow(output);
    expect(row).toEqual({
      pid: 40575,
      elapsedSeconds: 152985, // 1d 18h 29m 45s
      command: "bun bin/relay.ts --port 4242 --no-ui",
    });
  });

  test("parses an mm:ss etime (under an hour)", () => {
    const output = "1234    03:45 /usr/local/bin/foo --flag\n";
    const row = parsePsRow(output);
    expect(row?.pid).toBe(1234);
    expect(row?.elapsedSeconds).toBe(3 * 60 + 45);
    expect(row?.command).toBe("/usr/local/bin/foo --flag");
  });

  test("parses an hh:mm:ss etime (under a day)", () => {
    const output = "555 12:34:56 /bin/proc\n";
    const row = parsePsRow(output);
    expect(row?.elapsedSeconds).toBe(12 * 3600 + 34 * 60 + 56);
  });

  test("parses a command containing many spaces", () => {
    const output = "1234 00:42 /usr/local/bin/foo --flag  value  -- --other\n";
    const row = parsePsRow(output);
    expect(row?.command).toBe("/usr/local/bin/foo --flag  value  -- --other");
  });

  test("returns a row with null elapsedSeconds if etime is unparseable", () => {
    const output = "40575 not-an-etime some command\n";
    const row = parsePsRow(output);
    expect(row?.pid).toBe(40575);
    expect(row?.elapsedSeconds).toBeNull();
    expect(row?.command).toBe("some command");
  });

  test("returns null for empty input", () => {
    expect(parsePsRow("")).toBeNull();
    expect(parsePsRow("\n")).toBeNull();
  });

  test("returns null when pid is not numeric", () => {
    expect(parsePsRow("abc 00:42 foo bar\n")).toBeNull();
  });

  test("returns null when the command is missing", () => {
    expect(parsePsRow("40575 00:42\n")).toBeNull();
  });
});

describe("parseEtime", () => {
  test("parses mm:ss", () => {
    expect(parseEtime("01:23")).toBe(83);
    expect(parseEtime("00:05")).toBe(5);
  });

  test("parses hh:mm:ss", () => {
    expect(parseEtime("12:34:56")).toBe(12 * 3600 + 34 * 60 + 56);
  });

  test("parses DD-hh:mm:ss", () => {
    expect(parseEtime("01-18:29:45")).toBe(
      86400 + 18 * 3600 + 29 * 60 + 45,
    );
  });

  test("handles leading/trailing whitespace", () => {
    expect(parseEtime("   03:45  ")).toBe(3 * 60 + 45);
  });

  test("returns null for unparseable input", () => {
    expect(parseEtime("")).toBeNull();
    expect(parseEtime("garbage")).toBeNull();
    expect(parseEtime("1:2:3:4:5")).toBeNull();
  });
});

describe("isRelayCommand", () => {
  test("recognizes bun bin/relay.ts", () => {
    expect(isRelayCommand("bun bin/relay.ts --port 4242 --no-ui")).toBe(true);
  });

  test("recognizes bunx relay", () => {
    expect(isRelayCommand("bunx relay --port 4243")).toBe(true);
  });

  test("recognizes plain relay on PATH", () => {
    expect(isRelayCommand("/usr/local/bin/relay --no-ui")).toBe(true);
  });

  test("excludes --mcp mode (doesn't bind a port)", () => {
    expect(isRelayCommand("bun bin/relay.ts --mcp")).toBe(false);
  });

  test("excludes the init subcommand", () => {
    expect(isRelayCommand("bunx relay init")).toBe(false);
  });

  test("rejects unrelated commands that happen to contain other keywords", () => {
    expect(isRelayCommand("/usr/bin/node server.js")).toBe(false);
    expect(isRelayCommand("postgres -D /var/lib/postgres")).toBe(false);
  });
});

describe("formatElapsed", () => {
  test("formats seconds under a minute", () => {
    expect(formatElapsed(45)).toBe("45s");
    expect(formatElapsed(0)).toBe("0s");
  });

  test("formats minutes", () => {
    expect(formatElapsed(60)).toBe("1m0s");
    expect(formatElapsed(125)).toBe("2m5s");
  });

  test("formats hours", () => {
    expect(formatElapsed(3600)).toBe("1h0m");
    expect(formatElapsed(3600 + 1500)).toBe("1h25m");
  });

  test("formats days", () => {
    expect(formatElapsed(86400)).toBe("1d0h");
    expect(formatElapsed(86400 + 3600 * 18)).toBe("1d18h");
    expect(formatElapsed(152601)).toBe("1d18h");
  });

  test("handles bogus input", () => {
    expect(formatElapsed(-1)).toBe("unknown");
    expect(formatElapsed(Number.NaN)).toBe("unknown");
  });
});

describe("formatPortInUseMessage", () => {
  test("produces a relay-specific message when the squatter is a relay process", () => {
    const msg = formatPortInUseMessage(4242, {
      pid: 40575,
      command: "bun bin/relay.ts --port 4242 --no-ui",
      elapsedSeconds: 152601,
      isRelay: true,
    });
    expect(msg).toContain("Port 4242 is already in use by another relay instance");
    expect(msg).toContain("PID 40575");
    expect(msg).toContain("running 1d18h");
    expect(msg).toContain("kill 40575");
  });

  test("produces a generic message when the squatter is not a relay process", () => {
    const msg = formatPortInUseMessage(4242, {
      pid: 1234,
      command: "/usr/bin/node server.js",
      elapsedSeconds: 3700,
      isRelay: false,
    });
    expect(msg).toContain("Port 4242 is already in use:");
    expect(msg).toContain("PID 1234");
    expect(msg).toContain("/usr/bin/node server.js");
    expect(msg).toContain("running 1h1m");
    expect(msg).not.toContain("relay instance");
    expect(msg).toContain("pick another port");
  });

  test("produces a minimal message when no squatter info is available", () => {
    const msg = formatPortInUseMessage(4242, null);
    expect(msg).toContain("Port 4242 is already in use.");
    expect(msg).toContain("Pick another port");
    expect(msg).not.toContain("PID");
  });

  test("omits elapsed time when unknown", () => {
    const msg = formatPortInUseMessage(4242, {
      pid: 999,
      command: "some-proc",
      elapsedSeconds: null,
      isRelay: false,
    });
    expect(msg).toContain("PID 999  some-proc");
    expect(msg).not.toContain("running");
  });
});
