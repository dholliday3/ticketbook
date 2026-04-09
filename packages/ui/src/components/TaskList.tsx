import { useState, useCallback, useEffect } from "react";
import {
  DndContext,
  closestCenter,
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
import {
  CaretDownIcon,
  DotsSixVerticalIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import type { Task, Status } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_ORDER: { key: Status; label: string }[] = [
  { key: "in-progress", label: "In Progress" },
  { key: "open", label: "Open" },
  { key: "backlog", label: "Backlog" },
  { key: "draft", label: "Draft" },
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

interface TaskListProps {
  tasks: Task[];
  activeTaskId: string | null;
  onSelect: (task: Task) => void;
  onReorder: (taskId: string, afterId: string | null, beforeId: string | null) => void;
  onMove?: (taskId: string, newStatus: Status, afterId: string | null, beforeId: string | null) => void;
  onCreateInStatus?: (status: Status) => void;
}

function TaskRowContent({ task }: { task: Task }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        {task.priority && PRIORITY_INDICATOR[task.priority] && (
          <span
            className="size-[7px] shrink-0 rounded-full"
            style={{ backgroundColor: PRIORITY_INDICATOR[task.priority].color }}
            title={PRIORITY_INDICATOR[task.priority].label}
          />
        )}
        <span className="truncate text-[13px] font-semibold">{task.title}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">{task.id}</span>
        {task.assignee && (
          <span
            className="max-w-[80px] truncate rounded-full bg-accent px-1.5 py-px text-[10px] text-muted-foreground"
            title={task.assignee}
          >
            {task.assignee}
          </span>
        )}
        {task.tags && task.tags.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {task.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </span>
        )}
        <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
          {relativeTime(task.updated)}
        </span>
      </div>
    </div>
  );
}

function SortableTaskRow({
  task,
  activeTaskId,
  onSelect,
  isDragActive,
}: {
  task: Task;
  activeTaskId: string | null;
  onSelect: (task: Task) => void;
  isDragActive: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
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
    <button
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/row relative flex w-full items-center border-b border-border px-3 py-2 text-left transition-colors hover:bg-accent",
        isActive && "border-l-2 border-l-primary bg-accent pl-[10px]",
        isDraft && "italic opacity-60",
        isDraft && isActive && "opacity-80",
      )}
      onClick={() => onSelect(task)}
      {...attributes}
    >
      <span
        ref={setActivatorNodeRef}
        className={cn(
          "mr-1 flex w-[18px] shrink-0 touch-none cursor-grab items-center justify-center py-0.5 text-muted-foreground opacity-0 transition-opacity active:cursor-grabbing group-hover/row:opacity-100",
          isDragActive && "opacity-100",
        )}
        aria-label="Drag to reorder"
        {...listeners}
      >
        <DotsSixVerticalIcon className="size-3.5" />
      </span>
      <TaskRowContent task={task} />
    </button>
  );
}

function DroppableGroup({ status, children }: { status: Status; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `group-${status}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-0",
        isOver && "min-h-7 rounded-md bg-primary/10",
      )}
    >
      {children}
    </div>
  );
}

export function TaskList({ tasks, activeTaskId, onSelect, onReorder, onMove, onCreateInStatus }: TaskListProps) {
  const [collapsed, setCollapsed] = useState<Record<Status, boolean>>({
    "in-progress": false,
    open: false,
    backlog: false,
    draft: true,
    done: true,
    cancelled: true,
  });
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const grouped = new Map<Status, Task[]>();
  for (const s of STATUS_ORDER) {
    grouped.set(s.key, []);
  }
  for (const t of tasks) {
    grouped.get(t.status)?.push(t);
  }

  // Pre-sort groups
  const sortedGroups = new Map<Status, Task[]>();
  for (const [key, group] of grouped) {
    sortedGroups.set(key, sortWithinGroup(group));
  }

  const toggleGroup = (status: Status) => {
    setCollapsed((prev) => ({ ...prev, [status]: !prev[status] }));
  };

  // Auto-expand collapsed group when a task in it becomes active (e.g. via keyboard navigation)
  useEffect(() => {
    if (!activeTaskId) return;
    const task = tasks.find((t) => t.id === activeTaskId);
    if (task && collapsed[task.status]) {
      setCollapsed((prev) => ({ ...prev, [task.status]: false }));
    }
  }, [activeTaskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  // Find which status group a task belongs to
  const findStatusGroup = useCallback(
    (taskId: string): Status | null => {
      for (const [status, group] of sortedGroups) {
        if (group.some((t) => t.id === taskId)) return status;
      }
      return null;
    },
    [sortedGroups],
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (_event: DragOverEvent) => {
    // DroppableGroup handles its own isOver styling via useDroppable
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    const activeStatus = findStatusGroup(active.id as string);
    const overIdStr = over.id as string;

    // Determine target status: either from a group droppable or from a task's group
    let targetStatus: Status | null = null;
    if (overIdStr.startsWith("group-")) {
      targetStatus = overIdStr.replace("group-", "") as Status;
    } else {
      targetStatus = findStatusGroup(overIdStr);
    }

    if (!activeStatus || !targetStatus) return;

    if (activeStatus === targetStatus) {
      // Same group: reorder within
      const group = sortedGroups.get(activeStatus)!;
      const oldIndex = group.findIndex((t) => t.id === active.id);
      const newIndex = group.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(group, oldIndex, newIndex);
      const afterId = newIndex > 0 ? reordered[newIndex - 1].id : null;
      const beforeId = newIndex < reordered.length - 1 ? reordered[newIndex + 1].id : null;
      onReorder(active.id as string, afterId, beforeId);
    } else if (onMove) {
      // Cross-group: change status and place at end of target group
      const targetGroup = sortedGroups.get(targetStatus) ?? [];
      const afterId = targetGroup.length > 0 ? targetGroup[targetGroup.length - 1].id : null;
      onMove(active.id as string, targetStatus, afterId, null);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col">
        {STATUS_ORDER.map(({ key, label }) => {
          const group = sortedGroups.get(key) ?? [];
          const isCollapsed = collapsed[key];

          return (
            <div key={key}>
              <div className="group/header flex items-center">
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
                {onCreateInStatus && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="mr-2 size-5 opacity-0 transition-opacity group-hover/header:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCreateInStatus(key);
                    }}
                    title={`New ${label} task`}
                    aria-label={`New ${label} task`}
                  >
                    <PlusIcon className="size-3" />
                  </Button>
                )}
              </div>
              {!isCollapsed && (
                <SortableContext
                  items={group.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <DroppableGroup status={key}>
                    {group.map((task) => (
                      <SortableTaskRow
                        key={task.id}
                        task={task}
                        activeTaskId={activeTaskId}
                        onSelect={onSelect}
                        isDragActive={activeId !== null}
                      />
                    ))}
                  </DroppableGroup>
                </SortableContext>
              )}
            </div>
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="flex w-[280px] items-center rounded-md border border-primary bg-card px-3 py-2 opacity-95 shadow-lg">
            <TaskRowContent task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
