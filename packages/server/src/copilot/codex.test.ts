import { describe, expect, it } from "bun:test";
import { CodexProvider } from "./codex.js";

type ParserSession = Parameters<CodexProvider["parseJsonLine"]>[1];

function makeSessionShim(): ParserSession {
  return {
    id: "test",
    cwd: "/tmp",
    systemPrompt: null,
    conversationId: null,
    process: null,
    mcpConfig: null,
    status: "idle",
  };
}

describe("CodexProvider.parseJsonLine", () => {
  it("captures the thread id for resume", () => {
    const provider = new CodexProvider();
    const session = makeSessionShim();
    const parts = provider.parseJsonLine(
      JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
      session,
    );
    expect(parts).toEqual([]);
    expect(session.conversationId).toBe("thread-123");
  });

  it("parses agent_message items into text parts", () => {
    const provider = new CodexProvider();
    const session = makeSessionShim();
    const parts = provider.parseJsonLine(
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_1", type: "agent_message", text: "Hello from Codex" },
      }),
      session,
    );
    expect(parts).toEqual([{ type: "text", content: "Hello from Codex" }]);
  });

  it("parses command_execution start and completion into tool parts", () => {
    const provider = new CodexProvider();
    const session = makeSessionShim();
    const started = provider.parseJsonLine(
      JSON.stringify({
        type: "item.started",
        item: {
          id: "item_2",
          type: "command_execution",
          command: "/bin/zsh -lc pwd",
          aggregated_output: "",
          exit_code: null,
          status: "in_progress",
        },
      }),
      session,
    );
    expect(started).toEqual([
      {
        type: "tool_use",
        toolName: "command_execution",
        toolInput: "/bin/zsh -lc pwd",
        content: "/bin/zsh -lc pwd",
      },
    ]);

    const completed = provider.parseJsonLine(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_2",
          type: "command_execution",
          command: "/bin/zsh -lc pwd",
          aggregated_output: "/tmp\n",
          exit_code: 0,
          status: "completed",
        },
      }),
      session,
    );
    expect(completed).toEqual([
      {
        type: "tool_result",
        toolName: "command_execution",
        content: "/tmp\n(exit 0)",
      },
    ]);
  });

  it("parses mcp_tool_call items into tool use and tool result parts", () => {
    const provider = new CodexProvider();
    const session = makeSessionShim();

    const started = provider.parseJsonLine(
      JSON.stringify({
        type: "item.started",
        item: {
          id: "item_3",
          type: "mcp_tool_call",
          server: "relay",
          tool: "list_tasks",
          arguments: { status: "open" },
          result: null,
          error: null,
          status: "in_progress",
        },
      }),
      session,
    );
    expect(started).toEqual([
      {
        type: "tool_use",
        toolName: "relay.list_tasks",
        toolInput: '{\n  "status": "open"\n}',
        content: '{\n  "status": "open"\n}',
      },
    ]);

    const completed = provider.parseJsonLine(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_3",
          type: "mcp_tool_call",
          server: "relay",
          tool: "list_tasks",
          arguments: { status: "open" },
          result: {
            content: [{ type: "text", text: "TKTB-040" }],
            structured_content: null,
          },
          error: null,
          status: "completed",
        },
      }),
      session,
    );
    expect(completed).toEqual([
      {
        type: "tool_result",
        toolName: "relay.list_tasks",
        content: "TKTB-040",
      },
    ]);
  });

  it("surfaces mcp_tool_call failures as tool results", () => {
    const provider = new CodexProvider();
    const session = makeSessionShim();
    const completed = provider.parseJsonLine(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_4",
          type: "mcp_tool_call",
          server: "relay",
          tool: "list_tasks",
          arguments: { status: "open" },
          result: null,
          error: { message: "user cancelled MCP tool call" },
          status: "failed",
        },
      }),
      session,
    );
    expect(completed).toEqual([
      {
        type: "tool_result",
        toolName: "relay.list_tasks",
        content: "Error: user cancelled MCP tool call",
      },
    ]);
  });
});
