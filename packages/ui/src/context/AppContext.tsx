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
  fetchDocs,
  createDoc,
  deleteDoc as apiDeleteDoc,
  fetchDocMeta,
} from "../api";
import type {
  Task,
  RelayConfig,
  Status,
  Priority,
  Meta,
  CreateTaskInput,
  Plan,
  PlanStatus,
  CreatePlanInput,
  PlanMeta,
  Doc,
  CreateDocInput,
  DocMeta,
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
  docs: Doc[];
  config: RelayConfig;
  meta: Meta;
  planMeta: PlanMeta;
  docMeta: DocMeta;

  // Loaders
  loadTasks: () => Promise<void>;
  loadPlans: () => Promise<void>;
  loadDocs: () => Promise<void>;

  // Selection / tabs
  openTabs: string[];
  activeTaskId: string | null;
  activePlanId: string | null;
  activeDocId: string | null;
  setActiveTaskId: (id: string | null) => void;
  setActivePlanId: (id: string | null) => void;
  setActiveDocId: (id: string | null) => void;

  // Create state
  isCreating: boolean;
  setIsCreating: (v: boolean) => void;
  createDefaultStatus: Status;
  setCreateDefaultStatus: (s: Status) => void;

  // Delete
  confirmDelete: string | null;
  setConfirmDelete: (id: string | null) => void;
  deleteItemTitle: string;
  deleteItemType: "task" | "plan" | "doc";

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
  // hand-off buttons. Detail views call `insertIntoCopilotInput(text)`
  // and the CopilotPanel consumes the pending insertion on mount /
  // when it changes.
  pendingCopilotInsertion:
    | { kind: "append"; text: string }
    | { kind: "replace"; text: string }
    | null;
  /** Append a marker (or other text) to the current copilot input at the end, with a leading space if needed. Opens the assistant panel. */
  insertIntoCopilotInput: (text: string) => void;
  /** Called by CopilotPanel after it has consumed a pending insertion. */
  consumePendingCopilotInsertion: () => void;

  // Handlers
  handleSelect: (task: Task) => void;
  handleSelectPlan: (plan: Plan) => void;
  handleSelectDoc: (doc: Doc) => void;
  handleNewTask: () => void;
  handleNewPlan: () => void;
  handleNewDoc: () => void;
  handleCreateTask: (input: CreateTaskInput) => Promise<void>;
  handleCreatePlan: (input: CreatePlanInput) => Promise<void>;
  handleCreateDoc: (input: CreateDocInput) => Promise<void>;
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
  handleSaveSettings: (patch: Partial<RelayConfig>) => Promise<void>;

  // Refs
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

const AppContext = createContext<AppContextValue | null>(null);

const HIDE_ITEM_BADGES_STORAGE_KEY = "relay-hide-item-badges";

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
  const [docs, setDocs] = useState<Doc[]>([]);
  const [config, setConfig] = useState<RelayConfig>({
    prefix: "TASK",
    deleteMode: "archive",
    debriefStyle: "very-concise",
    worktreeMode: "local",
  });
  const [meta, setMeta] = useState<Meta>({ projects: [], epics: [], sprints: [], tags: [] });
  const [planMeta, setPlanMeta] = useState<PlanMeta>({ projects: [], tags: [] });
  const [docMeta, setDocMeta] = useState<DocMeta>({ projects: [], tags: [] });

  // Selection / UI
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
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
  // the shared pane width across reloads. The legacy `relay-terminal-*`
  // keys are read here for backwards-compat — `relay-right-rail-*`
  // takes over going forward.
  const initialRightRail = (() => {
    const explicit = localStorage.getItem("relay-right-rail");
    if (explicit === "terminal" || explicit === "assistant" || explicit === "closed") {
      return explicit;
    }
    // Migrate from the legacy single-button "terminal-open" flag.
    return localStorage.getItem("relay-terminal-open") === "true" ? "terminal" : "closed";
  })();
  const [terminalOpen, setTerminalOpen] = useState(initialRightRail === "terminal");
  const [assistantOpen, setAssistantOpen] = useState(initialRightRail === "assistant");
  const [pendingCopilotInsertion, setPendingCopilotInsertion] = useState<
    { kind: "append"; text: string } | { kind: "replace"; text: string } | null
  >(null);
  const [rightRailWidth, setRightRailWidth] = useState(() => {
    const explicit = localStorage.getItem("relay-right-rail-width");
    if (explicit) return parseInt(explicit, 10);
    return parseInt(localStorage.getItem("relay-terminal-width") || "400", 10);
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

  const loadDocs = useCallback(async () => {
    try {
      const data = await fetchDocs();
      setDocs(data);
    } catch (err) {
      console.error("Failed to load docs:", err);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    loadPlans();
    loadDocs();
    fetchConfig().then(setConfig).catch(console.error);
    fetchMeta().then(setMeta).catch(console.error);
    fetchPlanMeta().then(setPlanMeta).catch(console.error);
    fetchDocMeta().then(setDocMeta).catch(console.error);
  }, [loadTasks, loadPlans, loadDocs]);

  // SSE
  useEffect(() => {
    const unsub = subscribeSSE((event) => {
      if (event.source === "plan") {
        loadPlans();
        fetchPlanMeta().then(setPlanMeta).catch(console.error);
      } else if (event.source === "doc") {
        loadDocs();
        fetchDocMeta().then(setDocMeta).catch(console.error);
      } else {
        loadTasks();
        fetchMeta().then(setMeta).catch(console.error);
      }
    });
    return unsub;
  }, [loadTasks, loadPlans, loadDocs]);

  // ---- Derived ----
  const deleteItemTitle = confirmDelete
    ? (tasks.find((t) => t.id === confirmDelete)?.title
      ?? plans.find((p) => p.id === confirmDelete)?.title
      ?? docs.find((d) => d.id === confirmDelete)?.title
      ?? confirmDelete)
    : "";
  const deleteItemType: "task" | "plan" | "doc" =
    confirmDelete && plans.some((p) => p.id === confirmDelete)
      ? "plan"
      : confirmDelete && docs.some((d) => d.id === confirmDelete)
        ? "doc"
        : "task";

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

  const handleSelectDoc = useCallback(
    (doc: Doc) => {
      setIsCreating(false);
      setActiveDocId(doc.id);
      setOpenTabs((tabs) => (tabs.includes(doc.id) ? tabs : [...tabs, doc.id]));
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
        if (activeDocId === tabId) {
          const idx = tabs.indexOf(tabId);
          const next = newTabs[Math.min(idx, newTabs.length - 1)] ?? null;
          setActiveDocId(next);
        }
        return newTabs;
      });
    },
    [activeTaskId, activePlanId, activeDocId],
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

  const handleNewDoc = useCallback(() => {
    setIsCreating(true);
    setActiveDocId(null);
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

  const handleCreateDoc = useCallback(
    async (input: CreateDocInput) => {
      try {
        const doc = await createDoc(input);
        setIsCreating(false);
        await loadDocs();
        setActiveDocId(doc.id);
        setOpenTabs((tabs) => (tabs.includes(doc.id) ? tabs : [...tabs, doc.id]));
      } catch (err) {
        console.error("Failed to create doc:", err);
      }
    },
    [loadDocs],
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
    const isDoc = docs.some((d) => d.id === confirmDelete);
    try {
      if (isPlan) {
        await apiDeletePlan(confirmDelete);
        setConfirmDelete(null);
        setActivePlanId(null);
        setOpenTabs((tabs) => tabs.filter((id) => id !== confirmDelete));
        await loadPlans();
      } else if (isDoc) {
        await apiDeleteDoc(confirmDelete);
        setConfirmDelete(null);
        setActiveDocId(null);
        setOpenTabs((tabs) => tabs.filter((id) => id !== confirmDelete));
        await loadDocs();
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
  }, [confirmDelete, plans, docs, loadPlans, loadDocs, loadTasks]);

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
    setActivePlanId(null);
    setActiveDocId(null);
    setIsCreating(false);
  }, []);

  // Persist which right-rail panel is currently open. Mutually exclusive —
  // opening one closes the other. "closed" means neither is open.
  const persistRightRail = useCallback((mode: "terminal" | "assistant" | "closed") => {
    localStorage.setItem("relay-right-rail", mode);
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
          localStorage.setItem("relay-right-rail-width", String(w));
          return w;
        });
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [rightRailWidth],
  );

  const handleSaveSettings = useCallback(
    async (patch: Partial<RelayConfig>) => {
      const updated = await patchConfig(patch);
      setConfig(updated);
      setShowSettings(false);
    },
    [],
  );

  const value: AppContextValue = {
    tasks,
    plans,
    docs,
    config,
    meta,
    planMeta,
    docMeta,
    loadTasks,
    loadPlans,
    loadDocs,
    openTabs,
    activeTaskId,
    activePlanId,
    activeDocId,
    setActiveTaskId,
    setActivePlanId,
    setActiveDocId,
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
    consumePendingCopilotInsertion,
    handleSelect,
    handleSelectPlan,
    handleSelectDoc,
    handleNewTask,
    handleNewPlan,
    handleNewDoc,
    handleCreateTask,
    handleCreatePlan,
    handleCreateDoc,
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
