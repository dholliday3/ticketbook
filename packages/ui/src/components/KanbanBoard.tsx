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
import { CaretDoubleLeftIcon, PlusIcon } from "@phosphor-icons/react";
import type { Task, Status } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KANBAN_COLUMNS: { key: Status; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "backlog", label: "Backlog" },
  { key: "open", label: "Open" },
  { key: "in-progress", label: "In Progress" },
  { key: "done", label: "Done" },
  { key: "cancelled", label: "Cancelled" },
];

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const PRIORITY_INDICATOR: Record<string, { color: string; label: string }> = {
  urgent: { color: "#ef4444", label: "Urgent" },
  high: { color: "#f97316", label: "High" },
  medium: { color: "#eab308", label: "Medium" },
  low: { color: "#9ca3af", label: "Low" },
};

function sortWithinGroup(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const aHasOrder = a.order != null;
    const bHasOrder = b.order != null;
    if (aHasOrder && bHasOrder) return a.order! - b.order!;
    if (aHasOrder && !bHasOrder) return -1;
    if (!aHasOrder && bHasOrder) return 1;

    const aPri = a.priority ? (PRIORITY_RANK[a.priority] ?? 4) : 4;
    const bPri = b.priority ? (PRIORITY_RANK[b.priority] ?? 4) : 4;
    if (aPri !== bPri) return aPri - bPri;

    return new Date(b.updated).getTime() - new Date(a.updated).getTime();
  });
}

function buildGroups(tasks: Task[]): Record<Status, string[]> {
  const grouped: Partial<Record<Status, Task[]>> = {};
  for (const col of KANBAN_COLUMNS) grouped[col.key] = [];
  for (const t of tasks) grouped[t.status]?.push(t);
  const result: Record<string, string[]> = {};
  for (const col of KANBAN_COLUMNS) {
    result[col.key] = sortWithinGroup(grouped[col.key] || []).map((t) => t.id);
  }
  return result as Record<Status, string[]>;
}

interface KanbanBoardProps {
  tasks: Task[];
  activeTaskId: string | null;
  onSelect: (task: Task) => void;
  onMove: (taskId: string, newStatus: Status, afterId: string | null, beforeId: string | null) => void;
  onCreateInColumn?: (status: Status) => void;
}

