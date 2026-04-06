import { useState, useCallback, useEffect } from "react";
import { Terminal } from "./Terminal";

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
    <div className="terminal-pane">
      <div className="terminal-tab-bar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`terminal-tab ${tab.id === activeTabId ? "terminal-tab-active" : ""}`}
          >
            <button
              className="terminal-tab-label"
              onClick={() => setActiveTabId(tab.id)}
            >
              {tab.title}
            </button>
            <button
              className="terminal-tab-close"
              onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
              aria-label="Close terminal tab"
            >
              &times;
            </button>
          </div>
        ))}
        <button
          className="terminal-tab-add"
          onClick={handleAddTab}
          title="New terminal"
          aria-label="New terminal"
        >
          +
        </button>
        <div className="terminal-tab-spacer" />
        {onClose && (
          <button
            className="terminal-tab-close-pane"
            onClick={onClose}
            title="Close terminal"
            aria-label="Close terminal"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
      <div className="terminal-content">
        {activeTab && <Terminal key={activeTab.id} sessionId={activeTab.id} />}
      </div>
    </div>
  );
}
