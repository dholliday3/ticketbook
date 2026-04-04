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
import type { Ticket, Status } from "../types";

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

function sortWithinGroup(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => {
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

interface TicketListProps {
  tickets: Ticket[];
  activeTicketId: string | null;
  onSelect: (ticket: Ticket) => void;
  onReorder: (ticketId: string, afterId: string | null, beforeId: string | null) => void;
  onMove?: (ticketId: string, newStatus: Status, afterId: string | null, beforeId: string | null) => void;
  onCreateInStatus?: (status: Status) => void;
}

function TicketRowContent({
  ticket,
  activeTicketId,
  showHandle,
}: {
  ticket: Ticket;
  activeTicketId: string | null;
  showHandle?: boolean;
}) {
  return (
    <>
      {showHandle && (
        <span className="drag-handle" aria-label="Drag to reorder">
          <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
            <circle cx="2" cy="2" r="1.2" />
            <circle cx="6" cy="2" r="1.2" />
            <circle cx="2" cy="7" r="1.2" />
            <circle cx="6" cy="7" r="1.2" />
            <circle cx="2" cy="12" r="1.2" />
            <circle cx="6" cy="12" r="1.2" />
          </svg>
        </span>
      )}
      <div className="ticket-row-content">
        <div className="ticket-row-main">
          {ticket.priority && PRIORITY_INDICATOR[ticket.priority] && (
            <span
              className="priority-dot"
              style={{ backgroundColor: PRIORITY_INDICATOR[ticket.priority].color }}
              title={PRIORITY_INDICATOR[ticket.priority].label}
            />
          )}
          <span className="ticket-title">{ticket.title}</span>
        </div>
        <div className="ticket-row-meta">
          <span className="ticket-id">{ticket.id}</span>
          {ticket.assignee && (
            <span className="assignee-indicator" title={ticket.assignee}>{ticket.assignee}</span>
          )}
          {ticket.tags && ticket.tags.length > 0 && (
            <span className="ticket-tags">
              {ticket.tags.map((tag) => (
                <span key={tag} className="tag-chip">{tag}</span>
              ))}
            </span>
          )}
          <span className="ticket-time">{relativeTime(ticket.updated)}</span>
        </div>
      </div>
    </>
  );
}

function SortableTicketRow({
  ticket,
  activeTicketId,
  onSelect,
  isDragActive,
}: {
  ticket: Ticket;
  activeTicketId: string | null;
  onSelect: (ticket: Ticket) => void;
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
  } = useSortable({ id: ticket.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      className={`ticket-row ${ticket.id === activeTicketId ? "active" : ""} ${isDragActive ? "drag-active" : ""} ${ticket.status === "draft" ? "ticket-draft" : ""}`}
      onClick={() => onSelect(ticket)}
      {...attributes}
    >
      <span
        ref={setActivatorNodeRef}
        className="drag-handle"
        aria-label="Drag to reorder"
        {...listeners}
      >
        <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
          <circle cx="2" cy="2" r="1.2" />
          <circle cx="6" cy="2" r="1.2" />
          <circle cx="2" cy="7" r="1.2" />
          <circle cx="6" cy="7" r="1.2" />
          <circle cx="2" cy="12" r="1.2" />
          <circle cx="6" cy="12" r="1.2" />
        </svg>
      </span>
      <div className="ticket-row-content">
        <div className="ticket-row-main">
          {ticket.priority && PRIORITY_INDICATOR[ticket.priority] && (
            <span
              className="priority-dot"
              style={{ backgroundColor: PRIORITY_INDICATOR[ticket.priority].color }}
              title={PRIORITY_INDICATOR[ticket.priority].label}
            />
          )}
          <span className="ticket-title">{ticket.title}</span>
        </div>
        <div className="ticket-row-meta">
          <span className="ticket-id">{ticket.id}</span>
          {ticket.tags && ticket.tags.length > 0 && (
            <span className="ticket-tags">
              {ticket.tags.map((tag) => (
                <span key={tag} className="tag-chip">{tag}</span>
              ))}
            </span>
          )}
          <span className="ticket-time">{relativeTime(ticket.updated)}</span>
        </div>
      </div>
    </button>
  );
}

function DroppableGroup({ status, children }: { status: Status; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `group-${status}` });
  return (
    <div ref={setNodeRef} className={`ticket-group-items ${isOver ? "ticket-group-drop-over" : ""}`}>
      {children}
    </div>
  );
}

export function TicketList({ tickets, activeTicketId, onSelect, onReorder, onMove, onCreateInStatus }: TicketListProps) {
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

  const grouped = new Map<Status, Ticket[]>();
  for (const s of STATUS_ORDER) {
    grouped.set(s.key, []);
  }
  for (const t of tickets) {
    grouped.get(t.status)?.push(t);
  }

  // Pre-sort groups
  const sortedGroups = new Map<Status, Ticket[]>();
  for (const [key, group] of grouped) {
    sortedGroups.set(key, sortWithinGroup(group));
  }

  const toggleGroup = (status: Status) => {
    setCollapsed((prev) => ({ ...prev, [status]: !prev[status] }));
  };

  // Auto-expand collapsed group when a ticket in it becomes active (e.g. via keyboard navigation)
  useEffect(() => {
    if (!activeTicketId) return;
    const ticket = tickets.find((t) => t.id === activeTicketId);
    if (ticket && collapsed[ticket.status]) {
      setCollapsed((prev) => ({ ...prev, [ticket.status]: false }));
    }
  }, [activeTicketId]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTicket = activeId ? tickets.find((t) => t.id === activeId) ?? null : null;

  // Find which status group a ticket belongs to
  const findStatusGroup = useCallback(
    (ticketId: string): Status | null => {
      for (const [status, group] of sortedGroups) {
        if (group.some((t) => t.id === ticketId)) return status;
      }
      return null;
    },
    [sortedGroups],
  );

  const [overGroupStatus, setOverGroupStatus] = useState<Status | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (!over) { setOverGroupStatus(null); return; }
    const overIdStr = over.id as string;
    // Check if hovering a group droppable
    if (overIdStr.startsWith("group-")) {
      setOverGroupStatus(overIdStr.replace("group-", "") as Status);
    } else {
      const status = findStatusGroup(overIdStr);
      setOverGroupStatus(status);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverGroupStatus(null);

    if (!over || active.id === over.id) return;

    const activeStatus = findStatusGroup(active.id as string);
    const overIdStr = over.id as string;

    // Determine target status: either from a group droppable or from a ticket's group
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
      <div className="ticket-list">
        {STATUS_ORDER.map(({ key, label }) => {
          const group = sortedGroups.get(key) ?? [];
          const isCollapsed = collapsed[key];

          return (
            <div key={key} className="ticket-group">
              <div className="ticket-group-header-row">
                <button
                  className="ticket-group-header"
                  onClick={() => toggleGroup(key)}
                  aria-expanded={!isCollapsed}
                >
                  <span className={`chevron ${isCollapsed ? "collapsed" : ""}`}>&#9662;</span>
                  <span className="group-label">{label}</span>
                  <span className="group-count">{group.length}</span>
                </button>
                {onCreateInStatus && (
                  <button
                    className="group-add-btn"
                    onClick={(e) => { e.stopPropagation(); onCreateInStatus(key); }}
                    title={`New ${label} ticket`}
                    aria-label={`New ${label} ticket`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                )}
              </div>
              {!isCollapsed && (
                <SortableContext
                  items={group.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <DroppableGroup status={key}>
                    {group.map((ticket) => (
                      <SortableTicketRow
                        key={ticket.id}
                        ticket={ticket}
                        activeTicketId={activeTicketId}
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
        {activeTicket ? (
          <div className="ticket-row drag-overlay">
            <TicketRowContent ticket={activeTicket} activeTicketId={null} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
