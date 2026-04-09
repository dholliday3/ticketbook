import { createRootRoute, Outlet, useMatch, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import {
  GearIcon,
  HouseIcon,
  KanbanIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AppProvider, useAppContext } from "../context/AppContext";
import type { ViewMode } from "../context/AppContext";
import { FilterChip } from "../components/FilterChip";
import { CreateTicketModal } from "../components/CreateTicketModal";
import { CreatePlanModal } from "../components/CreatePlanModal";
import { SettingsDialog } from "../components/SettingsDialog";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import { TerminalPane } from "../components/TerminalPane";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";

// Lazy-loaded so the ai-elements/streamdown/shiki tree (~1MB+) only loads
// when the user opens the assistant panel for the first time. Without this
// the initial bundle balloons by ~5x.
const CopilotPanel = lazy(() =>
  import("../components/CopilotPanel").then((m) => ({ default: m.CopilotPanel })),
);
import { patchTicket } from "../api";
import type { Status, Priority, Ticket } from "../types";
import "../App.css";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <AppProvider>
      <RootLayoutInner />
    </AppProvider>
  );
}

function RootLayoutInner() {
  const ctx = useAppContext();
  const navigate = useNavigate();

  // Detect current route
  const ticketsMatch = useMatch({ from: "/tasks", shouldThrow: false });
  const plansMatch = useMatch({ from: "/plans", shouldThrow: false });
  const indexMatch = useMatch({ from: "/", shouldThrow: false });

  const isHome = indexMatch != null && !ticketsMatch && !plansMatch;
  const isTickets = ticketsMatch != null;
  const isPlans = plansMatch != null;

  // Read search params from matched routes
  const ticketsSearch = (ticketsMatch as any)?.search as
    | { view?: string; status?: string[]; project?: string[]; epic?: string[]; sprint?: string[]; q?: string }
    | undefined;
  const plansSearch = (plansMatch as any)?.search as
    | { view?: string; status?: string[]; project?: string[]; q?: string }
    | undefined;

  const currentView: ViewMode =
    isTickets
      ? (ticketsSearch?.view === "board" ? "board" : "list")
      : isPlans
        ? (plansSearch?.view === "board" ? "board" : "list")
        : "list";

  // Search input with debounce
  const currentQ = isTickets ? (ticketsSearch?.q ?? "") : isPlans ? (plansSearch?.q ?? "") : "";
  const [searchInput, setSearchInput] = useState(currentQ);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external q changes into local input
  useEffect(() => {
    setSearchInput(currentQ);
  }, [currentQ]);

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      if (searchInput !== currentQ) {
        if (isTickets) {
          navigate({ to: "/tasks", search: (prev: any) => ({ ...prev, q: searchInput || undefined }) });
        } else if (isPlans) {
          navigate({ to: "/plans", search: (prev: any) => ({ ...prev, q: searchInput || undefined }) });
        }
      }
    }, 200);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchInput]);

  // Filter state derived from search params
  const ticketFilters = {
    status: ticketsSearch?.status ?? [],
    project: ticketsSearch?.project ?? [],
    epic: ticketsSearch?.epic ?? [],
    sprint: ticketsSearch?.sprint ?? [],
  };
  const planFilterState = {
    status: plansSearch?.status ?? [],
    project: plansSearch?.project ?? [],
  };

  const hasActiveFilters =
    isTickets
      ? (ticketFilters.status.length > 0 || ticketFilters.project.length > 0 || ticketFilters.epic.length > 0 || ticketFilters.sprint.length > 0)
      : isPlans
        ? (planFilterState.status.length > 0 || planFilterState.project.length > 0)
        : false;

  // Filtered counts (for result badge)
  const filteredTicketCount = useMemo(() => {
    if (!isTickets) return 0;
    return ctx.tickets.filter((t) => {
      if (currentQ) {
        const q = currentQ.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !t.body.toLowerCase().includes(q)) return false;
      }
      if (ticketFilters.status.length > 0 && !ticketFilters.status.includes(t.status)) return false;
      if (ticketFilters.project.length > 0 && (!t.project || !ticketFilters.project.includes(t.project))) return false;
      if (ticketFilters.epic.length > 0 && (!t.epic || !ticketFilters.epic.includes(t.epic))) return false;
      if (ticketFilters.sprint.length > 0 && (!t.sprint || !ticketFilters.sprint.includes(t.sprint))) return false;
      return true;
    }).length;
  }, [isTickets, ctx.tickets, currentQ, ticketFilters]);

  const filteredPlanCount = useMemo(() => {
    if (!isPlans) return 0;
    return ctx.plans.filter((p) => {
      if (currentQ) {
        const q = currentQ.toLowerCase();
        if (!p.title.toLowerCase().includes(q) && !p.body.toLowerCase().includes(q)) return false;
      }
      if (planFilterState.status.length > 0 && !planFilterState.status.includes(p.status)) return false;
      if (planFilterState.project.length > 0 && (!p.project || !planFilterState.project.includes(p.project))) return false;
      return true;
    }).length;
  }, [isPlans, ctx.plans, currentQ, planFilterState]);

  // Filter toggle helpers
  const toggleTicketFilter = useCallback(
    (key: string, value: string) => {
      navigate({
        to: "/tasks",
        search: (prev: any) => {
          const current: string[] = prev[key] ?? [];
          const next = current.includes(value) ? current.filter((v: string) => v !== value) : [...current, value];
          return { ...prev, [key]: next.length > 0 ? next : undefined };
        },
      });
    },
    [navigate],
  );

  const togglePlanFilter = useCallback(
    (key: string, value: string) => {
      navigate({
        to: "/plans",
        search: (prev: any) => {
          const current: string[] = prev[key] ?? [];
          const next = current.includes(value) ? current.filter((v: string) => v !== value) : [...current, value];
          return { ...prev, [key]: next.length > 0 ? next : undefined };
        },
      });
    },
    [navigate],
  );

  // View mode change
  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      if (isTickets) {
        navigate({ to: "/tasks", search: (prev: any) => ({ ...prev, view: mode === "list" ? undefined : mode }) });
      } else if (isPlans) {
        navigate({ to: "/plans", search: (prev: any) => ({ ...prev, view: mode === "list" ? undefined : mode }) });
      }
    },
    [navigate, isTickets, isPlans],
  );

  // Flat ticket list for keyboard nav (only in tickets route)
  const flatTicketList = useMemo(() => {
    if (!isTickets) return [];
    const statusOrder: Status[] =
      currentView === "board"
        ? ["draft", "backlog", "open", "in-progress", "done", "cancelled"]
        : ["in-progress", "open", "backlog", "draft", "done", "cancelled"];
    const priorityRank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    const filtered = ctx.tickets.filter((t) => {
      if (currentQ) {
        const q = currentQ.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !t.body.toLowerCase().includes(q)) return false;
      }
      if (ticketFilters.status.length > 0 && !ticketFilters.status.includes(t.status)) return false;
      if (ticketFilters.project.length > 0 && (!t.project || !ticketFilters.project.includes(t.project))) return false;
      if (ticketFilters.epic.length > 0 && (!t.epic || !ticketFilters.epic.includes(t.epic))) return false;
      if (ticketFilters.sprint.length > 0 && (!t.sprint || !ticketFilters.sprint.includes(t.sprint))) return false;
      return true;
    });
    const result: Ticket[] = [];
    for (const status of statusOrder) {
      const group = filtered.filter((t) => t.status === status);
      const sorted = [...group].sort((a, b) => {
        const aHas = a.order != null;
        const bHas = b.order != null;
        if (aHas && bHas) return a.order! - b.order!;
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        const aPri = a.priority ? (priorityRank[a.priority] ?? 4) : 4;
        const bPri = b.priority ? (priorityRank[b.priority] ?? 4) : 4;
        if (aPri !== bPri) return aPri - bPri;
        return new Date(b.updated).getTime() - new Date(a.updated).getTime();
      });
      result.push(...sorted);
    }
    return result;
  }, [isTickets, ctx.tickets, currentView, currentQ, ticketFilters]);

  // Global keyboard shortcuts
  useEffect(() => {
    const isEditing = (): boolean => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // Cmd+K: focus search input
      if (meta && e.key === "k") {
        e.preventDefault();
        ctx.searchInputRef.current?.focus();
        ctx.searchInputRef.current?.select();
        return;
      }

      // Cmd+Shift+L: switch to list view
      if (meta && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        handleViewModeChange("list");
        return;
      }

      // Cmd+Shift+B: switch to board view
      if (meta && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        handleViewModeChange("board");
        return;
      }

      // Escape: close dialogs / deselect
      if (e.key === "Escape") {
        if (ctx.confirmDelete) {
          ctx.setConfirmDelete(null);
          return;
        }
        if (ctx.isCreating) {
          ctx.setIsCreating(false);
          return;
        }
        if (isEditing()) {
          (document.activeElement as HTMLElement)?.blur();
          return;
        }
        ctx.setActiveTicketId(null);
        return;
      }

      // Remaining shortcuts require no editable element to be focused
      if (isEditing()) return;

      // "c": create new item
      if (e.key === "c" && !meta && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (isPlans) {
          ctx.handleNewPlan();
        } else {
          ctx.setCreateDefaultStatus("open");
          ctx.setIsCreating(true);
          ctx.setActiveTicketId(null);
        }
        return;
      }

      // Up/Down: navigate ticket list (only on tickets route)
      if (isTickets && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        if (flatTicketList.length === 0) return;
        const currentIndex = ctx.activeTicketId
          ? flatTicketList.findIndex((t) => t.id === ctx.activeTicketId)
          : -1;
        let nextIndex: number;
        if (e.key === "ArrowDown") {
          nextIndex = currentIndex < flatTicketList.length - 1 ? currentIndex + 1 : currentIndex;
        } else {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
        }
        ctx.setActiveTicketId(flatTicketList[nextIndex].id);
        ctx.setIsCreating(false);
        setTimeout(() => {
          document
            .querySelector(".ticket-row.active, .kanban-card.active")
            ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }, 0);
        return;
      }

      // Enter: open selected ticket
      if (isTickets && e.key === "Enter" && ctx.activeTicketId) {
        e.preventDefault();
        setTimeout(() => {
          const editor = document.querySelector(".tiptap-editor .ProseMirror") as HTMLElement;
          editor?.focus();
        }, 50);
        return;
      }

      // 1-4: set priority when a ticket is selected
      if (isTickets && ctx.activeTicketId && e.key >= "1" && e.key <= "4") {
        const priorityMap: Record<string, Priority> = {
          "1": "urgent",
          "2": "high",
          "3": "medium",
          "4": "low",
        };
        const priority = priorityMap[e.key];
        if (priority) {
          patchTicket(ctx.activeTicketId, { priority })
            .then(() => ctx.loadTickets())
            .catch(console.error);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    ctx.activeTicketId,
    ctx.isCreating,
    ctx.confirmDelete,
    flatTicketList,
    handleViewModeChange,
    isTickets,
    isPlans,
    ctx,
  ]);

  // Determine space string for the + button / status bar
  const space = isPlans ? "plans" : "tickets";

  return (
    <div className={`app-layout ${currentView === "board" && !isHome ? "app-layout-board" : ""}`}>
      <header className="z-10 flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-2 py-1.5 md:flex-nowrap">
        <Button
          variant={isHome ? "secondary" : "ghost"}
          size="icon"
          onClick={() => navigate({ to: "/" })}
          title="Home"
          aria-label="Home"
          aria-current={isHome ? "page" : undefined}
        >
          <HouseIcon weight={isHome ? "fill" : "regular"} />
        </Button>
        <ButtonGroup aria-label="Space">
          <Button
            variant={isTickets ? "default" : "outline"}
            onClick={() => navigate({ to: "/tasks", search: { view: "list", status: [], project: [], epic: [], sprint: [] } })}
            role="radio"
            aria-checked={isTickets}
            aria-label="Tasks"
          >
            Tasks
          </Button>
          <Button
            variant={isPlans ? "default" : "outline"}
            onClick={() => navigate({ to: "/plans", search: { view: "list", status: [], project: [] } })}
            role="radio"
            aria-checked={isPlans}
            aria-label="Plans"
          >
            Plans
          </Button>
        </ButtonGroup>
        {!isHome && (
          <ButtonGroup aria-label="View mode">
            <Button
              variant={currentView === "list" ? "default" : "outline"}
              onClick={() => handleViewModeChange("list")}
              role="radio"
              aria-checked={currentView === "list"}
              aria-label="List view"
            >
              <ListIcon />
              List
            </Button>
            <Button
              variant={currentView === "board" ? "default" : "outline"}
              onClick={() => handleViewModeChange("board")}
              role="radio"
              aria-checked={currentView === "board"}
              aria-label="Board view"
            >
              <KanbanIcon />
              Board
            </Button>
          </ButtonGroup>
        )}
        {!isHome && (
          <div className="order-10 flex w-full shrink-0 items-center gap-1 overflow-x-auto md:order-none md:w-auto">
            {isTickets ? (
              <>
                <FilterChip
                  label="Status"
                  options={["draft", "backlog", "open", "in-progress", "done", "cancelled"]}
                  selected={ticketFilters.status}
                  onToggle={(v) => toggleTicketFilter("status", v)}
                />
                <FilterChip
                  label="Project"
                  options={ctx.meta.projects}
                  selected={ticketFilters.project}
                  onToggle={(v) => toggleTicketFilter("project", v)}
                />
                <FilterChip
                  label="Epic"
                  options={ctx.meta.epics}
                  selected={ticketFilters.epic}
                  onToggle={(v) => toggleTicketFilter("epic", v)}
                />
                <FilterChip
                  label="Sprint"
                  options={ctx.meta.sprints}
                  selected={ticketFilters.sprint}
                  onToggle={(v) => toggleTicketFilter("sprint", v)}
                />
              </>
            ) : isPlans ? (
              <>
                <FilterChip
                  label="Status"
                  options={["draft", "active", "completed", "archived"]}
                  selected={planFilterState.status}
                  onToggle={(v) => togglePlanFilter("status", v)}
                />
                <FilterChip
                  label="Project"
                  options={ctx.planMeta.projects}
                  selected={planFilterState.project}
                  onToggle={(v) => togglePlanFilter("project", v)}
                />
              </>
            ) : null}
          </div>
        )}
        <div className="flex-1" />
        {!isHome && (
          <Button
            variant="outline"
            size="icon"
            onClick={isPlans ? ctx.handleNewPlan : ctx.handleNewTicket}
            title={isPlans ? "New plan (C)" : "New ticket (C)"}
            aria-label={isPlans ? "New plan" : "New ticket"}
          >
            <PlusIcon />
          </Button>
        )}
        {!isHome && (
          <InputGroup className="w-52">
            <InputGroupInput
              ref={ctx.searchInputRef}
              type="text"
              placeholder="Search..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <InputGroupAddon align="inline-start">
              <MagnifyingGlassIcon className="opacity-60" />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end">
              {(currentQ || hasActiveFilters) && (
                <InputGroupText className="text-[11px] tabular-nums">
                  {isTickets
                    ? `${filteredTicketCount} result${filteredTicketCount !== 1 ? "s" : ""}`
                    : `${filteredPlanCount} result${filteredPlanCount !== 1 ? "s" : ""}`}
                </InputGroupText>
              )}
              {searchInput && (
                <InputGroupButton
                  size="icon-xs"
                  onClick={() => setSearchInput("")}
                  aria-label="Clear search"
                >
                  <XIcon />
                </InputGroupButton>
              )}
            </InputGroupAddon>
          </InputGroup>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => ctx.setShowSettings(true)}
          title="Settings"
          aria-label="Settings"
        >
          <GearIcon />
        </Button>
      </header>

      <div className="main-with-terminal">
        <div className="main-content">
          <Outlet />
        </div>

        {/* Right rail: terminal + assistant share the same collapsible pane.
            When expanded, only one panel is visible at a time. When collapsed,
            two stacked icon buttons let the user open either one. */}
        {!ctx.isMobile && (
          <>
            {ctx.rightRailOpen && (
              <>
                <div className="right-rail-drag-handle" onMouseDown={ctx.handleRightRailDragStart} />
                <div className="right-rail-side" style={{ width: ctx.rightRailWidth }}>
                  {ctx.terminalOpen && <TerminalPane onClose={ctx.handleToggleTerminal} />}
                  {ctx.assistantOpen && (
                    <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading assistant…</div>}>
                      <CopilotPanel onClose={ctx.handleToggleAssistant} />
                    </Suspense>
                  )}
                </div>
              </>
            )}
            <div className="right-rail-collapsed-bar" role="toolbar" aria-label="Right rail">
              <button
                className={`right-rail-btn ${ctx.terminalOpen ? "right-rail-btn-active" : ""}`}
                onClick={ctx.handleToggleTerminal}
                title={ctx.terminalOpen ? "Close terminal" : "Open terminal"}
                aria-label={ctx.terminalOpen ? "Close terminal" : "Open terminal"}
                aria-pressed={ctx.terminalOpen}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </button>
              <button
                className={`right-rail-btn ${ctx.assistantOpen ? "right-rail-btn-active" : ""}`}
                onClick={ctx.handleToggleAssistant}
                title={ctx.assistantOpen ? "Close assistant" : "Open assistant"}
                aria-label={ctx.assistantOpen ? "Close assistant" : "Open assistant"}
                aria-pressed={ctx.assistantOpen}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {/* Sparkle / assistant glyph */}
                  <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
                  <path d="M19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8L16.5 18.5l1.8-.7z" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Status bar */}
      <footer className="flex shrink-0 items-center gap-4 border-t border-border bg-card px-3 py-1 text-[11px] text-muted-foreground">
        {isPlans ? (
          <>
            <StatusBarItem tone="muted">
              {ctx.plans.length} plan{ctx.plans.length !== 1 ? "s" : ""}
            </StatusBarItem>
            <StatusBarItem tone="primary">
              {ctx.plans.filter((p) => p.status === "active").length} active
            </StatusBarItem>
            <StatusBarItem tone="warning">
              {ctx.plans.filter((p) => p.status === "draft").length} draft
            </StatusBarItem>
          </>
        ) : (
          <>
            <StatusBarItem tone="muted">
              {ctx.tickets.length} ticket{ctx.tickets.length !== 1 ? "s" : ""}
            </StatusBarItem>
            <StatusBarItem tone="primary">
              {ctx.tickets.filter((t) => t.status === "open").length} open
            </StatusBarItem>
            <StatusBarItem tone="warning">
              {ctx.tickets.filter((t) => t.status === "in-progress").length} in progress
            </StatusBarItem>
          </>
        )}
      </footer>

      {/* Global modals */}
      {ctx.isCreating && isTickets && (
        <CreateTicketModal
          meta={ctx.meta}
          defaultStatus={ctx.createDefaultStatus}
          onCreate={ctx.handleCreateTicket}
          onCancel={ctx.handleCancelCreate}
        />
      )}
      {ctx.isCreating && isPlans && (
        <CreatePlanModal
          planMeta={ctx.planMeta}
          onCreate={ctx.handleCreatePlan}
          onCancel={ctx.handleCancelCreate}
        />
      )}
      {ctx.showSettings && (
        <SettingsDialog
          config={ctx.config}
          onSave={ctx.handleSaveSettings}
          onClose={() => ctx.setShowSettings(false)}
        />
      )}
      {ctx.confirmDelete && (
        <DeleteConfirmDialog
          itemTitle={ctx.deleteItemTitle}
          itemType={ctx.deleteItemType}
          config={ctx.config}
          onConfirm={ctx.handleConfirmDelete}
          onCancel={ctx.handleCancelDelete}
        />
      )}
    </div>
  );
}

function StatusBarItem({
  tone,
  children,
}: {
  tone: "muted" | "primary" | "warning";
  children: React.ReactNode;
}) {
  const dotClass =
    tone === "primary"
      ? "bg-primary"
      : tone === "warning"
        ? "bg-amber-500"
        : "bg-muted-foreground";
  return (
    <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
      <span className={`size-1.5 shrink-0 rounded-full ${dotClass}`} />
      {children}
    </span>
  );
}
