import type { RelayConfig } from "../types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function DeleteConfirmDialog({
  itemTitle,
  itemType,
  config,
  onConfirm,
  onCancel,
}: {
  itemTitle: string;
  itemType: "task" | "plan" | "doc";
  config: RelayConfig;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isHard = config.deleteMode === "hard";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isHard ? "Delete" : "Archive"} {itemType}?
          </DialogTitle>
          <DialogDescription>
            {isHard
              ? `"${itemTitle}" will be permanently deleted. This cannot be undone.`
              : `"${itemTitle}" will be moved to the archive and can be restored later.`}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={isHard ? "destructive" : "default"}
            onClick={onConfirm}
          >
            {isHard ? "Delete" : "Archive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
