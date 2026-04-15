import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  PlusIcon,
  SparkleIcon,
  Trash2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { splitByContextRefs } from "@ticketbook/core/context-refs";
import { ContextRefChip } from "./copilot/ContextRefChip";
import {
  CopilotPromptEditor,
  type CopilotPromptEditorRef,
} from "./copilot/CopilotPromptEditor";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageBranch,
  MessageBranchContent,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputController,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { useAppContext } from "@/context/AppContext";
import {
  Suggestion,
  Suggestions,
} from "@/components/ai-elements/suggestion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCopilotSession, type CopilotPart } from "@/hooks/useCopilotSession";
import { useCopilotConversations } from "@/hooks/useCopilotConversations";
import { cn } from "@/lib/utils";

interface CopilotPanelProps {
  onClose: () => void;
}

/**
 * Right-rail copilot panel — talks to the headless Claude Code provider via
 * /api/copilot. Built on the canonical ai-elements chatbot pattern:
 *   <Conversation>
 *     <ConversationContent>
 *       <MessageBranch><MessageBranchContent>
 *         <Message from={role}>
 *           {reasoning above content}
 *           {tool blocks above content}
 *           <MessageContent><MessageResponse>{text}</MessageResponse></MessageContent>
 *         </Message>
 *       </MessageBranchContent></MessageBranch>
 *     </ConversationContent>
 *     <ConversationScrollButton />
 *   </Conversation>
 *   <div className="grid shrink-0 gap-4 pt-4">
 *     <Suggestions /> (only when empty)
 *     <PromptInput />
 *   </div>
 *
 * Each part of the message is rendered as a sibling of MessageContent inside
 * the Message wrapper, so the user-message bubble (.bg-secondary, .ml-auto)
 * only wraps the actual text. Reasoning and tool blocks sit above as their
 * own full-width children.
 *
 * Custom <ToolBlock> stays for now because ai-elements' canonical <Tool>
 * expects Vercel AI SDK tool-call shapes that pair tool_use + tool_result
 * via tool_use_id. Our server emits them as separate parts; pairing them on
 * the server (TKTB-060 follow-up) would let us swap to the upstream <Tool>.
 */
export function CopilotPanel({ onClose }: CopilotPanelProps) {
  return (
    <PromptInputProvider>
      <CopilotPanelInner onClose={onClose} />
    </PromptInputProvider>
  );
}

