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
import { CreateTaskModal } from "../components/CreateTaskModal";
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
import { Switch } from "@/components/ui/switch";

// Lazy-loaded so the ai-elements/streamdown/shiki tree (~1MB+) only loads
// when the user opens the assistant panel for the first time. Without this
// the initial bundle balloons by ~5x.
const CopilotPanel = lazy(() =>
  import("../components/CopilotPanel").then((m) => ({ default: m.CopilotPanel })),
);
import { patchTask } from "../api";
import type { Status, Priority, Task } from "../types";
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
  const tasksMatch = useMatch({ from: "/tasks", shouldThrow: false });
  const plansMatch = useMatch({ from: "/plans", shouldThrow: false });
  const indexMatch = useMatch({ from: "/", shouldThrow: false });

  const isHome = indexMatch != null && !tasksMatch && !plansMatch;
  const isTasks = tasksMatch != null;
  const isPlans = plansMatch != null;

  // Read search params from matched routes
  const tasksSearch = (tasksMatch as any)?.search as
    | { view?: string; status?: string[]; project?: string[]; epic?: string[]; sprint?: string[]; q?: string }
    | undefined;
  const plansSearch = (plansMatch as any)?.search as
    | { view?: string; status?: string[]; project?: string[]; q?: string }
    | undefined;

  const currentView: ViewMode =
    isTasks
      ? (tasksSearch?.view === "board" ? "board" : "list")
      : isPlans
        ? (plansSearch?.view === "board" ? "board" : "list")
        : "list";

  // Search input with debounce
  const currentQ = isTasks ? (tasksSearch?.q ?? "") : isPlans ? (plansSearch?.q ?? "") : "";
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
        if (isTasks) {
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
  const taskFilters = {
    status: tasksSearch?.status ?? [],
    project: tasksSearch?.project ?? [],
    epic: tasksSearch?.epic ?? [],
    sprint: tasksSearch?.sprint ?? [],
  };
  const planFilterState = {
    status: plansSearch?.status ?? [],
    project: plansSearch?.project ?? [],
  };

  const hasActiveFilters =
    isTasks
      ? (taskFilters.status.length > 0 || taskFilters.project.length > 0 || taskFilters.epic.length > 0 || taskFilters.sprint.length > 0)
      : isPlans
        ? (planFilterState.status.length > 0 || planFilterState.project.length > 0)
        : false;

  // Filtered counts (for result badge)
  const filteredTaskCount = useMemo(() => {
    if (!isTasks) return 0;
    return ctx.tasks.filter((t) => {
      if (currentQ) {
        const q = currentQ.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !t.body.toLowerCase().includes(q)) return false;
      }
      if (taskFilters.status.length > 0 && !taskFilters.status.includes(t.status)) return false;
      if (taskFilters.project.length > 0 && (!t.project || !taskFilters.project.includes(t.project))) return false;
      if (taskFilters.epic.length > 0 && (!t.epic || !taskFilters.epic.includes(t.epic))) return false;
      if (taskFilters.sprint.length > 0 && (!t.sprint || !taskFilters.sprint.includes(t.sprint))) return false;
      return true;
    }).length;
  }, [isTasks, ctx.tasks, currentQ, taskFilters]);

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
  const toggleTaskFilter = useCallback(
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
      if (isTasks) {
        navigate({ to: "/tasks", search: (prev: any) => ({ ...prev, view: mode === "list" ? undefined : mode }) });
      } else if (isPlans) {
        navigate({ to: "/plans", search: (prev: any) => ({ ...prev, view: mode === "list" ? undefined : mode }) });
      }
    },
    [navigate, isTasks, isPlans],
  );

  // Flat task list for keyboard nav (only in tasks route)
  const flatTaskList = useMemo(() => {
    if (!isTasks) return [];
    const statusOrder: Status[] =
      currentView === "board"
        ? ["draft", "backlog", "open", "in-progress", "done", "cancelled"]
        : ["in-progress", "open", "backlog", "draft", "done", "cancelled"];
    const priorityRank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    const filtered = ctx.tasks.filter((t) => {
      if (currentQ) {
        const q = currentQ.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !t.body.toLowerCase().includes(q)) return false;
      }
      if (taskFilters.status.length > 0 && !taskFilters.status.includes(t.status)) return false;
      if (taskFilters.project.length > 0 && (!t.project || !taskFilters.project.includes(t.project))) return false;
      if (taskFilters.epic.length > 0 && (!t.epic || !taskFilters.epic.includes(t.epic))) return false;
      if (taskFilters.sprint.length > 0 && (!t.sprint || !taskFilters.sprint.includes(t.sprint))) return false;
      return true;
    });
    const result: Task[] = [];
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
  }, [isTasks, ctx.tasks, currentView, currentQ, taskFilters]);

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
        ctx.setActiveTaskId(null);
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
          ctx.setActiveTaskId(null);
        }
        return;
      }

      // Up/Down: navigate task list (only on tasks route)
      if (isTasks && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        if (flatTaskList.length === 0) return;
        const currentIndex = ctx.activeTaskId
          ? flatTaskList.findIndex((t) => t.id === ctx.activeTaskId)
          : -1;
        let nextIndex: number;
        if (e.key === "ArrowDown") {
          nextIndex = currentIndex < flatTaskList.length - 1 ? currentIndex + 1 : currentIndex;
        } else {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
        }
        ctx.setActiveTaskId(flatTaskList[nextIndex].id);
        ctx.setIsCreating(false);
        setTimeout(() => {
          document
            .querySelector(".ticket-row.active, .kanban-card.active")
            ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }, 0);
        return;
      }

      // Enter: open selected task
      if (isTasks && e.key === "Enter" && ctx.activeTaskId) {
        e.preventDefault();
        setTimeout(() => {
          const editor = document.querySelector(".tiptap-editor .ProseMirror") as HTMLElement;
          editor?.focus();
        }, 50);
        return;
      }

      // 1-4: set priority when a task is selected
      if (isTasks && ctx.activeTaskId && e.key >= "1" && e.key <= "4") {
        const priorityMap: Record<string, Priority> = {
          "1": "urgent",
          "2": "high",
          "3": "medium",
          "4": "low",
        };
        const priority = priorityMap[e.key];
        if (priority) {
          patchTask(ctx.activeTaskId, { priority })
            .then(() => ctx.loadTasks())
            .catch(console.error);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    ctx.activeTaskId,
    ctx.isCreating,
    ctx.confirmDelete,
    flatTaskList,
    handleViewModeChange,
    isTasks,
    isPlans,
    ctx,
  ]);

  // Determine space string for the + button / status bar
  const space = isPlans ? "plans" : "tasks";

  return (
    <div className="flex h-full flex-col">
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
            variant={isTasks ? "default" : "outline"}
            onClick={() => navigate({ to: "/tasks", search: { view: "list", status: [], project: [], epic: [], sprint: [] } })}
            role="radio"
            aria-checked={isTasks}
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
            {isTasks ? (
              <>
                <FilterChip
                  label="Status"
                  options={["draft", "backlog", "open", "in-progress", "done", "cancelled"]}
                  selected={taskFilters.status}
                  onToggle={(v) => toggleTaskFilter("status", v)}
                />
                <FilterChip
                  label="Project"
                  options={ctx.meta.projects}
                  selected={taskFilters.project}
                  onToggle={(v) => toggleTaskFilter("project", v)}
                />
                <FilterChip
                  label="Epic"
                  options={ctx.meta.epics}
                  selected={taskFilters.epic}
                  onToggle={(v) => toggleTaskFilter("epic", v)}
                />
                <FilterChip
                  label="Sprint"
                  options={ctx.meta.sprints}
                  selected={taskFilters.sprint}
                  onToggle={(v) => toggleTaskFilter("sprint", v)}
                />
                <label
                  className="ml-1 inline-flex shrink-0 items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground"
                  title={ctx.hideItemBadges ? "Show plan and task badges" : "Hide plan and task badges"}
                >
                  <Switch
                    checked={ctx.hideItemBadges}
                    onCheckedChange={(checked) => {
                      if (checked !== ctx.hideItemBadges) ctx.toggleHideItemBadges();
                    }}
                    aria-label="Hide badges"
                  />
                  <span className="whitespace-nowrap">Hide badges</span>
                </label>
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
                <label
                  className="ml-1 inline-flex shrink-0 items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground"
                  title={ctx.hideItemBadges ? "Show plan and task badges" : "Hide plan and task badges"}
                >
                  <Switch
                    checked={ctx.hideItemBadges}
                    onCheckedChange={(checked) => {
                      if (checked !== ctx.hideItemBadges) ctx.toggleHideItemBadges();
                    }}
                    aria-label="Hide badges"
                  />
                  <span className="whitespace-nowrap">Hide badges</span>
                </label>
              </>
            ) : null}
          </div>
        )}
        <div className="flex-1" />
        {!isHome && (
          <Button
            variant="outline"
            size="icon"
            onClick={isPlans ? ctx.handleNewPlan : ctx.handleNewTask}
            title={isPlans ? "New plan (C)" : "New task (C)"}
            aria-label={isPlans ? "New plan" : "New task"}
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
                  {isTasks
                    ? `${filteredTaskCount} result${filteredTaskCount !== 1 ? "s" : ""}`
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
              {ctx.tasks.length} task{ctx.tasks.length !== 1 ? "s" : ""}
            </StatusBarItem>
            <StatusBarItem tone="primary">
              {ctx.tasks.filter((t) => t.status === "open").length} open
            </StatusBarItem>
            <StatusBarItem tone="warning">
              {ctx.tasks.filter((t) => t.status === "in-progress").length} in progress
            </StatusBarItem>
          </>
        )}
      </footer>

      {/* Global modals */}
      {ctx.isCreating && isTasks && (
        <CreateTaskModal
          meta={ctx.meta}
          defaultStatus={ctx.createDefaultStatus}
          onCreate={ctx.handleCreateTask}
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
