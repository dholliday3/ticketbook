import { useState, useEffect, useMemo } from "react";
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CaretDoubleLeftIcon } from "@phosphor-icons/react";
import type { Plan, PlanStatus } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KANBAN_COLUMNS: { key: PlanStatus; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "archived", label: "Archived" },
];

function sortByUpdated(plans: Plan[]): Plan[] {
  return [...plans].sort(
    (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime(),
  );
}

function buildGroups(plans: Plan[]): Record<PlanStatus, string[]> {
  const grouped: Partial<Record<PlanStatus, Plan[]>> = {};
  for (const col of KANBAN_COLUMNS) grouped[col.key] = [];
  for (const p of plans) grouped[p.status]?.push(p);
  const result: Record<string, string[]> = {};
  for (const col of KANBAN_COLUMNS) {
    result[col.key] = sortByUpdated(grouped[col.key] || []).map((p) => p.id);
  }
  return result as Record<PlanStatus, string[]>;
}

interface PlanKanbanBoardProps {
  plans: Plan[];
  activePlanId: string | null;
  onSelect: (plan: Plan) => void;
  onMove: (planId: string, newStatus: PlanStatus) => void;
}

function DroppableColumn({
  status,
  isOver,
  children,
}: {
  status: PlanStatus;
  isOver: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: `column-${status}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[60px] flex-1 flex-col gap-1.5 overflow-y-auto p-2",
        isOver && "bg-primary/5",
      )}
    >
      {children}
    </div>
  );
}

function PlanCardBody({ plan }: { plan: Plan }) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="line-clamp-2 text-[13px] font-semibold leading-tight">
          {plan.title}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">{plan.id}</span>
        {plan.tasks && plan.tasks.length > 0 && (
          <Badge variant="secondary">
            {plan.tasks.length} task{plan.tasks.length !== 1 ? "s" : ""}
          </Badge>
        )}
        {plan.tags && plan.tags.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {plan.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </span>
        )}
      </div>
    </>
  );
}

function SortablePlanCard({
  plan,
  activePlanId,
  onSelect,
  showDropIndicator,
}: {
  plan: Plan;
  activePlanId: string | null;
  onSelect: (plan: Plan) => void;
  showDropIndicator: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: plan.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const isActive = plan.id === activePlanId;

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {showDropIndicator && (
        <div className="mb-1 h-0.5 rounded-sm bg-primary" />
      )}
      <button
        className={cn(
          "flex w-full cursor-pointer flex-col gap-1.5 rounded-md border border-border bg-card p-2.5 text-left text-foreground transition-colors hover:border-muted-foreground hover:bg-accent",
          isActive && "border-primary bg-accent",
        )}
        onClick={() => onSelect(plan)}
        {...attributes}
        {...listeners}
      >
        <PlanCardBody plan={plan} />
      </button>
    </div>
  );
}

function PlanCardOverlay({ plan }: { plan: Plan }) {
  return (
    <div className="flex w-[220px] flex-col gap-1.5 rounded-md border border-primary bg-card p-2.5 text-left opacity-95 shadow-lg">
      <PlanCardBody plan={plan} />
    </div>
  );
}

export function PlanKanbanBoard({ plans, activePlanId, onSelect, onMove }: PlanKanbanBoardProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    archived: false,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<PlanStatus | null>(null);

  const [itemGroups, setItemGroups] = useState<Record<PlanStatus, string[]>>(() => buildGroups(plans));

  const planMap = useMemo(() => {
    const map = new Map<string, Plan>();
    for (const p of plans) map.set(p.id, p);
    return map;
  }, [plans]);

  useEffect(() => {
    if (!activeId) {
      setItemGroups(buildGroups(plans));
    }
  }, [plans, activeId]);

  function findContainer(id: string): PlanStatus | undefined {
    for (const col of KANBAN_COLUMNS) {
      if (id === `column-${col.key}`) return col.key;
    }
    for (const col of KANBAN_COLUMNS) {
      if (itemGroups[col.key]?.includes(id)) return col.key;
    }
    return undefined;
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) {
      setOverId(null);
      setOverColumn(null);
      return;
    }

    const overIdStr = over.id as string;
    setOverId(overIdStr);

    const activeContainer = findContainer(active.id as string);
    const overContainer = findContainer(overIdStr);

    if (!activeContainer || !overContainer) return;
    setOverColumn(overContainer);

    if (activeContainer === overContainer) return;

    setItemGroups((prev) => {
      const activeItems = [...(prev[activeContainer] || [])];
      const overItems = [...(prev[overContainer] || [])];

      const activeIndex = activeItems.indexOf(active.id as string);
      if (activeIndex === -1) return prev;

      activeItems.splice(activeIndex, 1);

      const overIndex = overItems.indexOf(overIdStr);
      const newIndex = overIndex >= 0 ? overIndex : overItems.length;
      overItems.splice(newIndex, 0, active.id as string);

      return {
        ...prev,
        [activeContainer]: activeItems,
        [overContainer]: overItems,
      };
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setOverId(null);
    setOverColumn(null);

    if (!over) {
      setItemGroups(buildGroups(plans));
      setActiveId(null);
      return;
    }

    const activeContainer = findContainer(active.id as string);
    const overContainer = findContainer(over.id as string);

    if (!activeContainer || !overContainer) {
      setActiveId(null);
      return;
    }

    const plan = planMap.get(active.id as string);
    const originalStatus = plan?.status;

    if (activeContainer === overContainer) {
      const finalItems = [...(itemGroups[overContainer] || [])];
      const activeIndex = finalItems.indexOf(active.id as string);
      const overIndex = finalItems.indexOf(over.id as string);

      if (activeIndex !== -1 && overIndex !== -1 && activeIndex !== overIndex) {
        setItemGroups((prev) => ({
          ...prev,
          [overContainer]: arrayMove(finalItems, activeIndex, overIndex),
        }));
      }

      if (originalStatus !== overContainer) {
        onMove(active.id as string, overContainer);
      }
    } else {
      onMove(active.id as string, overContainer);
    }

    setActiveId(null);
  };

  const toggleCollapse = (status: PlanStatus) => {
    setCollapsed((prev) => ({ ...prev, [status]: !prev[status] }));
  };

  const collapsible = (status: PlanStatus) => status === "archived";

  const activePlan = activeId ? planMap.get(activeId) ?? null : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex min-h-0 flex-1 gap-px overflow-x-auto bg-border">
        {KANBAN_COLUMNS.map(({ key, label }) => {
          const groupIds = itemGroups[key] || [];
          const isCollapsed = collapsible(key) && collapsed[key];
          const isColumnOver = overColumn === key && activeId != null;

          if (isCollapsed) {
            return (
              <button
                type="button"
                key={key}
                className="flex min-h-0 w-10 shrink-0 cursor-pointer flex-col items-center justify-center gap-2 bg-card py-3 transition-colors hover:bg-accent"
                onClick={() => toggleCollapse(key)}
                aria-label={`Expand ${label} column`}
              >
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground [writing-mode:vertical-rl]">
                  {label}
                </span>
                <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {groupIds.length}
                </span>
              </button>
            );
          }

          return (
            <div
              key={key}
              className={cn(
                "flex min-h-0 min-w-[200px] flex-1 flex-col bg-background",
                isColumnOver && "ring-2 ring-inset ring-primary/30",
              )}
            >
              <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {label}
                </span>
                <span className="rounded-full bg-accent px-1.5 py-px text-[11px] tabular-nums text-muted-foreground">
                  {groupIds.length}
                </span>
                {collapsible(key) && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto"
                    onClick={() => toggleCollapse(key)}
                    title={`Collapse ${label}`}
                    aria-label={`Collapse ${label} column`}
                  >
                    <CaretDoubleLeftIcon />
                  </Button>
                )}
              </div>
              <DroppableColumn status={key} isOver={isColumnOver}>
                <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
                  {groupIds.map((id) => {
                    const plan = planMap.get(id);
                    if (!plan) return null;
                    return (
                      <SortablePlanCard
                        key={id}
                        plan={plan}
                        activePlanId={activePlanId}
                        onSelect={onSelect}
                        showDropIndicator={overId === id && activeId !== id}
                      />
                    );
                  })}
                </SortableContext>
                {overId === `column-${key}` && activeId && (
                  <div className="mb-1 h-0.5 rounded-sm bg-primary" />
                )}
              </DroppableColumn>
            </div>
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activePlan ? <PlanCardOverlay plan={activePlan} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
