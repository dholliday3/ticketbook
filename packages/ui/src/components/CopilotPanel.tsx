import { useEffect, useState } from "react";
import {
  ChevronDownIcon,
  PlusIcon,
  SparkleIcon,
  Trash2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
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
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
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
  const session = useCopilotSession(true);

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

  const canSubmit =
    !session.isStarting &&
    !session.isStreaming &&
    session.sessionId !== null &&
    session.health?.status === "ready";

  const statusLabel = session.isStreaming
    ? "Streaming…"
    : session.isStarting
      ? "Starting…"
      : session.sessionId
        ? "Ready"
        : session.health?.status === "not_installed"
          ? "Claude Code not installed"
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
              {session.health?.cliVersion && !activeConversation && (
                <span className="shrink-0 text-muted-foreground/60">
                  · {session.health.cliVersion.replace(/\s*\(.*\)$/, "")}
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
                        onSelect={() => session.switchConversation(c.id)}
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
                            {formatRelative(c.updated_at)} · {c.message_count}{" "}
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
                  description="Ask me to draft a ticket, plan an epic, or read your existing tickets."
                  icon={<SparkleIcon className="size-6" />}
                />
              ) : (
                session.messages.map((msg) => (
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
                      </Message>
                    </MessageBranchContent>
                  </MessageBranch>
                ))
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
                  <PromptInputTextarea placeholder="Ask the assistant…" />
                </PromptInputBody>
                <PromptInputFooter>
                  <PromptInputTools>
                    <span className="px-1 text-xs text-muted-foreground">
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
          <MessageResponse>{part.content}</MessageResponse>
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
      // For tool_result the server stuffs the tool_use_id into toolName, so
      // we don't have a friendly name to show — just label as "Result".
      return <ToolBlock kind="result" body={part.content} />;

    case "error":
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {part.content}
        </div>
      );
  }
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
    <div
      className={cn(
        "not-prose w-full rounded-md border text-xs",
        kind === "use"
          ? "border-border bg-muted/40"
          : "border-border bg-muted/20",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
        <WrenchIcon className="size-3 text-muted-foreground" />
        <span className="font-medium text-muted-foreground">
          {kind === "use" ? (name ?? "tool call") : "result"}
        </span>
      </div>
      <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/80">
        {pretty}
      </pre>
    </div>
  );
}

const STARTER_SUGGESTIONS = [
  "List my in-progress tickets",
  "What should I focus on next?",
  "Summarize the open backlog by tag",
  "Draft a ticket: fix terminal scrollback bug",
];

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
