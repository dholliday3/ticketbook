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
    receivedDeltas: false,
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
    expect(session.receivedDeltas).toBe(true);
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

  it("drops final assistant block if deltas were already streamed (dedup)", () => {
    const p = new ClaudeCodeProvider();
    const session = makeSessionShim();

    // Stream a delta first to set the flag.
    p.parseStreamJsonLine(
      JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "streamed " },
      }),
      session,
    );

    // Then deliver the final assistant block — should be dropped.
    const finalLine = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "streamed text" }] },
    });
    const parts = p.parseStreamJsonLine(finalLine, session);
    expect(parts).toEqual([]);
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

  it("emits result text only when no deltas were streamed", () => {
    const p = new ClaudeCodeProvider();
    const sessionWithDeltas = makeSessionShim();
    sessionWithDeltas.receivedDeltas = true;
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
            name: "create_ticket",
            input: { title: "Hello", status: "open" },
          },
        ],
      },
    });
    const parts = p.parseStreamJsonLine(line, session);
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("tool_use");
    expect(parts[0].toolName).toBe("create_ticket");
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
      ticketsDir: "/abs/path/.tickets",
    });
    expect(config).toEqual({
      mcpServers: {
        ticketbook: {
          command: "bun",
          args: ["run", "/abs/path/bin/ticketbook.ts", "--mcp", "--dir", "/abs/path/.tickets"],
        },
      },
    });
  });

  it("respects a custom bun path", () => {
    const config = buildTicketbookMcpConfig({
      binPath: "/abs/bin.ts",
      ticketsDir: "/abs/.tickets",
      bunPath: "/usr/local/bin/bun",
    });
    const server = (config.mcpServers as Record<string, { command: string }>).ticketbook;
    expect(server.command).toBe("/usr/local/bin/bun");
  });
});
