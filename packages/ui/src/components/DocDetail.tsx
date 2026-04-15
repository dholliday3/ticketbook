import { useState, useEffect, useRef, useCallback } from "react";
import { ChatCircleTextIcon, TrashIcon } from "@phosphor-icons/react";
import { renderContextRefMarker } from "@relay/core/context-refs";
import { patchDoc, patchDocBody } from "../api";
import { useAppContext } from "../context/AppContext";
import type { Doc, DocMeta } from "../types";
import { TiptapEditor } from "./TiptapEditor";
import { ComboboxChip, MultiComboboxChip } from "./MetaFields";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function DocDetail({
  doc,
  docMeta,
  onUpdated,
  onDelete,
}: {
  doc: Doc;
  docMeta: DocMeta;
  onUpdated: () => void;
  onDelete?: (id: string) => void;
}) {
  const { insertIntoCopilotInput } = useAppContext();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(doc.title);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const titleInputRef = useRef<HTMLInputElement>(null);
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitleDraft(doc.title);
    setEditingTitle(false);
  }, [doc.id, doc.title]);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    setSaveStatus("idle");
  }, [doc.id]);

  useEffect(() => {
    return () => {
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const saveField = useCallback(
    async (patch: Parameters<typeof patchDoc>[1]) => {
      try {
        await patchDoc(doc.id, patch);
        onUpdated();
      } catch (err) {
        console.error("Failed to save doc:", err);
      }
    },
    [doc.id, onUpdated],
  );

  const handleTitleSave = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== doc.title) {
      saveField({ title: trimmed });
    } else {
      setTitleDraft(doc.title);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTitleSave();
    } else if (e.key === "Escape") {
      setTitleDraft(doc.title);
      setEditingTitle(false);
    }
  };

  const handleBodyChange = useCallback(
    (newBody: string) => {
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      setSaveStatus("saving");

      bodyTimerRef.current = setTimeout(async () => {
        try {
          await patchDocBody(doc.id, newBody);
          onUpdated();
          setSaveStatus("saved");
          savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
        } catch (err) {
          console.error("Failed to save doc body:", err);
          setSaveStatus("idle");
        }
      }, 500);
    },
    [doc.id, onUpdated],
  );

  const handleAddToChat = useCallback(() => {
    const marker = renderContextRefMarker({
      kind: "doc",
      id: doc.id,
      title: doc.title,
    });
    insertIntoCopilotInput(marker);
  }, [doc.id, doc.title, insertIntoCopilotInput]);

  return (
    <div className="flex max-w-[800px] flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{doc.id}</span>
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
            <TooltipContent>Attach this doc to the copilot chat</TooltipContent>
          </Tooltip>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onDelete(doc.id)}
              className="text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
              aria-label="Delete doc"
            >
              <TrashIcon />
            </Button>
          )}
        </div>
      </div>

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
          {doc.title}
        </h1>
      )}

      <TiptapEditor taskId={doc.id} content={doc.body} onUpdate={handleBodyChange} />

      <div className="flex flex-wrap gap-2">
        <MultiComboboxChip
          values={doc.tags ?? []}
          options={docMeta.tags}
          placeholder="Tags"
          onChange={(tags) => saveField({ tags })}
        />
        <ComboboxChip
          value={doc.project ?? ""}
          options={docMeta.projects}
          placeholder="Project"
          onChange={(value) => saveField({ project: value || null })}
        />
      </div>
    </div>
  );
}
