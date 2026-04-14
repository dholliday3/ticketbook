import { describe, it, expect } from "bun:test";
import { ClaudeCodeProvider } from "./claude-code.js";
import { buildTicketbookMcpConfig } from "./mcp-config.js";

/**
 * Pure parser tests — exercises the stream-json line parser without spawning
 * the real `claude` CLI. The parser is the one piece that has to keep up with
 * Claude Code's output format, so we want it covered explicitly.
 *
 * The parser mutates the session it's called with, so we synthesize a fake
 * one whose shape matches the second parameter of parseStreamJsonLine. The
 * `InternalSession` type isn't exported, but TS infers it through Parameters.
 */

type ParserSession = Parameters<ClaudeCodeProvider["parseStreamJsonLine"]>[1];

function makeSessionShim(): ParserSession {
  return {
    id: "test",
    cwd: "/tmp",
    systemPrompt: null,
    mcpConfigPath: null,
    conversationId: null,
    process: null,
    hasEmittedText: false,
    status: "idle",
  };
}

describe("ClaudeCodeProvider.parseStreamJsonLine", () => {
  it("ignores non-JSON lines as raw text", () => {
    const p = new ClaudeCodeProvider();
    const session = makeSessionShim();
    const parts = p.parseStreamJsonLine("not actually json", session);
    expect(parts).toEqual([{ type: "text", content: "not actually json" }]);
  });

  it("parses a text_delta into a text part", () => {
    const p = new ClaudeCodeProvider();
    const session = makeSessionShim();
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello" },
    });
    const parts = p.parseStreamJsonLine(line, session);
    expect(parts).toEqual([{ type: "text", content: "Hello" }]);
    expect(session.hasEmittedText).toBe(true);
  });

  it("parses a thinking_delta into a thinking part", () => {
    const p = new ClaudeCodeProvider();
    const session = makeSessionShim();
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "let me think" },
    });
    const parts = p.parseStreamJsonLine(line, session);
    expect(parts).toEqual([{ type: "thinking", content: "let me think" }]);
  });

  it("captures session_id for resume on the first turn", () => {
    const p = new ClaudeCodeProvider();
    const session = makeSessionShim();
    const line = JSON.stringify({ type: "system", session_id: "conv-abc-123" });
    p.parseStreamJsonLine(line, session);
    expect(session.conversationId).toBe("conv-abc-123");
  });

  it("does not overwrite an existing conversationId", () => {
    const p = new ClaudeCodeProvider();
    const session = makeSessionShim();
    session.conversationId = "first";
    const line = JSON.stringify({ type: "system", session_id: "second" });
    p.parseStreamJsonLine(line, session);
    expect(session.conversationId).toBe("first");
  });

  it("emits multiple assistant blocks within one turn (intro + post-tool conclusion)", () => {
    // A single turn can contain several assistant blocks: an intro text, a
    // tool_use, the tool_result, then a post-tool conclusion. All of them
    // must reach the client — only the trailing `result` summary is deduped.
    const p = new ClaudeCodeProvider();
    const session = makeSessionShim();

    const intro = p.parseStreamJsonLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Let me check..." }] },
      }),
      session,
    );
    expect(intro).toEqual([{ type: "text", content: "Let me check..." }]);

    const conclusion = p.parseStreamJsonLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Done — focus on TKTB-018." }] },
      }),
      session,
    );
    expect(conclusion).toEqual([{ type: "text", content: "Done — focus on TKTB-018." }]);

    // Trailing result summary must be deduped — both assistant blocks already shipped.
    const result = p.parseStreamJsonLine(
      JSON.stringify({ type: "result", result: "Done — focus on TKTB-018." }),
      session,
    );
    expect(result).toEqual([]);
  });

  it("emits assistant block when no deltas were streamed", () => {
    const p = new ClaudeCodeProvider();
    const session = makeSessionShim();
    const finalLine = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Final answer." }] },
    });
    const parts = p.parseStreamJsonLine(finalLine, session);
    expect(parts).toEqual([{ type: "text", content: "Final answer." }]);
  });

  it("dedups result text when an assistant block already delivered it (no deltas)", () => {
    // Regression: when Claude Code skips streaming deltas and delivers the
    // final answer as one assistant block followed by a result block, the
    // dedup flag must be set by the assistant block too — otherwise the
    // result block re-emits the same text and the user sees it twice.
    const p = new ClaudeCodeProvider();
    const session = makeSessionShim();

    const assistantParts = p.parseStreamJsonLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "## Answer\nfoo" }],
        },
      }),
      session,
    );
    expect(assistantParts).toEqual([{ type: "text", content: "## Answer\nfoo" }]);
    expect(session.hasEmittedText).toBe(true);

    // Trailing result with the same content — must be dropped.
    const resultParts = p.parseStreamJsonLine(
      JSON.stringify({ type: "result", result: "## Answer\nfoo", session_id: "conv-1" }),
      session,
    );
    expect(resultParts).toEqual([]);
  });

  it("emits result text only when no deltas were streamed", () => {
    const p = new ClaudeCodeProvider();
    const sessionWithDeltas = makeSessionShim();
    sessionWithDeltas.hasEmittedText = true;
    const sessionWithoutDeltas = makeSessionShim();

    const line = JSON.stringify({ type: "result", result: "done", session_id: "conv-xyz" });

    expect(p.parseStreamJsonLine(line, sessionWithDeltas)).toEqual([]);
    expect(p.parseStreamJsonLine(line, sessionWithoutDeltas)).toEqual([
      { type: "text", content: "done" },
    ]);
    // session_id is captured in both cases
    expect(sessionWithDeltas.conversationId).toBe("conv-xyz");
    expect(sessionWithoutDeltas.conversationId).toBe("conv-xyz");
  });

  it("parses tool_use blocks with name and input", () => {
    const p = new ClaudeCodeProvider();
    const session = makeSessionShim();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "create_task",
            input: { title: "Hello", status: "open" },
          },
        ],
      },
    });
    const parts = p.parseStreamJsonLine(line, session);
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("tool_use");
    expect(parts[0].toolName).toBe("create_task");
    expect(parts[0].content).toBe(JSON.stringify({ title: "Hello", status: "open" }));
  });

  it("parses error events into error parts", () => {
    const p = new ClaudeCodeProvider();
    const session = makeSessionShim();
    const line = JSON.stringify({ type: "error", error: { message: "rate limited" } });
    const parts = p.parseStreamJsonLine(line, session);
    expect(parts).toEqual([{ type: "error", content: "rate limited" }]);
  });
});

