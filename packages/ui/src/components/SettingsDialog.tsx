import { useState } from "react";
import type { TicketbookConfig, DebriefStyle } from "../types";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const debriefStyles: DebriefStyle[] = ["very-concise", "concise", "detailed", "lengthy"];

function debriefLabel(style: DebriefStyle): string {
  if (style === "very-concise") return "Very concise";
  return style.charAt(0).toUpperCase() + style.slice(1);
}

export function SettingsDialog({
  config,
  onSave,
  onClose,
}: {
  config: TicketbookConfig;
  onSave: (patch: Partial<TicketbookConfig>) => Promise<void>;
  onClose: () => void;
}) {
  const [prefix, setPrefix] = useState(config.prefix);
  const [deleteMode, setDeleteMode] = useState(config.deleteMode);
  const [debriefStyle, setDebriefStyle] = useState<DebriefStyle>(config.debriefStyle ?? "very-concise");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ prefix, deleteMode, debriefStyle });
    } catch (err) {
      console.error("Failed to save settings:", err);
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="settings-prefix" className="text-xs font-medium text-foreground">
              Task ID prefix
            </label>
            <Input
              id="settings-prefix"
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="e.g. TASK, ART"
            />
            <span className="text-[11px] text-muted-foreground">
            New tasks will be created as {prefix || "TASK"}-001, {prefix || "TASK"}-002, etc.
          </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground">Delete behavior</label>
            <ButtonGroup className="w-full">
              <Button
                variant={deleteMode === "archive" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setDeleteMode("archive")}
                aria-pressed={deleteMode === "archive"}
              >
                Archive
              </Button>
              <Button
                variant={deleteMode === "hard" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setDeleteMode("hard")}
                aria-pressed={deleteMode === "hard"}
              >
                Hard delete
              </Button>
            </ButtonGroup>
            <span className="text-[11px] text-muted-foreground">
              {deleteMode === "archive"
                ? "Deleted tasks are moved to an archive and can be restored."
                : "Deleted tasks are permanently removed from disk."}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground">Agent debrief style</label>
            <ButtonGroup className="w-full">
              {debriefStyles.map((style) => (
                <Button
                  key={style}
                  variant={debriefStyle === style ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setDebriefStyle(style)}
                  aria-pressed={debriefStyle === style}
                >
                  {debriefLabel(style)}
                </Button>
              ))}
            </ButtonGroup>
            <span className="text-[11px] text-muted-foreground">
              Controls how detailed agent debriefs are when writing to agent notes.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
