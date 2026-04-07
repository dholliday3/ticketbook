import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Normalized parts emitted by the copilot manager. Mirrors
 * packages/server/src/copilot/types.ts — kept as a duplicate type rather than
 * a workspace import because @ticketbook/core doesn't currently re-export
 * server types and we don't want to drag them into the wire contract package
 * yet. If we add Codex or another provider this is the place to widen the
 * union.
 */
export type CopilotPart =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_use"; toolName?: string; toolInput?: string; content: string }
  | { type: "tool_result"; toolName?: string; content: string }
  | { type: "error"; content: string };

export interface CopilotMessage {
  /** Stable id used as the React key. */
  id: string;
  role: "user" | "assistant";
  /**
   * Ordered list of parts. Consecutive parts of the same type are merged
   * (text/thinking accumulators) so a streaming turn renders as one chunk
   * per modality rather than dozens of tiny fragments.
   */
  parts: CopilotPart[];
  createdAt: number;
}

export interface CopilotHealth {
  providerId: string;
  status: "ready" | "not_installed" | "not_authenticated" | "error";
  cliVersion: string | null;
  error: string | null;
}

interface UseCopilotSessionState {
  sessionId: string | null;
  /** Claude's conversation_id once the first turn captures it. */
  conversationId: string | null;
  messages: CopilotMessage[];
  isStreaming: boolean;
  isStarting: boolean;
  health: CopilotHealth | null;
  error: string | null;
}

export interface UseCopilotSessionApi extends UseCopilotSessionState {
  sendMessage: (text: string) => Promise<void>;
  /** Start a fresh conversation (no resume). Tears down the current session. */
  startNew: () => void;
  /** Switch to a previously persisted conversation by Claude conversation ID. */
  switchConversation: (conversationId: string) => void;
}

interface StreamFrame {
  type: "copilot.stream";
  sessionId: string;
  messageId: string;
  part: CopilotPart;
}

interface DoneFrame {
  type: "copilot.done";
  sessionId: string;
}

interface ReadyFrame {
  type: "ready";
}

type CopilotWsFrame = StreamFrame | DoneFrame | ReadyFrame;

interface HistoryResponse {
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    parts: CopilotPart[];
    createdAt: number;
  }>;
}

/**
 * Owns the lifecycle of one copilot session: starts it via REST on mount,
 * subscribes to /api/copilot/<sessionId> over WebSocket, sends turns via
 * POST, normalizes streaming parts into a message list, and tears the
 * session down on unmount.
 *
 * Stream merging: Claude Code emits one delta per token via the server, so
 * we collapse consecutive text/thinking parts within the same messageId
 * into one accumulating part. tool_use, tool_result and error parts are
 * always pushed as their own entries.
 *
 * Conversation resume: callers can switch to a previously persisted
 * conversation via switchConversation(id), which triggers the start-session
 * effect to tear down the current session and create a new one with the
 * given conversationId pre-set on the server. The hook also fetches the
 * prior message history from /api/copilot/conversations/<id>/messages so
 * the panel renders the full chat (not just an empty resume).
 */