function DroppableColumn({
  status,
  isOver,
  children,
}: {
  status: Status;
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

function TaskCardBody({ task }: { task: Task }) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        {task.priority && PRIORITY_INDICATOR[task.priority] && (
          <span
            className="size-[7px] shrink-0 rounded-full"
            style={{ backgroundColor: PRIORITY_INDICATOR[task.priority].color }}
            title={PRIORITY_INDICATOR[task.priority].label}
          />
        )}
        <span className="line-clamp-2 text-[13px] font-semibold leading-tight">
          {task.title}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">{task.id}</span>
        {task.tags && task.tags.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {task.tags.map((tag) => (
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

function SortableKanbanCard({
  task,
  activeTaskId,
  onSelect,
  showDropIndicator,
}: {
  task: Task;
  activeTaskId: string | null;
  onSelect: (task: Task) => void;
  showDropIndicator: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const isActive = task.id === activeTaskId;
  const isDraft = task.status === "draft";

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {showDropIndicator && (
        <div className="mb-1 h-0.5 rounded-sm bg-primary" />
      )}
      <button
        className={cn(
          "flex w-full cursor-pointer flex-col gap-1.5 rounded-md border border-border bg-card p-2.5 text-left text-foreground transition-colors hover:border-muted-foreground hover:bg-accent",
          isActive && "border-primary bg-accent",
          isDraft && "border-dashed italic opacity-60",
        )}
        onClick={() => onSelect(task)}
        {...attributes}
        {...listeners}
      >
        <TaskCardBody task={task} />
      </button>
    </div>
  );
}

function KanbanCardOverlay({ task }: { task: Task }) {
  return (
    <div className="flex w-[220px] flex-col gap-1.5 rounded-md border border-primary bg-card p-2.5 text-left opacity-95 shadow-lg">
      <TaskCardBody task={task} />
    </div>
  );
}

export function KanbanBoard({ tasks, activeTaskId, onSelect, onMove, onCreateInColumn }: KanbanBoardProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    done: false,
    cancelled: false,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<Status | null>(null);

  // Local state for multi-container drag: maps status -> ordered task IDs
  const [itemGroups, setItemGroups] = useState<Record<Status, string[]>>(() => buildGroups(tasks));

  const taskMap = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  // Sync from props when not dragging
  useEffect(() => {
    if (!activeId) {
      setItemGroups(buildGroups(tasks));
    }
  }, [tasks, activeId]);

  function findContainer(id: string): Status | undefined {
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

    // Move item to new container
    setItemGroups((prev) => {
      const activeItems = [...(prev[activeContainer] || [])];
      const overItems = [...(prev[overContainer] || [])];

      const activeIndex = activeItems.indexOf(active.id as string);
      if (activeIndex === -1) return prev;

      // Remove from source
      activeItems.splice(activeIndex, 1);

      // Find insertion index in target
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
      // Cancelled — reset
      setItemGroups(buildGroups(tasks));
      setActiveId(null);
      return;
    }

    const activeContainer = findContainer(active.id as string);
    const overContainer = findContainer(over.id as string);

    if (!activeContainer || !overContainer) {
      setActiveId(null);
      return;
    }

    const task = taskMap.get(active.id as string);
    const originalStatus = task?.status;
    const statusChanged = originalStatus !== overContainer;

    let finalItems = [...(itemGroups[overContainer] || [])];

    if (activeContainer === overContainer) {
      const activeIndex = finalItems.indexOf(active.id as string);
      const overIndex = finalItems.indexOf(over.id as string);

      if (activeIndex !== -1 && overIndex !== -1 && activeIndex !== overIndex) {
        finalItems = arrayMove(finalItems, activeIndex, overIndex);
        setItemGroups((prev) => ({ ...prev, [overContainer]: finalItems }));
      } else if (!statusChanged) {
        // Same container, same position, no status change — nothing to do
        setActiveId(null);
        return;
      }
    }

    // Compute afterId/beforeId from the final item list
    const newIndex = finalItems.indexOf(active.id as string);
    if (newIndex === -1) {
      setActiveId(null);
      return;
    }
    const afterId = newIndex > 0 ? finalItems[newIndex - 1] : null;
    const beforeId = newIndex < finalItems.length - 1 ? finalItems[newIndex + 1] : null;

    onMove(active.id as string, overContainer, afterId, beforeId);
    setActiveId(null);
  };

  const toggleCollapse = (status: Status) => {
    setCollapsed((prev) => ({ ...prev, [status]: !prev[status] }));
  };

  const collapsible = (status: Status) => status === "done" || status === "cancelled";

  const activeTask = activeId ? taskMap.get(activeId) ?? null : null;

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
                "group/col flex min-h-0 flex-1 flex-col bg-background",
                "min-w-[200px]",
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
                {onCreateInColumn && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      "opacity-0 transition-opacity group-hover/col:opacity-100",
                      !collapsible(key) && "ml-auto",
                    )}
                    onClick={() => onCreateInColumn(key)}
                    title={`New ${label} task`}
                    aria-label={`New ${label} task`}
                  >
                    <PlusIcon />
                  </Button>
                )}
              </div>
              <DroppableColumn status={key} isOver={isColumnOver}>
                <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
                  {groupIds.map((id) => {
                    const task = taskMap.get(id);
                    if (!task) return null;
                    return (
                      <SortableKanbanCard
                        key={id}
                        task={task}
                        activeTaskId={activeTaskId}
                        onSelect={onSelect}
                        showDropIndicator={overId === id && activeId !== id}
                      />
                    );
                  })}
                </SortableContext>
                {overId === `column-${key}` && activeId && (
                  <div className="mb-1 h-0.5 rounded-sm bg-primary" />
                )}
                {onCreateInColumn && (
                  <Button
                    variant="ghost"
                    className="mt-1 h-7 w-full justify-center opacity-0 transition-opacity group-hover/col:opacity-100"
                    onClick={() => onCreateInColumn(key)}
                    aria-label={`New ${label} task`}
                  >
                    <PlusIcon />
                  </Button>
                )}
              </DroppableColumn>
            </div>
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask ? <KanbanCardOverlay task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
