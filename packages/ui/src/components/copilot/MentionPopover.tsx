import { BookOpenIcon, FileTextIcon, ListChecksIcon } from "lucide-react";
import type { ContextRefKind } from "@relay/core/context-refs";
import { cn } from "@/lib/utils";

export interface MentionItem {
  kind: ContextRefKind;
  id: string;
  title: string;
}

interface MentionPopoverProps {
  items: MentionItem[];
  activeIndex: number;
  category: ContextRefKind | null;
  query: string;
  onSelect: (item: MentionItem) => void;
  onHover: (index: number) => void;
}

/**
 * Presentational dropdown for the copilot input @-mention popover.
 * Positioned by its wrapping container (floats above the PromptInput).
 * Keyboard navigation and open/close state lives in the parent.
 */
export function MentionPopover({
  items,
  activeIndex,
  category,
  query,
  onSelect,
  onHover,
}: MentionPopoverProps) {
  return (
    <div
      role="listbox"
      aria-label="Context reference search"
      className="max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>
          {category === "task"
            ? "Tasks"
            : category === "plan"
              ? "Plans"
              : category === "doc"
                ? "Docs"
                : "Tasks, plans, and docs"}
          {query && <span className="normal-case tracking-normal"> · {query}</span>}
        </span>
        <span className="text-muted-foreground/60">↑↓ ↵ esc</span>
      </div>
      {items.length === 0 ? (
        <div className="px-2 py-3 text-center text-xs text-muted-foreground">
          No matches
        </div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((item, i) => {
            const Icon =
              item.kind === "task"
                ? FileTextIcon
                : item.kind === "plan"
                  ? ListChecksIcon
                  : BookOpenIcon;
            const isActive = i === activeIndex;
            return (
              <li key={`${item.kind}:${item.id}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => onHover(i)}
                  onMouseDown={(e) => {
                    // Prevent textarea blur before click lands.
                    e.preventDefault();
                    onSelect(item);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/60",
                  )}
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {item.id}
                  </span>
                  <span className="truncate">{item.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
