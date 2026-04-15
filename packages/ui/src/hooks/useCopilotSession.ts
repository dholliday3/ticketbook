import { useCallback, useEffect, useRef, useState } from "react";

export type CopilotProviderId = "claude-code" | "codex";

export type CopilotPart =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_use"; toolName?: string; toolInput?: string; content: string }
  | { type: "tool_result"; toolName?: string; content: string }
  | { type: "error"; content: string };

export interface CopilotMessage {
  id: string;
  role: "user" | "assistant";
  parts: CopilotPart[];
  createdAt: number;
}

export interface CopilotHealth {
  providerId: CopilotProviderId;
  status: "ready" | "not_installed" | "not_authenticated" | "error";
  cliVersion: string | null;
  error: string | null;
}

interface UseCopilotSessionState {
  sessionId: string | null;
  conversationId: string | null;
  providerConversationId: string | null;
  selectedProviderId: CopilotProviderId | null;
  providers: CopilotHealth[];
  messages: CopilotMessage[];
  isStreaming: boolean;
  isStarting: boolean;
  error: string | null;
  /**
   * Per-turn model override. Undefined / empty means "let the CLI pick".
   * Stored per-provider in localStorage so switching back to a provider
   * remembers the last selection.
   */
  selectedModel: string | null;
  /**
   * Per-turn reasoning effort override. Only honored by providers that
   * expose a reasoning knob (currently codex). Stored per-provider in
   * localStorage the same way as selectedModel.
   */
  selectedReasoningEffort: string | null;
}

