import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  sessionId: string;
}

// E2E test instrumentation: expose xterm instances on window for Playwright.
// Gated on DEV (always on during `bun run dev`) OR the __RELAY_E2E__ flag
// (which Playwright sets via addInitScript before navigation). In production
// builds without the flag, this is dead code.
function e2eExposed(): boolean {
  return import.meta.env.DEV || (window as unknown as { __RELAY_E2E__?: boolean }).__RELAY_E2E__ === true;
}
function e2eRegister(sessionId: string, term: XTerm): void {
  if (!e2eExposed()) return;
  const w = window as unknown as { __terminals?: Map<string, XTerm> };
  (w.__terminals ??= new Map()).set(sessionId, term);
}
function e2eUnregister(sessionId: string): void {
  if (!e2eExposed()) return;
  const w = window as unknown as { __terminals?: Map<string, XTerm>; __terminalsReady?: Map<string, boolean> };
  w.__terminals?.delete(sessionId);
  w.__terminalsReady?.delete(sessionId);
}
function e2eMarkReady(sessionId: string): void {
  if (!e2eExposed()) return;
  const w = window as unknown as { __terminalsReady?: Map<string, boolean> };
  (w.__terminalsReady ??= new Map()).set(sessionId, true);
}

export function Terminal({ sessionId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: "#1a1a2e",
        foreground: "#e0e0e0",
        cursor: "#e0e0e0",
        selectionBackground: "#3a3a5c",
        black: "#1a1a2e",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e0e0e0",
        brightBlack: "#6b7280",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    xtermRef.current = term;
    fitRef.current = fit;
    e2eRegister(sessionId, term);

    // Connect WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/terminal/${encodeURIComponent(sessionId)}`);
    wsRef.current = ws;

    ws.onerror = () => {
      // Connection error — will trigger onclose
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output" || msg.type === "replay") {
          term.write(msg.data);
        } else if (msg.type === "ready") {
          term.focus();
          e2eMarkReady(sessionId);
        }
      } catch {
        // ignore
      }
    };

    ws.onopen = () => {
      // Handshake: measure real container dimensions and send to server
      // Server will not spawn/reattach the PTY until it receives this
      let attempts = 0;
      const sendInit = () => {
        try {
          fit.fit();
          if (term.cols >= 20 || attempts >= 10) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "init", cols: term.cols, rows: term.rows }));
            }
          } else {
            attempts++;
            requestAnimationFrame(sendInit);
          }
        } catch { /* ignore */ }
      };
      requestAnimationFrame(sendInit);
    };

    // Forward user input to server
    const inputDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Handle resize — debounced to reduce noise during panel drag
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      }, 100);
    });

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      inputDisposable.dispose();
      resizeDisposable.dispose();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, "tab closed");
      }
      e2eUnregister(sessionId);
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [sessionId]);

  // Re-fit on container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      const fit = fitRef.current;
      if (!fit) return;
      try {
        fit.fit();
      } catch { /* ignore */ }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="box-border h-full w-full p-1"
    />
  );
}
