import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  fetchTickets,
  subscribeSSE,
  createTicket,
  deleteTicket,
  fetchConfig,
  patchConfig,
  fetchMeta,
  reorderTicket,
  patchTicket,
  patchPlan,
  fetchPlans,
  createPlan,
  deletePlan as apiDeletePlan,
  fetchPlanMeta,
} from "../api";
import type {
  Ticket,
  TicketbookConfig,
  Status,
  Priority,
  Meta,
  CreateTicketInput,
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
  tickets: Ticket[];
  plans: Plan[];
  config: TicketbookConfig;
  meta: Meta;
  planMeta: PlanMeta;

  // Loaders
  loadTickets: () => Promise<void>;
  loadPlans: () => Promise<void>;

  // Selection / tabs
  openTabs: string[];
  activeTicketId: string | null;
  activePlanId: string | null;
  setActiveTicketId: (id: string | null) => void;
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
  deleteItemType: "ticket" | "plan";

  // Settings
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;

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

  // Handlers
  handleSelect: (ticket: Ticket) => void;
  handleSelectPlan: (plan: Plan) => void;
  handleNewTicket: () => void;
  handleNewPlan: () => void;
  handleCreateTicket: (input: CreateTicketInput) => Promise<void>;
  handleCreatePlan: (input: CreatePlanInput) => Promise<void>;
  handleCreateInColumn: (status: Status) => void;
  handleCloseTab: (tabId: string) => void;
  handleDeleteRequest: (id: string) => void;
  handleConfirmDelete: () => Promise<void>;
  handleCancelDelete: () => void;
  handleCancelCreate: () => void;
  handleReorder: (ticketId: string, afterId: string | null, beforeId: string | null) => Promise<void>;
  handleKanbanMove: (ticketId: string, newStatus: Status, afterId: string | null, beforeId: string | null) => Promise<void>;
  handlePlanKanbanMove: (planId: string, newStatus: PlanStatus) => Promise<void>;
  handlePlanTicketClick: (ticketId: string) => void;
  handleMobileBack: () => void;
  handleSaveSettings: (patch: Partial<TicketbookConfig>) => Promise<void>;

  // Refs
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

const AppContext = createContext<AppContextValue | null>(null);

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
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [config, setConfig] = useState<TicketbookConfig>({
    prefix: "TKT",
    deleteMode: "archive",
    debriefStyle: "very-concise",
  });
  const [meta, setMeta] = useState<Meta>({ projects: [], epics: [], sprints: [], tags: [] });
  const [planMeta, setPlanMeta] = useState<PlanMeta>({ projects: [], tags: [] });

  // Selection / UI
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createDefaultStatus, setCreateDefaultStatus] = useState<Status>("open");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

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
  const loadTickets = useCallback(async () => {
    try {
      const data = await fetchTickets();
      setTickets(data);
    } catch (err) {
      console.error("Failed to load tickets:", err);
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
    loadTickets();
    loadPlans();
    fetchConfig().then(setConfig).catch(console.error);
    fetchMeta().then(setMeta).catch(console.error);
    fetchPlanMeta().then(setPlanMeta).catch(console.error);
  }, [loadTickets, loadPlans]);

  // SSE
  useEffect(() => {
    const unsub = subscribeSSE((event) => {
      if (event.source === "plan") {
        loadPlans();
        fetchPlanMeta().then(setPlanMeta).catch(console.error);
      } else {
        loadTickets();
        fetchMeta().then(setMeta).catch(console.error);
      }
    });
    return unsub;
  }, [loadTickets, loadPlans]);

  // ---- Derived ----
  const deleteItemTitle = confirmDelete
    ? (tickets.find((t) => t.id === confirmDelete)?.title
      ?? plans.find((p) => p.id === confirmDelete)?.title
      ?? confirmDelete)
    : "";
  const deleteItemType: "ticket" | "plan" =
    confirmDelete && plans.some((p) => p.id === confirmDelete) ? "plan" : "ticket";

  // ---- Handlers ----

  const handleSelect = useCallback(
    (ticket: Ticket) => {
      setIsCreating(false);
      setActiveTicketId(ticket.id);
      setOpenTabs((tabs) => (tabs.includes(ticket.id) ? tabs : [...tabs, ticket.id]));
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
        if (activeTicketId === tabId) {
          const idx = tabs.indexOf(tabId);
          const next = newTabs[Math.min(idx, newTabs.length - 1)] ?? null;
          setActiveTicketId(next);
        }
        if (activePlanId === tabId) {
          const idx = tabs.indexOf(tabId);
          const next = newTabs[Math.min(idx, newTabs.length - 1)] ?? null;
          setActivePlanId(next);
        }
        return newTabs;
      });
    },
    [activeTicketId, activePlanId],
  );

  const handleNewTicket = useCallback(() => {
    setCreateDefaultStatus("open");
    setIsCreating(true);
    setActiveTicketId(null);
    if (isMobile) setMobileShowDetail(true);
  }, [isMobile]);

  const handleNewPlan = useCallback(() => {
    setIsCreating(true);
    setActivePlanId(null);
    if (isMobile) setMobileShowDetail(true);
  }, [isMobile]);

  const handleCreateTicket = useCallback(
    async (input: CreateTicketInput) => {
      try {
        const ticket = await createTicket(input);
        setIsCreating(false);
        await loadTickets();
        setActiveTicketId(ticket.id);
        setOpenTabs((tabs) => (tabs.includes(ticket.id) ? tabs : [...tabs, ticket.id]));
      } catch (err) {
        console.error("Failed to create ticket:", err);
      }
    },
    [loadTickets],
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
    setActiveTicketId(null);
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
        await deleteTicket(confirmDelete);
        setConfirmDelete(null);
        setActiveTicketId(null);
        setOpenTabs((tabs) => tabs.filter((id) => id !== confirmDelete));
        await loadTickets();
      }
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  }, [confirmDelete, plans, loadPlans, loadTickets]);

  const handleCancelDelete = useCallback(() => {
    setConfirmDelete(null);
  }, []);

  const handleReorder = useCallback(
    async (ticketId: string, afterId: string | null, beforeId: string | null) => {
      const prevTickets = tickets;

      setTickets((current) => {
        const ticket = current.find((t) => t.id === ticketId);
        if (!ticket) return current;

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

        return current.map((t) => (t.id === ticketId ? { ...t, order: newOrder } : t));
      });

      try {
        await reorderTicket(ticketId, afterId, beforeId);
        await loadTickets();
      } catch (err) {
        console.error("Failed to reorder ticket:", err);
        setTickets(prevTickets);
      }
    },
    [tickets, loadTickets],
  );

  const handleKanbanMove = useCallback(
    async (ticketId: string, newStatus: Status, afterId: string | null, beforeId: string | null) => {
      const prevTickets = tickets;
      const ticket = tickets.find((t) => t.id === ticketId);
      if (!ticket) return;

      const statusChanged = ticket.status !== newStatus;

      setTickets((current) => {
        const t = current.find((t) => t.id === ticketId);
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

        return current.map((t) => (t.id === ticketId ? { ...t, status: newStatus, order: newOrder } : t));
      });

      try {
        if (statusChanged) {
          await patchTicket(ticketId, { status: newStatus });
        }
        await reorderTicket(ticketId, afterId, beforeId);
        await loadTickets();
      } catch (err) {
        console.error("Failed to move ticket:", err);
        setTickets(prevTickets);
      }
    },
    [tickets, loadTickets],
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

  const handlePlanTicketClick = useCallback(
    (ticketId: string) => {
      navigate({ to: "/tickets", search: { view: "list", status: [], project: [], epic: [], sprint: [] } });
      setActiveTicketId(ticketId);
      setOpenTabs((tabs) => (tabs.includes(ticketId) ? tabs : [...tabs, ticketId]));
    },
    [navigate],
  );

  const handleMobileBack = useCallback(() => {
    setMobileShowDetail(false);
    setActiveTicketId(null);
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
    tickets,
    plans,
    config,
    meta,
    planMeta,
    loadTickets,
    loadPlans,
    openTabs,
    activeTicketId,
    activePlanId,
    setActiveTicketId,
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
    isMobile,
    mobileShowDetail,
    terminalOpen,
    assistantOpen,
    rightRailOpen: terminalOpen || assistantOpen,
    rightRailWidth,
    handleToggleTerminal,
    handleToggleAssistant,
    handleRightRailDragStart,
    handleSelect,
    handleSelectPlan,
    handleNewTicket,
    handleNewPlan,
    handleCreateTicket,
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
    handlePlanTicketClick,
    handleMobileBack,
    handleSaveSettings,
    searchInputRef,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
