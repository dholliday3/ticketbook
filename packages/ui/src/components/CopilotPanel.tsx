import { useState } from "react";
import { PlusIcon, SparkleIcon, WrenchIcon, XIcon } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
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
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCopilotSession, type CopilotPart } from "@/hooks/useCopilotSession";
import { cn } from "@/lib/utils";

interface CopilotPanelProps {
  onClose: () => void;
}

/**
 * Right-rail copilot panel — talks to the headless Claude Code provider via
 * /api/copilot. Built on ai-elements for the chat shell (Conversation,
 * Message, Reasoning, PromptInput) plus a small custom Tool block since
 * ai-elements' <Tool> expects Vercel AI SDK tool-call shapes that our
 * server-side stream-json parser doesn't emit. A follow-up should pair
 * tool_use and tool_result on the server side so we can switch to the
 * canonical <Tool> component proper.
 */
export function CopilotPanel({ onClose }: CopilotPanelProps) {
  const session = useCopilotSession(true);
  const [pendingText, setPendingText] = useState("");

  const handleSubmit = async (
    message: PromptInputMessage,
  ): Promise<void> => {
    if (!message.text.trim()) return;
    setPendingText("");
    await session.sendMessage(message.text);
  };

  const inputDisabled =
    session.isStarting ||
    session.isStreaming ||
    !session.sessionId ||
    session.health?.status !== "ready";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border bg-card px-3 py-2">
          <div className="flex items-center gap-2">
            <SparkleIcon className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Assistant
            </span>
            {session.health?.cliVersion && (
              <span className="text-xs text-muted-foreground/70">
                · {session.health.cliVersion.replace(/\s*\(.*\)$/, "")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={session.reset}
              disabled={session.isStreaming || session.messages.length === 0}
              aria-label="New conversation"
              title="New conversation"
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

        {/* Conversation */}
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="gap-4 p-3">
            {session.messages.length === 0 ? (
              <ConversationEmptyState
                title="What are we building?"
                description="Ask me to draft a ticket, plan an epic, or read your existing tickets."
                icon={<SparkleIcon className="size-6" />}
              />
            ) : (
              session.messages.map((msg) => (
                <Message key={msg.id} from={msg.role}>
                  <MessageContent>
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
                  </MessageContent>
                </Message>
              ))
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* Prompt input */}
        <div className="flex-shrink-0 border-t border-border p-3">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea
                value={pendingText}
                onChange={(e) => setPendingText(e.target.value)}
                placeholder={
                  inputDisabled && session.isStreaming
                    ? "Generating…"
                    : "Ask the assistant…"
                }
                disabled={inputDisabled && !session.isStreaming}
              />
              <PromptInputFooter>
                <PromptInputTools>
                  <span className="text-xs text-muted-foreground/70">
                    {session.isStreaming
                      ? "Streaming…"
                      : session.sessionId
                        ? "Ready"
                        : session.isStarting
                          ? "Starting…"
                          : "Not connected"}
                  </span>
                  <PromptInputSubmit
                    status={session.isStreaming ? "streaming" : undefined}
                    disabled={!pendingText.trim() || inputDisabled}
                  />
                </PromptInputTools>
              </PromptInputFooter>
            </PromptInputBody>
          </PromptInput>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ─── Part renderers ────────────────────────────────────────────────

function CopilotPartView({
  part,
  isStreaming,
}: {
  part: CopilotPart;
  isStreaming: boolean;
}) {
  switch (part.type) {
    case "text":
      return <MessageResponse>{part.content}</MessageResponse>;

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
        "not-prose rounded-md border text-xs",
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
