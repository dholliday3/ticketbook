/**
 * Shared hover-card preview for a task/plan/doc context reference.
 *
 * Both the in-input chip (ContextRefNode's NodeView) and the
 * message-bubble chip (ContextRefChip) wrap their trigger in
 * `<ContextRefHoverCard>` so they render the same primitive preview
 * with the same "Open" link — keeping the two surfaces in sync.
 */

import { useCallback, useMemo, type ReactNode } from "react";
import {
  BookOpenIcon,
  ExternalLinkIcon,
  FileTextIcon,
  ListChecksIcon,
} from "lucide-react";
import type { ContextRefKind } from "@relay/core/context-refs";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppContext } from "@/context/AppContext";
import type { Doc, Plan, Task } from "@/types";

export interface UseContextRefLookup {
  primitive: Task | Plan | Doc | null;
  deleted: boolean;
  handleOpen: () => void;
}

/**
 * Resolve a context ref to its current primitive record via in-memory
 * AppContext lookup, and give the caller a ready-made `handleOpen`
 * that navigates to the detail view. Used by both the in-input chip
 * and the message-bubble chip.
 */
export function useContextRefLookup(
  kind: ContextRefKind,
  id: string,
): UseContextRefLookup {
  const {
    tasks,
    plans,
    docs,
    handleSelect,
    handleSelectPlan,
    handleSelectDoc,
  } = useAppContext();

  const primitive = useMemo<Task | Plan | Doc | null>(() => {
    if (kind === "task") return tasks.find((t) => t.id === id) ?? null;
    if (kind === "plan") return plans.find((p) => p.id === id) ?? null;
    return docs.find((d) => d.id === id) ?? null;
  }, [kind, id, tasks, plans, docs]);

  const handleOpen = useCallback(() => {
    if (!primitive) return;
    if (kind === "task") handleSelect(primitive as Task);
    else if (kind === "plan") handleSelectPlan(primitive as Plan);
    else handleSelectDoc(primitive as Doc);
  }, [primitive, kind, handleSelect, handleSelectPlan, handleSelectDoc]);

  return { primitive, deleted: primitive === null, handleOpen };
}

interface ContextRefHoverCardProps {
  kind: ContextRefKind;
  id: string;
  /** Title snapshot from the marker, used as fallback when the primitive is deleted. */
  titleFallback: string | null;
  /** The chip or button that acts as the hover trigger. Must be a single element (asChild). */
  children: ReactNode;
}

/**
 * Wrap any trigger element in a HoverCard that previews the current
 * state of the referenced primitive on hover, with an "Open" button
 * that navigates to the detail view.
 */
export function ContextRefHoverCard({
  kind,
  id,
  titleFallback,
  children,
}: ContextRefHoverCardProps) {
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-80">
        <ContextRefHoverCardPreview
          kind={kind}
          id={id}
          titleFallback={titleFallback}
        />
      </HoverCardContent>
    </HoverCard>
  );
}

function ContextRefHoverCardPreview({
  kind,
  id,
  titleFallback,
}: {
  kind: ContextRefKind;
  id: string;
  titleFallback: string | null;
}) {
  const { primitive, handleOpen } = useContextRefLookup(kind, id);
  const Icon =
    kind === "task" ? FileTextIcon : kind === "plan" ? ListChecksIcon : BookOpenIcon;
  const kindLabel =
    kind === "task" ? "Task" : kind === "plan" ? "Plan" : "Doc";

  if (primitive === null) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="size-3.5" />
          <span className="font-mono text-[10px]">{id}</span>
          <span className="text-[10px] uppercase tracking-wide">
            {kindLabel} deleted
          </span>
        </div>
        {titleFallback && (
          <div className="text-sm text-foreground/70 line-through">
            {titleFallback}
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          This {kind} no longer exists.
        </div>
      </div>
    );
  }

  return (
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
