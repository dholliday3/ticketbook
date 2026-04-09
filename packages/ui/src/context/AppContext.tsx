import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  fetchTasks,
  subscribeSSE,
  createTask,
  deleteTask,
  fetchConfig,
  patchConfig,
  fetchMeta,
  reorderTask,
  patchTask,
  patchPlan,
  fetchPlans,
  createPlan,
  deletePlan as apiDeletePlan,
  fetchPlanMeta,
} from "../api";
import type {
  Task,
  TicketbookConfig,
  Status,
  Priority,
  Meta,
  CreateTaskInput,
  Plan,
  PlanStatus,
  CreatePlanInput,
  PlanMeta,
} from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ViewMode = "list" | "board";

export type Filters = {
  status: Status[];
  project: string[];
  epic: string[];
  sprint: string[];
};

export type PlanFilters = {
  status: PlanStatus[];
  project: string[];
};

interface AppContextValue {
  // Data
  tasks: Task[];
  plans: Plan[];
  config: TicketbookConfig;
  meta: Meta;
  planMeta: PlanMeta;

  // Loaders
  loadTasks: () => Promise<void>;
  loadPlans: () => Promise<void>;

  // Selection / tabs
  openTabs: string[];
  activeTaskId: string | null;
  activePlanId: string | null;
  setActiveTaskId: (id: string | null) => void;
  setActivePlanId: (id: string | null) => void;

  // Create state
  isCreating: boolean;
  setIsCreating: (v: boolean) => void;
  createDefaultStatus: Status;
  setCreateDefaultStatus: (s: Status) => void;

  // Delete
  confirmDelete: string | null;
  setConfirmDelete: (id: string | null) => void;
  deleteItemTitle: string;
  deleteItemType: "task" | "plan";

  // Settings
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  hideItemBadges: boolean;
  toggleHideItemBadges: () => void;

  // Responsive
  isMobile: boolean;
  mobileShowDetail: boolean;

  // Right rail: terminal + assistant share the same collapsible pane.
  // Mutually exclusive — opening one closes the other.
  terminalOpen: boolean;
  assistantOpen: boolean;
  rightRailWidth: number;
  handleToggleTerminal: () => void;
  handleToggleAssistant: () => void;
  handleRightRailDragStart: (e: React.MouseEvent) => void;
  /** True iff either right-rail panel is currently expanded. */
  rightRailOpen: boolean;

  // Copilot input insertion — drives @-mention quick-add and preset
  // hand-off buttons. Detail views call `insertIntoCopilotInput(marker)`
  // or `prefillCopilotInput(text)` and the CopilotPanel consumes the
  // pending insertion on mount / when it changes.
  pendingCopilotInsertion:
    | { kind: "append"; text: string }
    | { kind: "replace"; text: string }
    | null;
  /** Append a marker (or other text) to the current copilot input at the end, with a leading space if needed. Opens the assistant panel. */
  insertIntoCopilotInput: (text: string) => void;
  /** Replace the full copilot input with a pre-filled template (e.g. "Get feedback"). Opens the assistant panel. */
  prefillCopilotInput: (text: string) => void;
  /** Called by CopilotPanel after it has consumed a pending insertion. */
  consumePendingCopilotInsertion: () => void;

  // Handlers
  handleSelect: (task: Task) => void;
  handleSelectPlan: (plan: Plan) => void;
  handleNewTask: () => void;
  handleNewPlan: () => void;
  handleCreateTask: (input: CreateTaskInput) => Promise<void>;
  handleCreatePlan: (input: CreatePlanInput) => Promise<void>;
  handleCreateInColumn: (status: Status) => void;
  handleCloseTab: (tabId: string) => void;
  handleDeleteRequest: (id: string) => void;
  handleConfirmDelete: () => Promise<void>;
  handleCancelDelete: () => void;
  handleCancelCreate: () => void;
  handleReorder: (taskId: string, afterId: string | null, beforeId: string | null) => Promise<void>;
  handleKanbanMove: (taskId: string, newStatus: Status, afterId: string | null, beforeId: string | null) => Promise<void>;
  handlePlanKanbanMove: (planId: string, newStatus: PlanStatus) => Promise<void>;
  handlePlanTaskClick: (taskId: string) => void;
  handleMobileBack: () => void;
  handleSaveSettings: (patch: Partial<TicketbookConfig>) => Promise<void>;

