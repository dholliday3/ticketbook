import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  sessionId: string;
  isVisible: boolean;
}

export function Terminal({ sessionId, isVisible }: TerminalProps) {
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

    // Delay initial fit to let container render
    requestAnimationFrame(() => {
      try { fit.fit(); } catch { /* container not ready */ }
    });

    xtermRef.current = term;
    fitRef.current = fit;

    // Connect WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/terminal/${encodeURIComponent(sessionId)}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output" || msg.type === "replay") {
          term.write(msg.data);
        }
      } catch {
        // ignore
      }
    };

    ws.onopen = () => {
      // Send initial size
      try {
        fit.fit();
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      } catch { /* ignore */ }
    };

    // Forward user input to server
    const inputDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Handle resize
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    return () => {
      inputDisposable.dispose();
      resizeDisposable.dispose();
      ws.close();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [sessionId]);

  // Re-fit when visibility changes
  useEffect(() => {
    if (isVisible && fitRef.current) {
      requestAnimationFrame(() => {
        try { fitRef.current?.fit(); } catch { /* ignore */ }
      });
    }
  }, [isVisible]);

  // Expose a fit method via a ResizeObserver on the container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (fitRef.current) {
        try { fitRef.current.fit(); } catch { /* ignore */ }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      style={{ display: isVisible ? "block" : "none" }}
    />
  );
}