export function useCopilotSession(active: boolean): UseCopilotSessionApi {
  const [state, setState] = useState<UseCopilotSessionState>({
    sessionId: null,
    conversationId: null,
    messages: [],
    isStreaming: false,
    isStarting: false,
    health: null,
    error: null,
  });

  // Which Claude conversation to resume on the next start. null = brand new.
  // Bumping this triggers the start-session effect to re-run.
  const [resumeFromConversationId, setResumeFromConversationId] = useState<string | null>(null);
  // Bumped by startNew() to force the start-session effect to re-run even
  // when resumeFromConversationId stays null (e.g., starting a fresh
  // conversation when one was already null).
  const [restartCounter, setRestartCounter] = useState(0);

  // Refs that need to outlive renders for stable callbacks.
  const currentAssistantIdRef = useRef<string | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // ─── Stream merging ──────────────────────────────────────────────

  const appendPartToCurrentAssistant = useCallback(
    (messageId: string, part: CopilotPart) => {
      // Resolve the target assistant message id and update the per-turn
      // refs OUTSIDE the setState callback. The setState updater must be
      // pure — React 19's concurrent rendering can call updaters multiple
      // times for a single dispatch, and side-effects-in-the-updater would
      // produce duplicate messages on the second invocation. Computing the
      // assistantId and ref state once up front keeps the updater idempotent.
      const isNewTurn = currentMessageIdRef.current !== messageId;
      let assistantId = currentAssistantIdRef.current;
      if (isNewTurn || !assistantId) {
        assistantId = `asst-${messageId}`;
        currentAssistantIdRef.current = assistantId;
        currentMessageIdRef.current = messageId;
      }
      const targetId = assistantId;

      setState((prev) => {
        // Pure updater: relies only on `prev`, `targetId`, and `part`. Safe
        // to be called multiple times by React without producing duplicates.
        const exists = prev.messages.some((m) => m.id === targetId);
        const messages = exists
          ? prev.messages
          : [
              ...prev.messages,
              {
                id: targetId,
                role: "assistant" as const,
                parts: [],
                createdAt: Date.now(),
              },
            ];
        return {
          ...prev,
          messages: messages.map((m) => {
            if (m.id !== targetId) return m;
            const last = m.parts[m.parts.length - 1];
            if (
              last &&
              (last.type === "text" || last.type === "thinking") &&
              last.type === part.type
            ) {
              return {
                ...m,
                parts: [
                  ...m.parts.slice(0, -1),
                  { ...last, content: last.content + part.content },
                ],
              };
            }
            return { ...m, parts: [...m.parts, part] };
          }),
        };
      });
    },
    [],
  );

  // ─── Health check ────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch("/api/copilot/health")
      .then((r) => r.json())
      .then((h: CopilotHealth) => {
        if (!cancelled) setState((p) => ({ ...p, health: h }));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState((p) => ({
            ...p,
            health: null,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  // ─── Session lifecycle ───────────────────────────────────────────

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let createdSessionId: string | null = null;
    const targetConversationId = resumeFromConversationId;

    setState((p) => ({
      ...p,
      isStarting: true,
      error: null,
      // Clear messages immediately so switching feels instant. They get
      // refilled by the history fetch below for resumed conversations.
      messages: [],
      conversationId: targetConversationId,
    }));

    (async () => {
      try {
        const startRes = await fetch("/api/copilot/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            targetConversationId ? { conversationId: targetConversationId } : {},
          ),
        });
        if (!startRes.ok) {
          throw new Error(`Failed to start session: HTTP ${startRes.status}`);
        }
        const { sessionId } = (await startRes.json()) as { sessionId: string };
        if (cancelled) {
          void fetch(`/api/copilot/sessions/${sessionId}`, { method: "DELETE" });
          return;
        }
        createdSessionId = sessionId;
        sessionIdRef.current = sessionId;

        // If we're resuming, fetch the prior history. Best-effort — empty
        // result is fine, the panel still works for new turns.
        let historyMessages: CopilotMessage[] = [];
        if (targetConversationId) {
          try {
            const histRes = await fetch(
              `/api/copilot/conversations/${targetConversationId}/messages`,
            );
            if (histRes.ok) {
              const data = (await histRes.json()) as HistoryResponse;
              historyMessages = data.messages.map((m) => ({
                id: m.id,
                role: m.role,
                parts: m.parts,
                createdAt: m.createdAt,
              }));
            }
          } catch {
            // ignore — panel will just be empty until next turn
          }
        }
        if (cancelled) return;

        // We have the sessionId and (optionally) the history, but the
        // panel isn't *truly* ready until the server-side WS subscriber
        // is in place. Otherwise the next sendMessage fires before any
        // subscriber exists and the stream events get dropped on the
        // floor. We pre-load the messages here but keep `isStarting`
        // true until the server pushes its `ready` frame.
        setState((p) => ({
          ...p,
          sessionId,
          messages: historyMessages,
        }));

        // Open the WS bridge for streaming.
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(
          `${protocol}//${window.location.host}/api/copilot/${sessionId}`,
        );
        wsRef.current = ws;

        ws.addEventListener("message", (event) => {
          let frame: CopilotWsFrame;
          try {
            frame = JSON.parse(event.data) as CopilotWsFrame;
          } catch {
            return;
          }
          if (frame.type === "ready") {
            // Server-side subscriber is in place — safe to send turns.
            setState((p) => ({ ...p, isStarting: false }));
          } else if (frame.type === "copilot.stream") {
            appendPartToCurrentAssistant(frame.messageId, frame.part);
          } else if (frame.type === "copilot.done") {
            currentAssistantIdRef.current = null;
            currentMessageIdRef.current = null;
            setState((p) => ({ ...p, isStreaming: false }));
          }
        });

        ws.addEventListener("error", () => {
          setState((p) => ({ ...p, error: "WebSocket error" }));
        });
      } catch (err) {
        if (cancelled) return;
        setState((p) => ({
          ...p,
          isStarting: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    })();

    return () => {
      cancelled = true;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "panel closed");
      }
      wsRef.current = null;
      const idToDelete = createdSessionId ?? sessionIdRef.current;
      if (idToDelete) {
        void fetch(`/api/copilot/sessions/${idToDelete}`, { method: "DELETE" });
      }
      sessionIdRef.current = null;
      currentAssistantIdRef.current = null;
      currentMessageIdRef.current = null;
      // Reset session-specific state but PRESERVE the health check —
      // the health effect is gated on [active] and doesn't re-run on
      // restart, so wiping health here would leave it null forever and
      // permanently disable the submit button. Errors are also cleared
      // so a stale message doesn't bleed into the new session.
      setState((p) => ({
        ...p,
        sessionId: null,
        conversationId: null,
        messages: [],
        isStreaming: false,
        isStarting: false,
        error: null,
      }));
    };
  }, [active, resumeFromConversationId, restartCounter, appendPartToCurrentAssistant]);

  // ─── Send message ────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = sessionIdRef.current;
    if (!id) throw new Error("Copilot session not ready");

    setState((p) => ({
      ...p,
      isStreaming: true,
      error: null,
      messages: [
        ...p.messages,
        {
          id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: "user",
          parts: [{ type: "text", content: trimmed }],
          createdAt: Date.now(),
        },
      ],
    }));

    try {
      const res = await fetch(`/api/copilot/sessions/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setState((p) => ({
        ...p,
        isStreaming: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const startNew = useCallback(() => {
    // Clear any resume target and bump the restart counter so the
    // start-session effect re-runs even when resumeFromConversationId is
    // already null (which is the common "I just opened the panel" case).
    setResumeFromConversationId(null);
    setRestartCounter((n) => n + 1);
  }, []);

  const switchConversation = useCallback((conversationId: string) => {
    setResumeFromConversationId(conversationId);
  }, []);

  return {
    ...state,
    sendMessage,
    startNew,
    switchConversation,
  };
}