  // Refs
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

const AppContext = createContext<AppContextValue | null>(null);

const HIDE_ITEM_BADGES_STORAGE_KEY = "ticketbook-hide-item-badges";

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AppProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  // Data state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [config, setConfig] = useState<TicketbookConfig>({
    prefix: "TASK",
    deleteMode: "archive",
    debriefStyle: "very-concise",
  });
  const [meta, setMeta] = useState<Meta>({ projects: [], epics: [], sprints: [], tags: [] });
  const [planMeta, setPlanMeta] = useState<PlanMeta>({ projects: [], tags: [] });

  // Selection / UI
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createDefaultStatus, setCreateDefaultStatus] = useState<Status>("open");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [hideItemBadges, setHideItemBadges] = useState(() => {
    return localStorage.getItem(HIDE_ITEM_BADGES_STORAGE_KEY) === "true";
  });

  // Responsive
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);

  // Right rail: terminal + assistant share the same collapsible pane and
  // are mutually exclusive. We persist which one is open (or neither) and
  // the shared pane width across reloads. The legacy `ticketbook-terminal-*`
  // keys are read here for backwards-compat — `ticketbook-right-rail-*`
  // takes over going forward.
  const initialRightRail = (() => {
    const explicit = localStorage.getItem("ticketbook-right-rail");
    if (explicit === "terminal" || explicit === "assistant" || explicit === "closed") {
      return explicit;
    }
    // Migrate from the legacy single-button "terminal-open" flag.
    return localStorage.getItem("ticketbook-terminal-open") === "true" ? "terminal" : "closed";
  })();
  const [terminalOpen, setTerminalOpen] = useState(initialRightRail === "terminal");
  const [assistantOpen, setAssistantOpen] = useState(initialRightRail === "assistant");
  const [pendingCopilotInsertion, setPendingCopilotInsertion] = useState<
    { kind: "append"; text: string } | { kind: "replace"; text: string } | null
  >(null);
  const [rightRailWidth, setRightRailWidth] = useState(() => {
    const explicit = localStorage.getItem("ticketbook-right-rail-width");
    if (explicit) return parseInt(explicit, 10);
    return parseInt(localStorage.getItem("ticketbook-terminal-width") || "400", 10);
  });
  const isDraggingRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ---- Mobile breakpoint ----
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // ---- Data loaders ----
  const loadTasks = useCallback(async () => {
    try {
      const data = await fetchTasks();
      setTasks(data);
    } catch (err) {
      console.error("Failed to load tasks:", err);
    }
  }, []);

  const loadPlans = useCallback(async () => {
    try {
      const data = await fetchPlans();
      setPlans(data);
    } catch (err) {
      console.error("Failed to load plans:", err);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    loadPlans();
    fetchConfig().then(setConfig).catch(console.error);
    fetchMeta().then(setMeta).catch(console.error);
    fetchPlanMeta().then(setPlanMeta).catch(console.error);
  }, [loadTasks, loadPlans]);

  // SSE
  useEffect(() => {
    const unsub = subscribeSSE((event) => {
      if (event.source === "plan") {
        loadPlans();
        fetchPlanMeta().then(setPlanMeta).catch(console.error);
      } else {
        loadTasks();
        fetchMeta().then(setMeta).catch(console.error);
      }
    });
    return unsub;
  }, [loadTasks, loadPlans]);

  // ---- Derived ----
  const deleteItemTitle = confirmDelete
    ? (tasks.find((t) => t.id === confirmDelete)?.title
      ?? plans.find((p) => p.id === confirmDelete)?.title
      ?? confirmDelete)
    : "";
  const deleteItemType: "task" | "plan" =
    confirmDelete && plans.some((p) => p.id === confirmDelete) ? "plan" : "task";

  const toggleHideItemBadges = useCallback(() => {
    setHideItemBadges((prev) => {
      const next = !prev;
      localStorage.setItem(HIDE_ITEM_BADGES_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  // ---- Handlers ----

  const handleSelect = useCallback(
    (task: Task) => {
      setIsCreating(false);
      setActiveTaskId(task.id);
      setOpenTabs((tabs) => (tabs.includes(task.id) ? tabs : [...tabs, task.id]));
      if (isMobile) setMobileShowDetail(true);
    },
    [isMobile],
  );

  const handleSelectPlan = useCallback(
    (plan: Plan) => {
      setIsCreating(false);
      setActivePlanId(plan.id);
      setOpenTabs((tabs) => (tabs.includes(plan.id) ? tabs : [...tabs, plan.id]));
      if (isMobile) setMobileShowDetail(true);
    },
    [isMobile],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      setOpenTabs((tabs) => {
        const newTabs = tabs.filter((id) => id !== tabId);
        if (activeTaskId === tabId) {
          const idx = tabs.indexOf(tabId);
          const next = newTabs[Math.min(idx, newTabs.length - 1)] ?? null;
          setActiveTaskId(next);
        }
        if (activePlanId === tabId) {
          const idx = tabs.indexOf(tabId);
          const next = newTabs[Math.min(idx, newTabs.length - 1)] ?? null;
          setActivePlanId(next);
        }
        return newTabs;
      });
    },
    [activeTaskId, activePlanId],
  );

  const handleNewTask = useCallback(() => {
    setCreateDefaultStatus("open");
    setIsCreating(true);
    setActiveTaskId(null);
    if (isMobile) setMobileShowDetail(true);
  }, [isMobile]);

  const handleNewPlan = useCallback(() => {
    setIsCreating(true);
    setActivePlanId(null);
    if (isMobile) setMobileShowDetail(true);
  }, [isMobile]);

  const handleCreateTask = useCallback(
    async (input: CreateTaskInput) => {
      try {
        const task = await createTask(input);
        setIsCreating(false);
        await loadTasks();
        setActiveTaskId(task.id);
        setOpenTabs((tabs) => (tabs.includes(task.id) ? tabs : [...tabs, task.id]));
      } catch (err) {
        console.error("Failed to create task:", err);
      }
    },
    [loadTasks],
  );

  const handleCreatePlan = useCallback(
    async (input: CreatePlanInput) => {
      try {
        const plan = await createPlan(input);
        setIsCreating(false);
        await loadPlans();
        setActivePlanId(plan.id);
        setOpenTabs((tabs) => (tabs.includes(plan.id) ? tabs : [...tabs, plan.id]));
      } catch (err) {
        console.error("Failed to create plan:", err);
      }
    },
    [loadPlans],
  );

  const handleCreateInColumn = useCallback((status: Status) => {
    setCreateDefaultStatus(status);
    setIsCreating(true);
    setActiveTaskId(null);
  }, []);

  const handleCancelCreate = useCallback(() => {
    setIsCreating(false);
  }, []);

  const handleDeleteRequest = useCallback((id: string) => {
    setConfirmDelete(id);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDelete) return;
    const isPlan = plans.some((p) => p.id === confirmDelete);
    try {
      if (isPlan) {
        await apiDeletePlan(confirmDelete);
        setConfirmDelete(null);
        setActivePlanId(null);
        setOpenTabs((tabs) => tabs.filter((id) => id !== confirmDelete));
        await loadPlans();
      } else {
        await deleteTask(confirmDelete);
        setConfirmDelete(null);
        setActiveTaskId(null);
        setOpenTabs((tabs) => tabs.filter((id) => id !== confirmDelete));
        await loadTasks();
      }
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  }, [confirmDelete, plans, loadPlans, loadTasks]);

  const handleCancelDelete = useCallback(() => {
    setConfirmDelete(null);
  }, []);

  const handleReorder = useCallback(
    async (taskId: string, afterId: string | null, beforeId: string | null) => {
      const prevTickets = tasks;

      setTasks((current) => {
        const task = current.find((t) => t.id === taskId);
        if (!task) return current;

        const afterTicket = afterId ? current.find((t) => t.id === afterId) : null;
        const beforeTicket = beforeId ? current.find((t) => t.id === beforeId) : null;

        let newOrder: number;
        if (afterTicket?.order != null && beforeTicket?.order != null) {
          newOrder = (afterTicket.order + beforeTicket.order) / 2;
        } else if (afterTicket?.order != null) {
          newOrder = afterTicket.order + 1000;
        } else if (beforeTicket?.order != null) {
          newOrder = beforeTicket.order > 1000 ? beforeTicket.order - 1000 : beforeTicket.order / 2;
        } else {
          newOrder = 1000;
        }

        return current.map((t) => (t.id === taskId ? { ...t, order: newOrder } : t));
      });

      try {
        await reorderTask(taskId, afterId, beforeId);
        await loadTasks();
      } catch (err) {
        console.error("Failed to reorder task:", err);
        setTasks(prevTickets);
      }
    },
    [tasks, loadTasks],
  );

  const handleKanbanMove = useCallback(
    async (taskId: string, newStatus: Status, afterId: string | null, beforeId: string | null) => {
      const prevTickets = tasks;
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      const statusChanged = task.status !== newStatus;

      setTasks((current) => {
        const t = current.find((t) => t.id === taskId);
        if (!t) return current;

        const afterTicket = afterId ? current.find((t) => t.id === afterId) : null;
        const beforeTicket = beforeId ? current.find((t) => t.id === beforeId) : null;

        let newOrder: number;
        if (afterTicket?.order != null && beforeTicket?.order != null) {
          newOrder = (afterTicket.order + beforeTicket.order) / 2;
        } else if (afterTicket?.order != null) {
          newOrder = afterTicket.order + 1000;
        } else if (beforeTicket?.order != null) {
          newOrder = beforeTicket.order > 1000 ? beforeTicket.order - 1000 : beforeTicket.order / 2;
        } else {
          newOrder = 1000;
        }

        return current.map((t) => (t.id === taskId ? { ...t, status: newStatus, order: newOrder } : t));
      });

      try {
        if (statusChanged) {
          await patchTask(taskId, { status: newStatus });
        }
        await reorderTask(taskId, afterId, beforeId);
        await loadTasks();
      } catch (err) {
        console.error("Failed to move task:", err);
        setTasks(prevTickets);
      }
    },
    [tasks, loadTasks],
  );

  const handlePlanKanbanMove = useCallback(
    async (planId: string, newStatus: PlanStatus) => {
      const prevPlans = plans;
      setPlans((current) =>
        current.map((p) => (p.id === planId ? { ...p, status: newStatus } : p)),
      );
      try {
        await patchPlan(planId, { status: newStatus });
        await loadPlans();
      } catch (err) {
        console.error("Failed to move plan:", err);
        setPlans(prevPlans);
      }
    },
    [plans, loadPlans],
  );

  const handlePlanTaskClick = useCallback(
    (taskId: string) => {
      navigate({ to: "/tasks", search: { view: "list", status: [], project: [], epic: [], sprint: [] } });
      setActiveTaskId(taskId);
      setOpenTabs((tabs) => (tabs.includes(taskId) ? tabs : [...tabs, taskId]));
    },
    [navigate],
  );

  const handleMobileBack = useCallback(() => {
    setMobileShowDetail(false);
    setActiveTaskId(null);
    setIsCreating(false);
  }, []);

  // Persist which right-rail panel is currently open. Mutually exclusive —
  // opening one closes the other. "closed" means neither is open.
  const persistRightRail = useCallback((mode: "terminal" | "assistant" | "closed") => {
    localStorage.setItem("ticketbook-right-rail", mode);
  }, []);

  const handleToggleTerminal = useCallback(() => {
    setTerminalOpen((prev) => {
      const next = !prev;
      if (next) {
        setAssistantOpen(false);
        persistRightRail("terminal");
      } else {
        persistRightRail("closed");
      }
      return next;
    });
  }, [persistRightRail]);

  const handleToggleAssistant = useCallback(() => {
    setAssistantOpen((prev) => {
      const next = !prev;
      if (next) {
        setTerminalOpen(false);
        persistRightRail("assistant");
      } else {
        persistRightRail("closed");
      }
      return next;
    });
  }, [persistRightRail]);

  const openAssistant = useCallback(() => {
    setAssistantOpen((prev) => {
      if (prev) return prev;
      setTerminalOpen(false);
      persistRightRail("assistant");
      return true;
    });
  }, [persistRightRail]);

  const insertIntoCopilotInput = useCallback(
    (text: string) => {
      openAssistant();
      setPendingCopilotInsertion({ kind: "append", text });
    },
    [openAssistant],
  );

  const prefillCopilotInput = useCallback(
    (text: string) => {
      openAssistant();
      setPendingCopilotInsertion({ kind: "replace", text });
    },
    [openAssistant],
  );

  const consumePendingCopilotInsertion = useCallback(() => {
    setPendingCopilotInsertion(null);
  }, []);

  const handleRightRailDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      const startX = e.clientX;
      const startWidth = rightRailWidth;

      const onMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        const newWidth = Math.max(240, Math.min(window.innerWidth * 0.7, startWidth + delta));
        setRightRailWidth(newWidth);
      };
      const onUp = () => {
        isDraggingRef.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setRightRailWidth((w) => {
          localStorage.setItem("ticketbook-right-rail-width", String(w));
          return w;
        });
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [rightRailWidth],
  );

  const handleSaveSettings = useCallback(
    async (patch: Partial<TicketbookConfig>) => {
      const updated = await patchConfig(patch);
      setConfig(updated);
      setShowSettings(false);
    },
    [],
  );

  const value: AppContextValue = {
    tasks,
    plans,
    config,
    meta,
    planMeta,
    loadTasks,
    loadPlans,
    openTabs,
    activeTaskId,
    activePlanId,
    setActiveTaskId,
    setActivePlanId,
    isCreating,
    setIsCreating,
    createDefaultStatus,
    setCreateDefaultStatus,
    confirmDelete,
    setConfirmDelete,
    deleteItemTitle,
    deleteItemType,
    showSettings,
    setShowSettings,
    hideItemBadges,
    toggleHideItemBadges,
    isMobile,
    mobileShowDetail,
    terminalOpen,
    assistantOpen,
    rightRailOpen: terminalOpen || assistantOpen,
    rightRailWidth,
    handleToggleTerminal,
    handleToggleAssistant,
    handleRightRailDragStart,
    pendingCopilotInsertion,
    insertIntoCopilotInput,
    prefillCopilotInput,
    consumePendingCopilotInsertion,
    handleSelect,
    handleSelectPlan,
    handleNewTask,
    handleNewPlan,
    handleCreateTask,
    handleCreatePlan,
    handleCreateInColumn,
    handleCloseTab,
    handleDeleteRequest,
    handleConfirmDelete,
    handleCancelDelete,
    handleCancelCreate,
    handleReorder,
    handleKanbanMove,
    handlePlanKanbanMove,
    handlePlanTaskClick,
    handleMobileBack,
    handleSaveSettings,
    searchInputRef,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
