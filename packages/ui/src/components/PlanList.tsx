import { useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import type { Plan, PlanStatus } from "../types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_ORDER: { key: PlanStatus; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "draft", label: "Draft" },
  { key: "completed", label: "Completed" },
  { key: "archived", label: "Archived" },
];

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return `${Math.floor(diffMonth / 12)}y ago`;
}

interface PlanListProps {
  plans: Plan[];
  activePlanId: string | null;
  onSelect: (plan: Plan) => void;
}

export function PlanList({ plans, activePlanId, onSelect }: PlanListProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    completed: true,
    archived: true,
  });

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const sortedGroups = new Map<PlanStatus, Plan[]>();
  for (const { key } of STATUS_ORDER) {
    const group = plans
      .filter((p) => p.status === key)
      .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
    sortedGroups.set(key, group);
  }

  return (
    <div className="flex flex-col">
      {STATUS_ORDER.map(({ key, label }) => {
        const group = sortedGroups.get(key) ?? [];
        const isCollapsed = collapsed[key];

        return (
          <div key={key}>
            <div className="flex items-center">
              <button
                className="flex flex-1 items-center gap-1.5 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => toggleGroup(key)}
                aria-expanded={!isCollapsed}
              >
                <CaretDownIcon
                  className={cn(
                    "size-2.5 transition-transform",
                    isCollapsed && "-rotate-90",
                  )}
                />
                <span>{label}</span>
                <span className="ml-auto font-normal tabular-nums text-muted-foreground">
                  {group.length}
                </span>
              </button>
            </div>
            {!isCollapsed && (
              <div>
                {group.map((plan) => {
                  const isActive = plan.id === activePlanId;
                  return (
                    <button
                      key={plan.id}
                      className={cn(
                        "relative flex w-full items-center border-b border-border px-3 py-2 text-left transition-colors hover:bg-accent",
                        isActive && "border-l-2 border-l-primary bg-accent pl-[10px]",
                      )}
                      onClick={() => onSelect(plan)}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold">{plan.title}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] text-muted-foreground">{plan.id}</span>
                          {plan.tasks && plan.tasks.length > 0 && (
                            <Badge variant="secondary">
                              {plan.tasks.length} task{plan.tasks.length !== 1 ? "s" : ""}
                            </Badge>
                          )}
                          {plan.tags?.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                          <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
                            {relativeTime(plan.updated)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
