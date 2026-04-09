import { useMemo } from "react";
import { FileTextIcon, ListChecksIcon, ExternalLinkIcon } from "lucide-react";
import type { ContextRef } from "@ticketbook/core/context-refs";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppContext } from "@/context/AppContext";
import { cn } from "@/lib/utils";
import type { Task, Plan } from "@/types";

interface ContextRefChipProps {
  refData: ContextRef;
}

/**
 * Inline pill rendered in place of a `<task />` / `<plan />` marker in
 * copilot messages. On hover, surfaces a preview of the current
 * primitive (status, priority, tags, body excerpt) and an "Open" button
 * that navigates to the detail view. Lookups use the in-memory
 * tasks/plans lists from AppContext — no refetch, no stale state.
 */
export function ContextRefChip({ refData }: ContextRefChipProps) {
  const { tasks, plans, handleSelect, handleSelectPlan } = useAppContext();

  const primitive = useMemo<Task | Plan | null>(() => {
    if (refData.kind === "task") {
      return tasks.find((t) => t.id === refData.id) ?? null;
    }
    return plans.find((p) => p.id === refData.id) ?? null;
  }, [refData, tasks, plans]);

  const deleted = primitive === null;
  const displayTitle =
    (primitive?.title ?? refData.title ?? "(untitled)").trim() || "(untitled)";

  const handleOpen = () => {
    if (!primitive) return;
    if (refData.kind === "task") {
      handleSelect(primitive as Task);
    } else {
      handleSelectPlan(primitive as Plan);
    }
  };

  const Icon = refData.kind === "task" ? FileTextIcon : ListChecksIcon;
  const kindLabel = refData.kind === "task" ? "Task" : "Plan";

  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={handleOpen}
          disabled={deleted}
          className={cn(
            "mx-0.5 inline-flex max-w-[22ch] items-baseline gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0 align-baseline text-xs font-normal text-foreground transition-colors",
            !deleted && "hover:border-primary/40 hover:bg-muted cursor-pointer",
            deleted && "cursor-default border-dashed text-muted-foreground line-through",
          )}
          aria-label={`${kindLabel} ${refData.id}: ${displayTitle}${deleted ? " (deleted)" : ""}`}
        >
          <Icon className="size-3 shrink-0 self-center" aria-hidden />
          <span className="font-mono text-[10px] text-muted-foreground">
            {refData.id}
          </span>
          <span className="truncate">{displayTitle}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-80">
        {deleted ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Icon className="size-3.5" />
              <span className="font-mono text-[10px]">{refData.id}</span>
              <span className="text-[10px] uppercase tracking-wide">
                {kindLabel} deleted
              </span>
            </div>
            {refData.title && (
              <div className="text-sm text-foreground/70 line-through">
                {refData.title}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              This {refData.kind} no longer exists.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Icon className="size-3.5 text-muted-foreground" />
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {primitive.id}
                  </span>
                </div>
                <div className="mt-0.5 text-sm font-semibold leading-tight">
                  {primitive.title}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                onClick={handleOpen}
              >
                <ExternalLinkIcon className="size-3" />
                Open
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {"status" in primitive && primitive.status && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {primitive.status}
                </Badge>
              )}
              {"priority" in primitive && primitive.priority && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {primitive.priority}
                </Badge>
              )}
              {primitive.tags?.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="h-5 px-1.5 text-[10px] text-muted-foreground"
                >
                  {tag}
                </Badge>
              ))}
            </div>
            {primitive.body && (
              <div className="max-h-24 overflow-hidden text-[11px] leading-relaxed text-muted-foreground">
                {excerpt(primitive.body, 220)}
              </div>
            )}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

function excerpt(body: string, max: number): string {
  const trimmed = body
    .replace(/^---[\s\S]*?---\s*/m, "") // drop any leading frontmatter
    .replace(/\s+/g, " ")
    .trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + "…";
}
