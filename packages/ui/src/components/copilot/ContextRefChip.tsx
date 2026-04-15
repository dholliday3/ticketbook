import { BookOpenIcon, FileTextIcon, ListChecksIcon } from "lucide-react";
import type { ContextRef } from "@relay/core/context-refs";
import { cn } from "@/lib/utils";
import {
  ContextRefHoverCard,
  useContextRefLookup,
} from "./ContextRefHoverCard";

interface ContextRefChipProps {
  refData: ContextRef;
}

/**
 * Inline pill rendered in place of a primitive marker in
 * rendered copilot messages. Compact single-line chip (icon + ID +
 * truncated title), click navigates to the detail view, hover shows a
 * preview card via the shared ContextRefHoverCard.
 *
 * Shares its look with the in-input chip rendered by ContextRefNode's
 * NodeView — both go through ContextRefHoverCard for the preview, and
 * the chip markup here is the same single-line design. The only
 * difference: this variant is a clickable button (it lives inside a
 * rendered message bubble, not a contenteditable).
 */
export function ContextRefChip({ refData }: ContextRefChipProps) {
  const { primitive, deleted, handleOpen } = useContextRefLookup(
    refData.kind,
    refData.id,
  );

  const Icon =
    refData.kind === "task"
      ? FileTextIcon
      : refData.kind === "plan"
        ? ListChecksIcon
        : BookOpenIcon;
  const kindLabel =
    refData.kind === "task"
      ? "Task"
      : refData.kind === "plan"
        ? "Plan"
        : "Doc";
  const displayTitle =
    (primitive?.title ?? refData.title ?? "").trim() || "(untitled)";

  return (
    <ContextRefHoverCard
      kind={refData.kind}
      id={refData.id}
      titleFallback={refData.title}
    >
      <button
        type="button"
        onClick={handleOpen}
        disabled={deleted}
        aria-label={`${kindLabel} ${refData.id}: ${displayTitle}${deleted ? " (deleted)" : ""}`}
        className={cn(
          "mx-0.5 inline-flex max-w-[28ch] items-center gap-1 rounded-md border px-1.5 py-0.5 align-middle font-mono text-[11px] leading-none transition-colors",
          deleted
            ? "cursor-default border-dashed border-border bg-muted text-muted-foreground line-through"
            : "cursor-pointer border-border bg-secondary text-secondary-foreground hover:bg-accent",
        )}
      >
        <Icon
          className={cn(
            "size-3 shrink-0",
            deleted ? "text-muted-foreground" : "text-primary",
          )}
          aria-hidden
        />
        <span className="shrink-0 text-muted-foreground">{refData.id}</span>
        <span className="min-w-0 truncate">{displayTitle}</span>
      </button>
    </ContextRefHoverCard>
  );
}
