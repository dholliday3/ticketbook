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
  messages: CopilotMessage[];
  isStreaming: boolean;
  isStarting: boolean;
  health: CopilotHealth | null;
  error: string | null;
}

export interface UseCopilotSessionApi extends UseCopilotSessionState {
  sendMessage: (text: string) => Promise<void>;
  reset: () => void;
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
 */
export function useCopilotSession(active: boolean): UseCopilotSessionApi {
  const [state, setState] = useState<UseCopilotSessionState>({
    sessionId: null,
    messages: [],
    isStreaming: false,
    isStarting: false,
    health: null,
    error: null,
  });
  // Bumped by reset() to force a fresh server session — the start-session
  // useEffect re-runs whenever this changes, tearing down the old WS + REST
  // session and creating a new one.
  const [resetCounter, setResetCounter] = useState(0);

  // The current assistant message id we're appending parts to. When a new
  // copilot.done arrives this resets so the next turn starts a fresh message.
  const currentAssistantIdRef = useRef<string | null>(null);
  // Used to associate streaming parts with the message they belong to. If a
  // new messageId shows up mid-stream we start a fresh assistant message.
  const currentMessageIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // ─── Stream merging ──────────────────────────────────────────────

  const appendPartToCurrentAssistant = useCallback(
    (messageId: string, part: CopilotPart) => {
      setState((prev) => {
        let messages = prev.messages;
        let assistantId = currentAssistantIdRef.current;
        const isNewTurn = currentMessageIdRef.current !== messageId;

        if (isNewTurn || !assistantId) {
          assistantId = `asst-${messageId}`;
          currentAssistantIdRef.current = assistantId;
          currentMessageIdRef.current = messageId;
          messages = [
            ...messages,
            {
              id: assistantId,
              role: "assistant",
              parts: [],
              createdAt: Date.now(),
            },
          ];
        }

        return {
          ...prev,
          messages: messages.map((m) => {
            if (m.id !== assistantId) return m;
            const last = m.parts[m.parts.length - 1];
            // Merge consecutive text/thinking deltas into one accumulating part
            // so Streamdown renders the full chunk, not a fragment per token.
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

  // ─── Session lifecycle ───────────────────────────────────────────

  // Health check is cheap and reusable across sessions; do it once when the
  // panel first becomes active so the user sees provider status immediately.
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

  // Start the session and open the WS bridge whenever the panel is active.
  // On unmount or deactivation we DELETE the session and close the WS.
  // Re-runs when resetCounter bumps so reset() can start a fresh session.
  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let createdSessionId: string | null = null;

    setState((p) => ({ ...p, isStarting: true, error: null }));

    fetch("/api/copilot/sessions", { method: "POST" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to start session: HTTP ${r.status}`);
        return (await r.json()) as { sessionId: string };
      })
      .then(({ sessionId }) => {
        if (cancelled) {
          // Session was created but the panel already closed — clean up.
          void fetch(`/api/copilot/sessions/${sessionId}`, { method: "DELETE" });
          return;
        }
        createdSessionId = sessionId;
        sessionIdRef.current = sessionId;
        setState((p) => ({ ...p, sessionId, isStarting: false }));

        // Open the WS bridge for streaming. The server pushes copilot.stream
        // and copilot.done frames; this socket is push-only.
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
          if (frame.type === "copilot.stream") {
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
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState((p) => ({
          ...p,
          isStarting: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      });

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
      setState({
        sessionId: null,
        messages: [],
        isStreaming: false,
        isStarting: false,
        health: null,
        error: null,
      });
    };
  }, [active, resetCounter, appendPartToCurrentAssistant]);

  // ─── Send message ────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = sessionIdRef.current;
    if (!id) throw new Error("Copilot session not ready");

    // Optimistically append the user message and flip to streaming. The
    // assistant message is created lazily when the first stream frame
    // arrives (we don't know its messageId yet).
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

  const reset = useCallback(() => {
    // Bumping the counter triggers the start-session effect's cleanup (which
    // DELETEs the old server session) and re-runs it to create a fresh one.
    // The state is reset by the cleanup branch's setState call.
    setResetCounter((n) => n + 1);
  }, []);

  return {
    ...state,
    sendMessage,
    reset,
  };
}
