import { useState, useEffect, useRef, useCallback } from "react";
import {
  CaretDownIcon,
  ChatCircleTextIcon,
  CheckIcon,
  CopyIcon,
  SparkleIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { renderContextRefMarker } from "@ticketbook/core/context-refs";
import { patchTask, patchTaskBody } from "../api";
import type { Task, Status, Priority, Meta } from "../types";
import { useAppContext } from "../context/AppContext";
import { TiptapEditor } from "./TiptapEditor";
import { SelectChip, ComboboxChip, MultiComboboxChip, KebabMenu } from "./MetaFields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "backlog", label: "Backlog" },
  { value: "open", label: "Open" },
  { value: "in-progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

interface TaskDetailProps {
  task: Task;
  meta: Meta;
  onUpdated: () => void;
  onDelete?: (id: string) => void;
  /**
   * Called when a hand-off button (Add / Review) wants its containing
   * surface to close — set by the route when TaskDetail is rendered
   * inside a modal Dialog, so clicking those buttons drops the modal
   * and hands focus to the copilot editor. Leave undefined in the
   * inline list-view case to keep the detail in place.
   */
  onRequestClose?: () => void;
}

export function TaskDetail({ task, meta, onUpdated, onDelete, onRequestClose }: TaskDetailProps) {
  const { insertIntoCopilotInput } = useAppContext();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync drafts when task changes externally
  useEffect(() => {
    setTitleDraft(task.title);
    setEditingTitle(false);
  }, [task.id, task.title]);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  // Reset save status when switching tasks
  useEffect(() => {
    setSaveStatus("idle");
    setCopyStatus("idle");
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, [task.id]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const saveField = useCallback(
    async (patch: Parameters<typeof patchTask>[1]) => {
      try {
        await patchTask(task.id, patch);
        onUpdated();
      } catch (err) {
        console.error("Failed to save:", err);
      }
    },
    [task.id, onUpdated],
  );

  const handleTitleSave = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== task.title) {
      saveField({ title: trimmed });
    } else {
      setTitleDraft(task.title);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTitleSave();
    } else if (e.key === "Escape") {
      setTitleDraft(task.title);
      setEditingTitle(false);
    }
  };

  const handleBodyChange = useCallback(
    (markdown: string) => {
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      setSaveStatus("saving");
      bodyTimerRef.current = setTimeout(async () => {
        try {
          await patchTaskBody(task.id, markdown);
          onUpdated();
          setSaveStatus("saved");
          savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
        } catch (err) {
          console.error("Failed to save body:", err);
          setSaveStatus("idle");
        }
      }, 500);
    },
    [task.id, onUpdated],
  );

  const handleCopyTaskLabel = useCallback(async () => {
    try {
      await copyToClipboard(`${task.id} ${task.title}`);
      setCopyStatus("copied");
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopyStatus("idle"), 2000);
    } catch (err) {
      console.error("Failed to copy task label:", err);
      setCopyStatus("idle");
    }
  }, [task.id, task.title]);

  const handleAddToChat = useCallback(() => {
    const marker = renderContextRefMarker({
      kind: "task",
      id: task.id,
      title: task.title,
    });
    insertIntoCopilotInput(marker);
    onRequestClose?.();
  }, [task.id, task.title, insertIntoCopilotInput, onRequestClose]);

  const handleGetFeedback = useCallback(() => {
    const marker = renderContextRefMarker({
      kind: "task",
      id: task.id,
      title: task.title,
    });
    insertIntoCopilotInput(
      `Please review ${marker} and give me feedback on scope, approach, and any gaps.`,
    );
    onRequestClose?.();
  }, [task.id, task.title, insertIntoCopilotInput, onRequestClose]);

  return (
    <div className="flex max-w-[800px] flex-col gap-4">
      {/* Task ID + save indicator + delete button */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
        <div className="ml-auto flex items-center gap-2">
          {saveStatus !== "idle" && (
            <span
              className={cn(
                "text-[11px] transition-opacity",
                saveStatus === "saving" && "text-muted-foreground",
                saveStatus === "saved" && "text-emerald-400",
              )}
            >
              {saveStatus === "saving" ? "Saving..." : "Saved"}
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAddToChat}
                aria-label="Add to copilot chat"
              >
                <ChatCircleTextIcon />
                Add
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attach this task to the copilot chat</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGetFeedback}
                aria-label="Review this task"
              >
                <SparkleIcon />
                Review
              </Button>
            </TooltipTrigger>
            <TooltipContent>Ask the copilot to review this task</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={copyStatus === "copied" ? "secondary" : "outline"}
                size="sm"
                onClick={handleCopyTaskLabel}
                aria-label={`Copy ${task.id} and title`}
              >
                {copyStatus === "copied" ? <CheckIcon /> : <CopyIcon />}
                {copyStatus === "copied" ? "Copied" : "Copy"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy task ID and title to clipboard</TooltipContent>
          </Tooltip>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onDelete(task.id)}
              className="text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
              aria-label="Delete task"
            >
              <TrashIcon />
            </Button>
          )}
        </div>
      </div>

      {/* Inline editable title */}
      {editingTitle ? (
        <input
          ref={titleInputRef}
          className="w-full border-0 border-b border-primary bg-transparent py-0.5 font-sans text-2xl font-bold leading-tight text-foreground outline-none"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={handleTitleSave}
          onKeyDown={handleTitleKeyDown}
        />
      ) : (
        <h1
          className="cursor-text border-b border-transparent py-0.5 text-2xl font-bold leading-tight transition-colors hover:border-border"
          onClick={() => setEditingTitle(true)}
          title="Click to edit"
        >
          {task.title}
        </h1>
      )}

      {/* Body editor */}
      <TiptapEditor
        content={splitAgentNotes(task.body).userContent}
        onUpdate={(md) => {
          const { agentNotes } = splitAgentNotes(task.body);
          handleBodyChange(mergeAgentNotes(md, agentNotes));
        }}
        taskId={task.id}
      />

      {/* Metadata row */}
      <div className="flex flex-wrap gap-2">
        <SelectChip
          value={task.status}
          options={STATUS_OPTIONS}
          onChange={(v) => saveField({ status: v as Status })}
        />
        <SelectChip
          value={task.priority ?? ""}
          options={PRIORITY_OPTIONS}
          placeholder="Priority"
          onChange={(v) => saveField({ priority: v ? (v as Priority) : null })}
        />
        <MultiComboboxChip
          values={task.tags ?? []}
          options={meta.tags}
          placeholder="Tags"
          onChange={(tags) => saveField({ tags })}
        />
        <KebabMenu
          items={[
            {
              label: "Project",
              content: (
                <ComboboxChip
                  value={task.project ?? ""}
                  options={meta.projects}
                  placeholder="None"
                  onChange={(v) => saveField({ project: v || null })}
                />
              ),
            },
            {
              label: "Epic",
              content: (
                <ComboboxChip
                  value={task.epic ?? ""}
                  options={meta.epics}
                  placeholder="None"
                  onChange={(v) => saveField({ epic: v || null })}
                />
              ),
            },
            {
              label: "Sprint",
              content: (
                <ComboboxChip
                  value={task.sprint ?? ""}
                  options={meta.sprints}
                  placeholder="None"
                  onChange={(v) => saveField({ sprint: v || null })}
                />
              ),
            },
            {
              label: "Assignee",
              content: (
                <Input
                  value={task.assignee ?? ""}
                  onChange={(e) => saveField({ assignee: e.target.value || null })}
                  placeholder="Unassigned"
                />
              ),
            },
            {
              label: "Blocked by",
              content: (
                <TaskLinkChips
                  links={task.blockedBy ?? []}
                  onChange={(ids) => saveField({ blockedBy: ids })}
                />
              ),
            },
            {
              label: "Related to",
              content: (
                <TaskLinkChips
                  links={task.relatedTo ?? []}
                  onChange={(ids) => saveField({ relatedTo: ids })}
                />
              ),
            },
          ]}
        />
      </div>

      {/* Refs (commits/PRs) */}
      {task.refs && task.refs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pb-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Refs
          </span>
          {task.refs.map((ref) => (
            <Badge key={ref} variant="secondary" className="font-normal">
              {ref.startsWith("http") ? (
                <a
                  href={ref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary no-underline hover:underline"
                >
                  {ref.replace(/.*\//, "")}
                </a>
              ) : (
                <code className="font-mono text-[11px]">{ref.slice(0, 8)}</code>
              )}
            </Badge>
          ))}
        </div>
      )}

      {/* Agent notes (collapsible) */}
      <AgentNotesSection
        notes={splitAgentNotes(task.body).agentNotes}
        onUpdate={(notes) => {
          const { userContent } = splitAgentNotes(task.body);
          handleBodyChange(mergeAgentNotes(userContent, notes));
        }}
      />
    </div>
  );
}

async function copyToClipboard(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  const didCopy = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!didCopy) {
    throw new Error("Clipboard API unavailable");
  }
}

const AGENT_NOTES_MARKER = "<!-- agent-notes -->";

function splitAgentNotes(body: string): { userContent: string; agentNotes: string } {
  const idx = body.indexOf(AGENT_NOTES_MARKER);
  if (idx === -1) return { userContent: body, agentNotes: "" };
  return {
    userContent: body.slice(0, idx).trimEnd(),
    agentNotes: body.slice(idx + AGENT_NOTES_MARKER.length).trimStart(),
  };
}

function mergeAgentNotes(userContent: string, agentNotes: string): string {
  if (!agentNotes.trim()) return userContent;
  return `${userContent}\n\n${AGENT_NOTES_MARKER}\n\n${agentNotes}`;
}

function AgentNotesSection({
  notes,
  onUpdate,
}: {
  notes: string;
  onUpdate: (notes: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="mt-4 border-t border-border pt-2"
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
        <CaretDownIcon
          className={cn(
            "size-2.5 transition-transform",
            !open && "-rotate-90",
          )}
        />
        Agent Notes
        {notes && (
          <Badge variant="secondary" className="ml-1 font-normal normal-case tracking-normal">
            Has notes
          </Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Textarea
          value={notes}
          onChange={(e) => onUpdate(e.target.value)}
          placeholder="Agent research, debrief, and notes..."
          rows={6}
          className="mt-1.5 min-h-20 font-mono text-xs leading-relaxed"
        />
      </CollapsibleContent>
    </Collapsible>
  );
}


function TaskLinkChips({
  links,
  onChange,
}: {
  links: string[];
  onChange: (ids: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const id = input.trim().toUpperCase();
      if (id && !links.includes(id)) {
        onChange([...links, id]);
      }
      setInput("");
    } else if (e.key === "Backspace" && !input && links.length > 0) {
      onChange(links.slice(0, -1));
    }
  };

  return (
    <div className="flex min-w-[120px] flex-wrap items-center gap-1 rounded-md border border-border bg-input/30 px-1 py-0.5 transition-colors focus-within:border-primary">
      {links.map((id) => (
        <Badge key={id} variant="secondary" className="gap-0.5 pr-0.5 font-mono">
          {id}
          <span
            role="button"
            tabIndex={-1}
            aria-label={`Remove link ${id}`}
            className="ml-0.5 inline-flex size-3 cursor-pointer items-center justify-center rounded-sm hover:bg-foreground/10"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange(links.filter((l) => l !== id));
            }}
          >
            <XIcon className="size-2.5" />
          </span>
        </Badge>
      ))}
      <input
        className="min-w-[60px] flex-1 border-0 bg-transparent px-0 py-0.5 text-xs text-foreground outline-none"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={links.length === 0 ? "Add task ID..." : ""}
      />
    </div>
  );
}