export interface UseCopilotSessionApi extends UseCopilotSessionState {
  sendMessage: (text: string) => Promise<void>;
  startNew: () => void;
  switchConversation: (conversationId: string, providerId: CopilotProviderId) => void;
  setProviderId: (providerId: CopilotProviderId) => void;
  setModel: (model: string | null) => void;
  setReasoningEffort: (effort: string | null) => void;
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
  conversationId: string | null;
  providerId: CopilotProviderId | null;
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

interface ProvidersResponse {
  defaultProviderId: CopilotProviderId;
  providers: CopilotHealth[];
}

interface ConversationListResponse {
  conversations: Array<{
    id: string;
    provider_id: CopilotProviderId;
  }>;
}

const LOCAL_STORAGE_KEY = "relay.copilot.provider";
const MODEL_STORAGE_PREFIX = "relay.copilot.model:";
const EFFORT_STORAGE_PREFIX = "relay.copilot.reasoningEffort:";
/**
 * One-time flag that records whether we've seeded first-run defaults for
 * this browser. Once set, we never seed again even if the user clears an
 * individual selection — otherwise picking "Default" would silently snap
 * back to `sonnet` on the next reload.
 */
const DEFAULTS_SEEDED_KEY = "relay.copilot.defaultsSeeded";

function readProviderScopedSetting(prefix: string, providerId: CopilotProviderId | null): string | null {
  if (!providerId) return null;
  try {
    const value = window.localStorage.getItem(`${prefix}${providerId}`);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeProviderScopedSetting(
  prefix: string,
  providerId: CopilotProviderId | null,
  value: string | null,
): void {
  if (!providerId) return;
  try {
    if (value && value.length > 0) {
      window.localStorage.setItem(`${prefix}${providerId}`, value);
    } else {
      window.localStorage.removeItem(`${prefix}${providerId}`);
    }
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * On first use of this browser, pre-populate the Claude Code selection
 * with `sonnet` + `high`. We only touch keys that are absent — any
 * existing selection (from a returning user) is preserved as-is — and
 * we record a one-time "seeded" marker so subsequent visits never
 * overwrite the user's deliberate "Default" choices.
 */
function seedFirstTimeDefaults(): void {
  try {
    if (window.localStorage.getItem(DEFAULTS_SEEDED_KEY) === "1") return;
    const modelKey = `${MODEL_STORAGE_PREFIX}claude-code`;
    const effortKey = `${EFFORT_STORAGE_PREFIX}claude-code`;
    if (window.localStorage.getItem(modelKey) === null) {
      window.localStorage.setItem(modelKey, "sonnet");
    }
    if (window.localStorage.getItem(effortKey) === null) {
      window.localStorage.setItem(effortKey, "high");
    }
    window.localStorage.setItem(DEFAULTS_SEEDED_KEY, "1");
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * Bundles the per-provider selection reads so every code path that
 * changes `selectedProviderId` can rehydrate model + effort together.
 * Keeping this in one place means we can't forget to update one of
 * the three state fields when swapping providers.
 */
function selectionsForProvider(providerId: CopilotProviderId | null): {
  selectedModel: string | null;
  selectedReasoningEffort: string | null;
} {
  return {
    selectedModel: readProviderScopedSetting(MODEL_STORAGE_PREFIX, providerId),
    selectedReasoningEffort: readProviderScopedSetting(EFFORT_STORAGE_PREFIX, providerId),
  };
}

export function useCopilotSession(active: boolean): UseCopilotSessionApi {
  const [state, setState] = useState<UseCopilotSessionState>({
    sessionId: null,
    conversationId: null,
    providerConversationId: null,
    selectedProviderId: null,
    providers: [],
    messages: [],
    isStreaming: false,
    isStarting: false,
    error: null,
    selectedModel: null,
    selectedReasoningEffort: null,
  });
  const [resumeFromConversationId, setResumeFromConversationId] = useState<string | null>(null);
  const [restartCounter, setRestartCounter] = useState(0);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [initializedFromHistory, setInitializedFromHistory] = useState(false);

  const currentAssistantIdRef = useRef<string | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Mirror the current provider into a ref so setModel / setReasoningEffort
  // can persist to the right localStorage key without consulting React
  // state (see the comment inside those callbacks for the reasoning).
  // Assigning during render is safe for refs (they're mutable and don't
  // trigger re-renders) and ensures the ref is current by the time any
  // click handler in the just-rendered tree can fire — using useEffect
  // instead would be one commit too late.
  const selectedProviderIdRef = useRef<CopilotProviderId | null>(null);
  selectedProviderIdRef.current = state.selectedProviderId;

  const clearLiveSession = useCallback(() => {
    sessionIdRef.current = null;
    currentAssistantIdRef.current = null;
    currentMessageIdRef.current = null;
    setState((prev) => ({
      ...prev,
      sessionId: null,
      conversationId: null,
      providerConversationId: null,
      messages: [],
      isStreaming: false,
      isStarting: true,
      error: null,
    }));
  }, []);

  const appendPartToCurrentAssistant = useCallback(
    (messageId: string, part: CopilotPart) => {
      const isNewTurn = currentMessageIdRef.current !== messageId;
      let assistantId = currentAssistantIdRef.current;
      if (isNewTurn || !assistantId) {
        assistantId = `asst-${messageId}`;
        currentAssistantIdRef.current = assistantId;
        currentMessageIdRef.current = messageId;
      }
      const targetId = assistantId;

      setState((prev) => {
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
          messages: messages.map((message) => {
            if (message.id !== targetId) return message;
            const last = message.parts.at(-1);
            if (
              last &&
              (last.type === "text" || last.type === "thinking") &&
              last.type === part.type
            ) {
              return {
                ...message,
                parts: [
                  ...message.parts.slice(0, -1),
                  { ...last, content: last.content + part.content },
                ],
              };
            }
            return { ...message, parts: [...message.parts, part] };
          }),
        };
      });
    },
    [],
  );

  useEffect(() => {
    if (!active) return;
    // Seed first-run defaults BEFORE we read the stored selections, so a
    // brand-new install lands on claude-code + sonnet + high instead of
    // an empty "Default" state.
    seedFirstTimeDefaults();
    let cancelled = false;
    fetch("/api/copilot/providers")
      .then((response) => response.json())
      .then((data: ProvidersResponse) => {
        if (cancelled) return;
        const storedProvider =
          (window.localStorage.getItem(LOCAL_STORAGE_KEY) as CopilotProviderId | null) ?? null;
        const validStoredProvider = data.providers.some((provider) => provider.providerId === storedProvider)
          ? storedProvider
          : null;
        const selectedProviderId =
          validStoredProvider ??
          data.defaultProviderId ??
          data.providers[0]?.providerId ??
          null;
        setState((prev) => ({
          ...prev,
          providers: data.providers,
          selectedProviderId,
          ...selectionsForProvider(selectedProviderId),
        }));
        setProvidersLoaded(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : String(err),
          }));
          setProvidersLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!active || !providersLoaded || initializedFromHistory || !state.selectedProviderId) return;
    let cancelled = false;
    fetch("/api/copilot/conversations")
      .then((response) => (response.ok ? response.json() : { conversations: [] }))
      .then((data: ConversationListResponse) => {
        if (cancelled) return;
        if (data.conversations.length > 0) {
          const latest = data.conversations[0];
          window.localStorage.setItem(LOCAL_STORAGE_KEY, latest.provider_id);
          setResumeFromConversationId(latest.id);
          setState((prev) => ({
            ...prev,
            selectedProviderId: latest.provider_id,
            // The auto-resumed conversation may be on a different
            // provider than whatever was stored as the default. Pull
            // the new provider's persisted model/effort so we don't
            // leave stale values from the previous provider in state.
            ...selectionsForProvider(latest.provider_id),
          }));
        }
        setInitializedFromHistory(true);
      })
      .catch(() => {
        if (!cancelled) setInitializedFromHistory(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, providersLoaded, initializedFromHistory, state.selectedProviderId]);

  useEffect(() => {
    if (!active) return;
    if (!providersLoaded || !initializedFromHistory || !state.selectedProviderId) return;

    let cancelled = false;
    let createdSessionId: string | null = null;
    const targetConversationId = resumeFromConversationId;
    const providerId = state.selectedProviderId;

    setState((prev) => ({
      ...prev,
      isStarting: true,
      error: null,
      messages: [],
      conversationId: targetConversationId,
      providerConversationId: null,
    }));

    (async () => {
      try {
        const startRes = await fetch("/api/copilot/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId,
            ...(targetConversationId ? { conversationId: targetConversationId } : {}),
          }),
        });
        if (!startRes.ok) {
          throw new Error(`Failed to start session: HTTP ${startRes.status}`);
        }

        const { sessionId, session } = (await startRes.json()) as {
          sessionId: string;
          session?: {
            providerId?: CopilotProviderId | null;
            providerConversationId?: string | null;
          };
        };
        if (cancelled) {
          void fetch(`/api/copilot/sessions/${sessionId}`, { method: "DELETE" });
          return;
        }
        createdSessionId = sessionId;
        sessionIdRef.current = sessionId;

        let historyMessages: CopilotMessage[] = [];
        if (targetConversationId) {
          try {
            const histRes = await fetch(`/api/copilot/conversations/${targetConversationId}/messages`);
            if (histRes.ok) {
              const data = (await histRes.json()) as HistoryResponse;
              historyMessages = data.messages.map((message) => ({
                id: message.id,
                role: message.role,
                parts: message.parts,
                createdAt: message.createdAt,
              }));
            }
          } catch {
            // ignore
          }
        }
        if (cancelled) return;

        setState((prev) => {
          const nextProviderId = session?.providerId ?? prev.selectedProviderId;
          const providerChanged = nextProviderId !== prev.selectedProviderId;
          return {
            ...prev,
            sessionId,
            messages: historyMessages,
            selectedProviderId: nextProviderId,
            providerConversationId: session?.providerConversationId ?? null,
            // Only rehydrate when the provider actually flipped — otherwise
            // we'd clobber an in-flight selection the user just made.
            ...(providerChanged ? selectionsForProvider(nextProviderId) : {}),
          };
        });

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${protocol}//${window.location.host}/api/copilot/${sessionId}`);
        wsRef.current = ws;

        ws.addEventListener("message", (event) => {
          let frame: CopilotWsFrame;
          try {
            frame = JSON.parse(event.data) as CopilotWsFrame;
          } catch {
            return;
          }

          if (frame.type === "ready") {
            setState((prev) => ({ ...prev, isStarting: false }));
            return;
          }

          if (frame.type === "copilot.stream") {
            appendPartToCurrentAssistant(frame.messageId, frame.part);
            return;
          }

          currentAssistantIdRef.current = null;
          currentMessageIdRef.current = null;
          setState((prev) => {
            const nextProviderId = frame.providerId ?? prev.selectedProviderId;
            const providerChanged = nextProviderId !== prev.selectedProviderId;
            return {
              ...prev,
              isStreaming: false,
              conversationId: frame.conversationId ?? prev.conversationId,
              selectedProviderId: nextProviderId,
              // Same guard as in the session-start path: only touch
              // model/effort when the provider itself changed.
              ...(providerChanged ? selectionsForProvider(nextProviderId) : {}),
            };
          });
        });

        ws.addEventListener("error", () => {
          setState((prev) => ({ ...prev, error: "WebSocket error" }));
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
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
      setState((prev) => ({
        ...prev,
        sessionId: null,
        conversationId: null,
        providerConversationId: null,
        messages: [],
        isStreaming: false,
        isStarting: false,
        error: null,
      }));
    };
  }, [
    active,
    appendPartToCurrentAssistant,
    initializedFromHistory,
    providersLoaded,
    restartCounter,
    resumeFromConversationId,
    state.selectedProviderId,
  ]);

  // Grab the latest model/effort at send time via a ref so the callback
  // doesn't need them in its dep array (which would re-create the function
  // on every selector change and invalidate memoized consumers).
  const sendOptionsRef = useRef<{ model: string | null; reasoningEffort: string | null }>({
    model: null,
    reasoningEffort: null,
  });
  useEffect(() => {
    sendOptionsRef.current = {
      model: state.selectedModel,
      reasoningEffort: state.selectedReasoningEffort,
    };
  }, [state.selectedModel, state.selectedReasoningEffort]);

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = sessionIdRef.current;
    if (!id) throw new Error("Copilot session not ready");

    setState((prev) => ({
      ...prev,
      isStreaming: true,
      error: null,
      messages: [
        ...prev.messages,
        {
          id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: "user",
          parts: [{ type: "text", content: trimmed }],
          createdAt: Date.now(),
        },
      ],
    }));

    try {
      const { model, reasoningEffort } = sendOptionsRef.current;
      const response = await fetch(`/api/copilot/sessions/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          ...(model ? { model } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isStreaming: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const startNew = useCallback(() => {
    clearLiveSession();
    setResumeFromConversationId(null);
    setRestartCounter((count) => count + 1);
  }, [clearLiveSession]);

  const switchConversation = useCallback((conversationId: string, providerId: CopilotProviderId) => {
    clearLiveSession();
    window.localStorage.setItem(LOCAL_STORAGE_KEY, providerId);
    setState((prev) => ({
      ...prev,
      selectedProviderId: providerId,
      ...selectionsForProvider(providerId),
    }));
    setResumeFromConversationId(conversationId);
  }, [clearLiveSession]);

  const setProviderId = useCallback((providerId: CopilotProviderId) => {
    clearLiveSession();
    window.localStorage.setItem(LOCAL_STORAGE_KEY, providerId);
    setResumeFromConversationId(null);
    setState((prev) => ({
      ...prev,
      selectedProviderId: providerId,
      // Rehydrate the model + effort for the new provider. Each provider
      // has its own valid vocabulary (`sonnet` doesn't make sense for
      // codex, `xhigh` doesn't make sense for claude), so we namespace
      // the localStorage keys per-provider.
      ...selectionsForProvider(providerId),
    }));
    setRestartCounter((count) => count + 1);
  }, [clearLiveSession]);

  const setModel = useCallback((model: string | null) => {
    // Side effects (localStorage writes) must live OUTSIDE the setState
    // updater — React can call the updater multiple times per invocation
    // (notably under StrictMode) and the `prev` it passes may be a stale
    // snapshot mid-batch. Writing to storage from inside the updater
    // corrupts the per-provider keys during provider swaps. Reading the
    // current provider from a ref sidesteps that entirely.
    writeProviderScopedSetting(
      MODEL_STORAGE_PREFIX,
      selectedProviderIdRef.current,
      model,
    );
    setState((prev) => ({ ...prev, selectedModel: model }));
  }, []);

  const setReasoningEffort = useCallback((effort: string | null) => {
    writeProviderScopedSetting(
      EFFORT_STORAGE_PREFIX,
      selectedProviderIdRef.current,
      effort,
    );
    setState((prev) => ({ ...prev, selectedReasoningEffort: effort }));
  }, []);

  return {
    ...state,
    sendMessage,
    startNew,
    switchConversation,
    setProviderId,
    setModel,
    setReasoningEffort,
  };
}