describe("buildTicketbookMcpConfig", () => {
  it("produces an mcpServers entry pointing at bin/ticketbook.ts --mcp", () => {
    const config = buildTicketbookMcpConfig({
      binPath: "/abs/path/bin/ticketbook.ts",
      ticketbookDir: "/abs/path/.ticketbook",
    });
    expect(config).toEqual({
      mcpServers: {
        ticketbook: {
          command: "bun",
          args: ["run", "/abs/path/bin/ticketbook.ts", "--mcp", "--dir", "/abs/path/.ticketbook"],
        },
      },
    });
  });

  it("respects a custom bun path", () => {
    const config = buildTicketbookMcpConfig({
      binPath: "/abs/bin.ts",
      ticketbookDir: "/abs/.ticketbook",
      bunPath: "/usr/local/bin/bun",
    });
    const server = (config.mcpServers as Record<string, { command: string }>).ticketbook;
    expect(server.command).toBe("/usr/local/bin/bun");
  });

  it("invokes the binary directly when execPath is set (compiled-binary mode)", () => {
    // In a `bun build --compile` binary, binPath is a `$bunfs/…` virtual
    // path that a spawned `bun run` child can't read. The generated config
    // must therefore re-invoke the compiled binary itself in `--mcp` mode.
    const config = buildTicketbookMcpConfig({
      binPath: "/$bunfs/root/bin/ticketbook.ts",
      ticketbookDir: "/abs/path/.ticketbook",
      execPath: "/Users/me/.local/bin/ticketbook",
    });
    expect(config).toEqual({
      mcpServers: {
        ticketbook: {
          command: "/Users/me/.local/bin/ticketbook",
          args: ["--mcp", "--dir", "/abs/path/.ticketbook"],
        },
      },
    });
  });

  it("ignores bunPath when execPath is set", () => {
    // execPath takes precedence — bunPath is only relevant for the
    // `bun run <binPath>` dev-mode branch.
    const config = buildTicketbookMcpConfig({
      binPath: "/ignored",
      ticketbookDir: "/abs/.ticketbook",
      bunPath: "/usr/local/bin/bun",
      execPath: "/opt/ticketbook",
    });
    const server = (config.mcpServers as Record<string, { command: string; args: string[] }>).ticketbook;
    expect(server.command).toBe("/opt/ticketbook");
    expect(server.args).toEqual(["--mcp", "--dir", "/abs/.ticketbook"]);
  });
});