function CopilotPanelInner({ onClose }: CopilotPanelProps) {
  const session = useCopilotSession(true);
  // Pending-insertion draining happens inside CopilotPromptEditor
  // itself so it can wait for the editor to become ready.
  const editorRef = useRef<CopilotPromptEditorRef | null>(null);

  // Bumps every time a turn finishes streaming, used as a refetch key
  // for the conversations list so newly created or updated conversations
  // appear in the dropdown without a manual reload.
  const [conversationsRefreshKey, setConversationsRefreshKey] = useState(0);
  useEffect(() => {
    if (!session.isStreaming) {
      setConversationsRefreshKey((n) => n + 1);
    }
  }, [session.isStreaming]);

  const { conversations, remove: deleteConversation } = useCopilotConversations(
    true,
    conversationsRefreshKey,
  );

  // PromptInput owns the textarea state via FormData (the textarea has
  // name="message"). We just receive the submitted text in the handler.
  const handleSubmit = async (message: PromptInputMessage): Promise<void> => {
    if (!message.text.trim()) return;
    await session.sendMessage(message.text);
  };

  const handleSuggestionClick = (suggestion: string) => {
    void session.sendMessage(suggestion);
  };

  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (id === session.conversationId) {
      // Deleting the active conversation: start a fresh one first
      session.startNew();
    }
    await deleteConversation(id);
  };

  const activeProvider =
    session.selectedProviderId
      ? session.providers.find((provider) => provider.providerId === session.selectedProviderId) ?? null
      : null;

  const canSubmit =
    !session.isStarting &&
    !session.isStreaming &&
    session.sessionId !== null &&
    activeProvider?.status === "ready";

  const statusLabel = session.isStreaming
    ? "Streaming…"
    : session.isStarting
      ? "Starting…"
      : session.sessionId
        ? "Ready"
        : activeProvider?.status === "not_installed"
          ? `${providerLabel(session.selectedProviderId)} not installed`
          : "Not connected";

  const isEmpty = session.messages.length === 0;

  const activeConversation =
    session.conversationId
      ? conversations.find((c) => c.id === session.conversationId) ?? null
      : null;
  const headerTitle = activeConversation?.title ?? "New conversation";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
        {/* Custom header with conversation switcher dropdown + new + close. */}
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Switch conversation"
              data-testid="copilot-conversation-trigger"
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <SparkleIcon className="size-3.5 shrink-0" />
              <span className="truncate font-semibold">{headerTitle}</span>
              {activeConversation && (
                <span className="shrink-0 text-muted-foreground/60">
                  · {providerLabel(activeConversation.provider_id)}
                </span>
              )}
              {activeProvider?.cliVersion && !activeConversation && (
                <span className="shrink-0 text-muted-foreground/60">
                  · {activeProvider.cliVersion.replace(/\s*\(.*\)$/, "")}
                </span>
              )}
              <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-[60vh] min-w-[260px] overflow-y-auto"
              data-testid="copilot-conversations-menu"
            >
              <DropdownMenuItem
                onSelect={() => session.startNew()}
                data-testid="copilot-new-conversation"
                className="gap-2"
              >
                <PlusIcon className="size-4" />
                <span>New conversation</span>
              </DropdownMenuItem>
              {conversations.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                    Recent
                  </DropdownMenuLabel>
                  {conversations.map((c) => {
                    const isActive = c.id === session.conversationId;
                    return (
                      <DropdownMenuItem
                        key={c.id}
                        onSelect={() => session.switchConversation(c.id, c.provider_id)}
                        data-testid="copilot-conversation-item"
                        data-conversation-id={c.id}
                        className={cn(
                          "group flex items-start gap-2",
                          isActive && "bg-accent",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{c.title}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {providerLabel(c.provider_id)} · {formatRelative(c.updated_at)} · {c.message_count}{" "}
                            {c.message_count === 1 ? "turn" : "turns"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => void handleDeleteConversation(c.id, e)}
                          aria-label={`Delete conversation: ${c.title}`}
                          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                        >
                          <Trash2Icon className="size-3.5" />
                        </button>
                      </DropdownMenuItem>
                    );
                  })}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => session.startNew()}
              disabled={session.isStreaming || isEmpty}
              aria-label="New conversation"
              title="New conversation"
              data-testid="copilot-new-conversation-button"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            >
              <PlusIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close assistant"
              title="Close"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {session.error && (
          <div className="flex-shrink-0 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {session.error}
          </div>
        )}

        {/* Canonical chatbot layout — divide-y draws the line between the
            scrolling conversation and the (suggestions+input) bottom area. */}
        <div className="relative flex min-h-0 flex-1 flex-col divide-y divide-border overflow-hidden">
          <Conversation>
            <ConversationContent>
              {isEmpty ? (
                <ConversationEmptyState
                  title="What are we building?"
                  description="Ask me to draft a task, plan an epic, or read your existing tasks."
                  icon={<SparkleIcon className="size-6" />}
                />
              ) : (
                <>
                  {session.messages.map((msg, msgIndex) => {
                    const isLastMessage = msgIndex === session.messages.length - 1;
                    const isStillStreaming =
                      session.isStreaming && isLastMessage && msg.role === "assistant";
                    return (
                      <MessageBranch defaultBranch={0} key={msg.id}>
                        <MessageBranchContent>
                          <Message
                            from={msg.role}
                            data-testid="copilot-message"
                            data-role={msg.role}
                          >
                            {msg.parts.map((part, i) => (
                              <CopilotPartView
                                key={`${msg.id}-${i}`}
                                part={part}
                                isStreaming={
                                  session.isStreaming &&
                                  msg.role === "assistant" &&
                                  i === msg.parts.length - 1
                                }
                              />
                            ))}
                            {msg.role === "assistant" && !isStillStreaming && (
                              <CopilotMessageActions message={msg} />
                            )}
                          </Message>
                        </MessageBranchContent>
                      </MessageBranch>
                    );
                  })}
                  {session.isStreaming &&
                    session.messages.at(-1)?.role === "user" && (
                      <CopilotPendingBubble />
                    )}
                </>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          {/* Bottom area — grid with suggestions (when empty) and the input */}
          <div className="grid shrink-0 gap-3 pt-3">
            {isEmpty && (
              <Suggestions className="px-3">
                {STARTER_SUGGESTIONS.map((s) => (
                  <Suggestion
                    key={s}
                    suggestion={s}
                    onClick={handleSuggestionClick}
                  />
                ))}
              </Suggestions>
            )}
            <div className="w-full px-3 pb-3">
              <PromptInput onSubmit={handleSubmit}>
                <PromptInputBody>
                  <CopilotPromptEditor
                    ref={editorRef}
                    placeholder="Ask the assistant… (type @ to reference a task, plan, or doc)"
                    disabled={!session.sessionId}
                    onSubmit={() => {
                      // Find the form wrapping the editor and request a
                      // submit so the existing PromptInput.handleSubmit
                      // path runs (reads controller.textInput.value,
                      // calls onSubmit, clears the controller).
                      const el = document.activeElement as HTMLElement | null;
                      const form = el?.closest("form");
                      form?.requestSubmit();
                    }}
                  />
                </PromptInputBody>
                <PromptInputFooter>
                  <PromptInputTools className="min-w-0 flex-wrap">
                    {/* Provider switcher — replaces the old header select.
                        Changing provider restarts the session, so we only
                        enable it when we're not mid-stream. */}
                    <PromptInputSelect
                      value={session.selectedProviderId ?? "claude-code"}
                      onValueChange={(value) =>
                        session.setProviderId(value as "claude-code" | "codex")
                      }
                      disabled={session.isStreaming}
                    >
                      <PromptInputSelectTrigger
                        className="h-7 gap-1 px-2 text-xs"
                        data-testid="copilot-provider-select"
                      >
                        <PromptInputSelectValue placeholder="Provider" />
                      </PromptInputSelectTrigger>
                      <PromptInputSelectContent>
                        {session.providers.map((provider) => (
                          <PromptInputSelectItem
                            key={provider.providerId}
                            value={provider.providerId}
                          >
                            {providerLabel(provider.providerId)}
                          </PromptInputSelectItem>
                        ))}
                      </PromptInputSelectContent>
                    </PromptInputSelect>

                    {/* Model override — options depend on the active
                        provider, "default" means "let the CLI pick".
                        Radix Select sometimes re-fires onValueChange with
                        an empty string when the controlled `value` prop
                        transitions across an options-list change (e.g.
                        during a provider swap). We ignore anything that
                        isn't an explicit sentinel or a known option so
                        those spurious callbacks can't wipe the persisted
                        selection. */}
                    <PromptInputSelect
                      value={session.selectedModel ?? DEFAULT_SENTINEL}
                      onValueChange={(value) => {
                        if (value === DEFAULT_SENTINEL) {
                          session.setModel(null);
                        } else if (value) {
                          session.setModel(value);
                        }
                      }}
                    >
                      <PromptInputSelectTrigger
                        className="h-7 gap-1 px-2 text-xs"
                        data-testid="copilot-model-select"
                      >
                        <PromptInputSelectValue placeholder="Model" />
                      </PromptInputSelectTrigger>
                      <PromptInputSelectContent>
                        {modelOptionsFor(session.selectedProviderId).map((opt) => (
                          <PromptInputSelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </PromptInputSelectItem>
                        ))}
                      </PromptInputSelectContent>
                    </PromptInputSelect>

                    {/* Reasoning effort — both providers expose an effort
                        knob (`--effort` on claude-code, `model_reasoning_effort`
                        on codex), but with different vocabularies. The
                        options list is chosen per-provider so we never
                        offer a level the active CLI will reject. */}
                    <PromptInputSelect
                      value={session.selectedReasoningEffort ?? DEFAULT_SENTINEL}
                      onValueChange={(value) => {
                        // Same spurious-empty-string guard as the model
                        // select above.
                        if (value === DEFAULT_SENTINEL) {
                          session.setReasoningEffort(null);
                        } else if (value) {
                          session.setReasoningEffort(value);
                        }
                      }}
                    >
                      <PromptInputSelectTrigger
                        className="h-7 gap-1 px-2 text-xs"
                        data-testid="copilot-reasoning-select"
                      >
                        <PromptInputSelectValue placeholder="Effort" />
                      </PromptInputSelectTrigger>
                      <PromptInputSelectContent>
                        {effortOptionsFor(session.selectedProviderId).map((opt) => (
                          <PromptInputSelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </PromptInputSelectItem>
                        ))}
                      </PromptInputSelectContent>
                    </PromptInputSelect>

                    <span
                      className="ml-auto truncate px-1 text-xs text-muted-foreground"
                      aria-live="polite"
                    >
                      {statusLabel}
                    </span>
                  </PromptInputTools>
                  <PromptInputSubmit
                    status={session.isStreaming ? "streaming" : undefined}
                    disabled={!canSubmit}
                  />
                </PromptInputFooter>
              </PromptInput>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function providerLabel(providerId: "claude-code" | "codex" | null): string {
  if (providerId === "codex") return "Codex";
  return "Claude Code";
}

// ─── Pending-response bubble ───────────────────────────────────────

// Whimsical gerunds shown while waiting on the first streamed chunk,
// a la Claude Code's own loading states. One word is picked at random
// per loading instance and sticks for the duration of the wait.
const PENDING_WORDS = [
  "Pondering",
  "Musing",
  "Cogitating",
  "Ruminating",
  "Brewing",
  "Conjuring",
  "Noodling",
  "Hatching",
  "Scheming",
  "Simmering",
  "Percolating",
  "Marinating",
  "Mulling",
  "Churning",
  "Finagling",
  "Reticulating",
  "Rummaging",
  "Tinkering",
  "Plotting",
  "Unfurling",
  "Deliberating",
  "Contemplating",
] as const;

function CopilotPendingBubble() {
  const [word] = useState(
    () => PENDING_WORDS[Math.floor(Math.random() * PENDING_WORDS.length)],
  );
  return (
    <Message from="assistant" data-testid="copilot-pending" data-role="assistant">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Shimmer duration={2.5}>{`${word}…`}</Shimmer>
      </div>
    </Message>
  );
}

// ─── Part renderers ────────────────────────────────────────────────

/**
 * Each part renders as a direct child of <Message>. Text parts wrap in
 * <MessageContent> so they pick up the user-bubble styling on user messages
 * and the foreground-text styling on assistant messages. Reasoning and tool
 * parts render as their own full-width blocks above/between text.
 */
function CopilotPartView({
  part,
  isStreaming,
}: {
  part: CopilotPart;
  isStreaming: boolean;
}) {
  switch (part.type) {
    case "text":
      return (
        <MessageContent>
          <TextWithContextRefs text={part.content} />
        </MessageContent>
      );

    case "thinking":
      return (
        <Reasoning isStreaming={isStreaming}>
          <ReasoningTrigger />
          <ReasoningContent>{part.content}</ReasoningContent>
        </Reasoning>
      );

    case "tool_use":
      return <ToolBlock kind="use" name={part.toolName} body={part.content} />;

    case "tool_result":
      return <ToolBlock kind="result" name={part.toolName} body={part.content} />;

    case "error":
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {part.content}
        </div>
      );
  }
}

/**
 * Renders a text part from a copilot message, inlining `<task />` and
 * `<plan />` context refs as interactive chips. Text slices between
 * markers render via the standard MessageResponse (markdown) pipeline,
 * so formatting around the chips is preserved.
 */
function TextWithContextRefs({ text }: { text: string }) {
  const spans = useMemo(() => splitByContextRefs(text), [text]);

  if (spans.length === 0) {
    return <MessageResponse>{text}</MessageResponse>;
  }
  if (spans.length === 1 && spans[0].type === "text") {
    return <MessageResponse>{spans[0].content}</MessageResponse>;
  }

  return (
    <>
      {spans.map((span, i) =>
        span.type === "text" ? (
          <MessageResponse key={`t-${i}`}>{span.content}</MessageResponse>
        ) : (
          <Fragment key={`r-${i}-${span.ref.id}`}>
            <ContextRefChip refData={span.ref} />
          </Fragment>
        ),
      )}
    </>
  );
}

function ToolBlock({
  kind,
  name,
  body,
}: {
  kind: "use" | "result";
  name?: string;
  body: string;
}) {
  // Try to pretty-print JSON; fall back to raw text.
  let pretty = body;
  try {
    pretty = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    /* not JSON, leave as-is */
  }
  return (
    <Collapsible
      className={cn(
        "not-prose group/tool w-full rounded-md border text-xs",
        kind === "use"
          ? "border-border bg-muted/40"
          : "border-border bg-muted/20",
      )}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-accent/50">
        <WrenchIcon className="size-3 text-muted-foreground" />
        <span className="flex-1 truncate font-medium text-muted-foreground">
          {kind === "use" ? (name ?? "tool call") : (name ?? "result")}
        </span>
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border">
        <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/80">
          {pretty}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Copy + (future) retry actions rendered beneath an assistant message.
 * Shown on hover via group-hover so the chat stays visually quiet while
 * reading, and only reveals affordances when the user points at a reply.
 */
function CopilotMessageActions({ message }: { message: { parts: CopilotPart[] } }) {
  const [copied, setCopied] = useState(false);

  const plainText = useMemo(
    () =>
      message.parts
        .filter((p): p is Extract<CopilotPart, { type: "text" }> => p.type === "text")
        .map((p) => p.content)
        .join("\n\n")
        .trim(),
    [message.parts],
  );

  // No text to copy (e.g. assistant message is only tool calls) — hide the row.
  if (!plainText) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — silently no-op */
    }
  };

  return (
    <MessageActions className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <MessageAction
        tooltip={copied ? "Copied!" : "Copy message"}
        onClick={handleCopy}
        data-testid="copilot-message-copy"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </MessageAction>
    </MessageActions>
  );
}

const STARTER_SUGGESTIONS = [
  "List my in-progress tasks",
  "What should I focus on next?",
  "Summarize the open backlog by tag",
  "Draft a task: fix terminal scrollback bug",
];

/**
 * Sentinel value used by the model / effort Selects to represent "no
 * override, let the CLI pick its own default." Radix Select doesn't
 * allow an empty-string value on <SelectItem>, so we use a non-empty
 * marker and translate it to `null` in the onValueChange handlers.
 */
const DEFAULT_SENTINEL = "__default__";

interface SelectOption {
  value: string;
  label: string;
}

// Claude model aliases — the CLI auto-resolves these to the latest
// version (e.g. `sonnet` → `claude-sonnet-4-6`), so the selector stays
// forward-compatible without us needing to chase new model IDs.
const CLAUDE_MODEL_OPTIONS: SelectOption[] = [
  { value: DEFAULT_SENTINEL, label: "Default" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
];

// Codex models — sourced from the CLI's own `~/.codex/models_cache.json`
// catalog, filtered to `visibility: "list"`. As of codex-cli 0.118.0 the
// frontier set is gpt-5.4 / gpt-5.4-mini / gpt-5.3-codex / gpt-5.2.
// Older `gpt-5-codex` / `gpt-5` / `gpt-5.1-*` entries are hidden in the
// catalog and superseded by this list.
const CODEX_MODEL_OPTIONS: SelectOption[] = [
  { value: DEFAULT_SENTINEL, label: "Default" },
  { value: "gpt-5.4", label: "gpt-5.4" },
  { value: "gpt-5.4-mini", label: "gpt-5.4-mini" },
  { value: "gpt-5.3-codex", label: "gpt-5.3-codex" },
  { value: "gpt-5.2", label: "gpt-5.2" },
];

// Claude's `--effort` flag accepts these four levels (per `claude --help`
// on 2.1.97). Note `max` — Codex doesn't have that level.
const CLAUDE_EFFORT_OPTIONS: SelectOption[] = [
  { value: DEFAULT_SENTINEL, label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

// Codex's reasoning levels for the visible frontier models — all four
// support exactly this set (from models_cache.json). Note `xhigh`, which
// is Codex-specific and doesn't exist in Claude's vocabulary.
const CODEX_EFFORT_OPTIONS: SelectOption[] = [
  { value: DEFAULT_SENTINEL, label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
];

function modelOptionsFor(providerId: "claude-code" | "codex" | null): SelectOption[] {
  if (providerId === "codex") return CODEX_MODEL_OPTIONS;
  // Default to claude-code's list — covers both `claude-code` and null.
  return CLAUDE_MODEL_OPTIONS;
}

function effortOptionsFor(providerId: "claude-code" | "codex" | null): SelectOption[] {
  if (providerId === "codex") return CODEX_EFFORT_OPTIONS;
  return CLAUDE_EFFORT_OPTIONS;
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
}
