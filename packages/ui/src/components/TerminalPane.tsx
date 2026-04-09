import { useState, useCallback, useEffect } from "react";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { Terminal } from "./Terminal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TerminalTab {
  id: string;
  title: string;
  alive: boolean;
}

async function fetchSessions(): Promise<TerminalTab[]> {
  try {
    const res = await fetch("/api/terminal/sessions");
    if (!res.ok) return [];
    const data = await res.json();
    return (data.sessions ?? []).map((s: any) => ({ id: s.id, title: s.title, alive: s.alive }));
  } catch {
    return [];
  }
}

async function createTabOnServer(sortOrder: number): Promise<TerminalTab | null> {
  try {
    const res = await fetch("/api/terminal/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { id: data.id, title: data.title, alive: false };
  } catch {
    return null;
  }
}

async function deleteTabOnServer(id: string): Promise<void> {
  try {
    await fetch("/api/terminal/sessions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  } catch { /* ignore */ }
}

interface TerminalPaneProps {
  onClose?: () => void;
}

export function TerminalPane({ onClose }: TerminalPaneProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, _setActiveTabId] = useState<string>("");
  const setActiveTabId = useCallback((id: string) => {
    _setActiveTabId(id);
    localStorage.setItem("ticketbook-active-terminal-tab", id);
  }, []);
  const [initialized, setInitialized] = useState(false);

  // On mount: fetch existing sessions from server (StrictMode-safe via cancelled flag)
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const serverTabs = await fetchSessions();
      if (cancelled) return;

      if (serverTabs.length > 0) {
        setTabs(serverTabs);
        const savedTabId = localStorage.getItem("ticketbook-active-terminal-tab");
        const restoredTab = savedTabId && serverTabs.some((t) => t.id === savedTabId) ? savedTabId : serverTabs[0].id;
        setActiveTabId(restoredTab);
      } else {
        const tab = await createTabOnServer(0);
        if (cancelled || !tab) return;
        setTabs([tab]);
        setActiveTabId(tab.id);
      }

      setInitialized(true);
    }

    init();
    return () => { cancelled = true; };
  }, [setActiveTabId]);

  const handleAddTab = useCallback(async () => {
    const tab = await createTabOnServer(tabs.length);
    if (!tab) return;
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [tabs.length, setActiveTabId]);

  const handleCloseTab = useCallback(async (id: string) => {
    if (tabs.length === 1) {
      // Last tab: close the pane, keep session alive for reattach
      onClose?.();
      return;
    }

    await deleteTabOnServer(id);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (id === activeTabId) {
        const idx = prev.findIndex((t) => t.id === id);
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveTabId(newActive.id);
      }
      return next;
    });
  }, [tabs.length, activeTabId, setActiveTabId, onClose]);

  if (!initialized) return null;

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center overflow-x-auto border-b border-white/10 bg-zinc-900 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={cn(
                "group/termtab flex max-w-[150px] shrink-0 items-center gap-0.5 border-r border-white/5",
                isActive && "bg-zinc-950",
              )}
            >
              <button
                type="button"
                className={cn(
                  "cursor-pointer truncate border-0 bg-transparent py-1.5 pl-2.5 pr-2 text-[11px] transition-colors",
                  isActive ? "text-white/90" : "text-white/40 hover:text-white/70",
                )}
                onClick={() => setActiveTabId(tab.id)}
              >
                {tab.title}
              </button>
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent px-1 py-0.5 text-xs leading-none text-white/20 opacity-0 transition-opacity group-hover/termtab:opacity-100 hover:text-white/70"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.id);
                }}
                aria-label="Close terminal tab"
              >
                &times;
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="shrink-0 cursor-pointer border-0 bg-transparent px-2 py-1 text-sm text-white/30 hover:text-white/70"
          onClick={handleAddTab}
          title="New terminal"
          aria-label="New terminal"
        >
          <PlusIcon className="size-3" />
        </button>
        <div className="flex-1" />
        {onClose && (
          <button
            type="button"
            className="flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent px-2 py-1 text-white/30 hover:text-white/70"
            onClick={onClose}
            title="Close terminal"
            aria-label="Close terminal"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {activeTab && <Terminal key={activeTab.id} sessionId={activeTab.id} />}
      </div>
    </div>
  );
}
