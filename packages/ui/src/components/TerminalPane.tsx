import { useState, useCallback, useEffect } from "react";
import { Terminal } from "./Terminal";

interface TerminalTab {
  id: string;
  title: string;
  alive: boolean;
}

let nextTabNum = 1;

function generateTabId(): string {
  return `term-${Date.now()}-${nextTabNum}`;
}

function generateTabTitle(): string {
  return `Terminal ${nextTabNum++}`;
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

async function createTabOnServer(id: string, title: string, sortOrder: number): Promise<void> {
  try {
    await fetch("/api/terminal/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title, sortOrder }),
    });
  } catch { /* ignore */ }
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
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [initialized, setInitialized] = useState(false);

  // On mount: fetch existing sessions from server
  useEffect(() => {
    async function init() {
      const serverTabs = await fetchSessions();

      if (serverTabs.length > 0) {
        // Recover tab numbering from existing titles
        const maxNum = serverTabs.reduce((max, t) => {
          const m = t.title.match(/Terminal (\d+)/);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0);
        nextTabNum = maxNum + 1;

        setTabs(serverTabs);
        setActiveTabId(serverTabs[0].id);
      } else {
        // No existing sessions — create a fresh one
        const id = generateTabId();
        const title = generateTabTitle();
        await createTabOnServer(id, title, 0);
        setTabs([{ id, title, alive: false }]);
        setActiveTabId(id);
      }

      setInitialized(true);
    }

    init();
  }, []);

  const handleAddTab = useCallback(async () => {
    const id = generateTabId();
    const title = generateTabTitle();
    const sortOrder = tabs.length;
    await createTabOnServer(id, title, sortOrder);
    setTabs((prev) => [...prev, { id, title, alive: false }]);
    setActiveTabId(id);
  }, [tabs.length]);

  const handleCloseTab = useCallback(async (id: string) => {
    await deleteTabOnServer(id);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        // Create a fresh tab
        const newId = generateTabId();
        const title = generateTabTitle();
        createTabOnServer(newId, title, 0);
        setActiveTabId(newId);
        return [{ id: newId, title, alive: false }];
      }
      if (id === activeTabId) {
        const idx = prev.findIndex((t) => t.id === id);
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveTabId(newActive.id);
      }
      return next;
    });
  }, [activeTabId]);

  if (!initialized) return null;

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
        {tabs.map((tab) => (
          <Terminal
            key={tab.id}
            sessionId={tab.id}
            isVisible={tab.id === activeTabId}
          />
        ))}
      </div>
    </div>
  );
}
