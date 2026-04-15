import { useState, useEffect, useRef, useCallback } from "react";
import {
  BrainIcon,
  ChatCircleTextIcon,
  ScissorsIcon,
  SparkleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { renderContextRefMarker } from "@ticketbook/core/context-refs";
import { patchPlan, patchPlanBody } from "../api";
import type { Plan, PlanStatus, PlanMeta } from "../types";
import { useAppContext } from "../context/AppContext";
import { TiptapEditor } from "./TiptapEditor";
import { SelectChip, ComboboxChip, MultiComboboxChip } from "./MetaFields";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

interface PlanDetailProps {
  plan: Plan;
  planMeta: PlanMeta;
  onUpdated: () => void;
  onDelete?: (id: string) => void;
  onTaskClick?: (taskId: string) => void;
  onTasksCreated?: () => void;
  /**
   * Called when a hand-off button (Add / Brainstorm / Review) wants
   * its containing surface to close — set by the route when PlanDetail
   * is rendered inside a modal Dialog, so clicking those buttons drops
   * the modal and hands focus to the copilot editor. Leave undefined
   * in the inline list-view case to keep the detail in place.
   */
  onRequestClose?: () => void;
}

export function PlanDetail({ plan, planMeta, onUpdated, onDelete, onTaskClick, onTasksCreated, onRequestClose }: PlanDetailProps) {
  const { insertIntoCopilotInput } = useAppContext();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(plan.title);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitleDraft(plan.title);
    setEditingTitle(false);
  }, [plan.id, plan.title]);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    setSaveStatus("idle");
  }, [plan.id]);

  useEffect(() => {
    return () => {
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const saveField = useCallback(
    async (patch: Parameters<typeof patchPlan>[1]) => {
      try {
        await patchPlan(plan.id, patch);
        onUpdated();
      } catch (err) {
        console.error("Failed to save:", err);
      }
    },
    [plan.id, onUpdated],
  );

  const handleTitleSave = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== plan.title) {
      saveField({ title: trimmed });
    } else {
      setTitleDraft(plan.title);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTitleSave();
    } else if (e.key === "Escape") {
      setTitleDraft(plan.title);
      setEditingTitle(false);
    }
  };

  const handleCutTasks = useCallback(() => {
    const marker = renderContextRefMarker({
      kind: "plan",
      id: plan.id,
      title: plan.title,
    });
    insertIntoCopilotInput(
      `Please break down ${marker} into well-sequenced tasks. Create a task for each discrete unit of work, set appropriate priorities and ordering, and link them all back to this plan.`,
    );
    onRequestClose?.();
  }, [plan.id, plan.title, insertIntoCopilotInput, onRequestClose]);

  const handleAddToChat = useCallback(() => {
    const marker = renderContextRefMarker({
      kind: "plan",
      id: plan.id,
      title: plan.title,
    });
    insertIntoCopilotInput(marker);
    onRequestClose?.();
  }, [plan.id, plan.title, insertIntoCopilotInput, onRequestClose]);

  const handleGetFeedback = useCallback(() => {
    const marker = renderContextRefMarker({
      kind: "plan",
      id: plan.id,
      title: plan.title,
    });
    insertIntoCopilotInput(
      `Please review ${marker} and give me feedback on scope, approach, and any gaps.`,
    );
    onRequestClose?.();
  }, [plan.id, plan.title, insertIntoCopilotInput, onRequestClose]);

  const handleBrainstorm = useCallback(() => {
    const marker = renderContextRefMarker({
      kind: "plan",
      id: plan.id,
      title: plan.title,
    });
    insertIntoCopilotInput(
      `Let's brainstorm ${marker}. Walk me through your thinking and help me refine it.`,
    );
    onRequestClose?.();
  }, [plan.id, plan.title, insertIntoCopilotInput, onRequestClose]);

  const handleBodyChange = useCallback(
    (newBody: string) => {
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      setSaveStatus("saving");

      bodyTimerRef.current = setTimeout(async () => {
        try {
          await patchPlanBody(plan.id, newBody);
          onUpdated();
          setSaveStatus("saved");
          savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
        } catch (err) {
          console.error("Failed to save body:", err);
          setSaveStatus("idle");
        }
      }, 500);
    },
    [plan.id, onUpdated],
  );

  return (
    <div className="flex max-w-[800px] flex-col gap-4">
      {/* Plan ID + save indicator + action buttons */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">{plan.id}</span>
        {saveStatus !== "idle" && (
          <span
            className={cn(
              "ml-2 text-[11px] transition-opacity",
              saveStatus === "saving" && "text-muted-foreground",
              saveStatus === "saved" && "text-emerald-400",
            )}
          >
            {saveStatus === "saving" ? "Saving..." : "Saved"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
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
            <TooltipContent>Attach this plan to the copilot chat</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBrainstorm}
                aria-label="Brainstorm this plan with the agent"
              >
                <BrainIcon />
                Brainstorm
              </Button>
            </TooltipTrigger>
            <TooltipContent>Brainstorm this plan with the copilot</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGetFeedback}
                aria-label="Review this plan"
              >
                <SparkleIcon />
                Review
              </Button>
            </TooltipTrigger>
            <TooltipContent>Ask the copilot to review this plan</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCutTasks}
                aria-label="Cut tasks from this plan"
              >
                <ScissorsIcon />
                Cut Tasks
              </Button>
            </TooltipTrigger>
            <TooltipContent>Break this plan into tasks with the copilot</TooltipContent>
          </Tooltip>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onDelete(plan.id)}
              className="text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
              aria-label="Delete plan"
            >
              <TrashIcon />
            </Button>
          )}
        </div>
      </div>

      {/* Inline editable title — same pattern as TaskDetail */}
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
          {plan.title}
        </h1>
      )}

      {/* Tiptap editor */}
      <TiptapEditor
        taskId={plan.id}
        content={plan.body}
        onUpdate={handleBodyChange}
      />

      {/* Metadata row — same pattern as TaskDetail */}
      <div className="flex flex-wrap gap-2">
        <SelectChip
          value={plan.status}
          options={STATUS_OPTIONS}
          onChange={(v) => saveField({ status: v as PlanStatus })}
        />
        <MultiComboboxChip
          values={plan.tags ?? []}
          options={planMeta.tags}
          placeholder="Tags"
          onChange={(tags) => saveField({ tags })}
        />
        <ComboboxChip
          value={plan.project ?? ""}
          options={planMeta.projects}
          placeholder="Project"
          onChange={(v) => saveField({ project: v || null })}
        />
      </div>

      {plan.tasks && plan.tasks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-6 py-2">
          <span className="text-xs text-muted-foreground">Linked tasks:</span>
          {plan.tasks.map((tid) => (
            <Button
              key={tid}
              variant="outline"
              size="sm"
              className="h-auto px-2 py-0.5 font-mono text-[11px] text-primary"
              onClick={() => onTaskClick?.(tid)}
            >
              {tid}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
