import { resolve, join } from "node:path";
import { stat } from "node:fs/promises";
import { createRoutes, matchRoute, handleError, broadcastEvent } from "./api.js";
import { createWatcher } from "./watcher.js";
import { createPtySession, getSession, getAliveSessions, writeToPty, resizePty, detachPtySession, reattachPtySession, destroyPtySession, destroyAllSessions, setDataDir } from "./terminal.js";
import { listTerminalTabs, upsertTerminalTab, getNextTabNumber, deleteTerminalTab } from "./db.js";
import type { ServerMessage } from "@ticketbook/core";

export interface ServerConfig {
  ticketsDir: string;
  plansDir: string;
  port: number;
  staticDir?: string;
}

export interface ServerHandle {
  port: number;
  close: () => void;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (origin && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function addCors(response: Response, origin: string | null): Response {
  const headers = corsHeaders(origin);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

function sendMsg(ws: { send(data: string): void }, msg: ServerMessage): void {
  try { ws.send(JSON.stringify(msg)); } catch { /* ws closed */ }
}

export function startServer(config: ServerConfig): ServerHandle {
  const { ticketsDir, plansDir, port, staticDir } = config;
  const routes = createRoutes(ticketsDir, plansDir);

  // Initialize terminal data dir (SQLite db lives alongside .tickets)
  setDataDir(ticketsDir);

  // Track active WebSocket connections per session for graceful teardown
  const wsConnections = new Map<string, { close(code?: number, reason?: string): void }>();

  async function tryServeStatic(pathname: string): Promise<Response | null> {
    if (!staticDir) return null;

    // Prevent directory traversal
    const filePath = resolve(staticDir, pathname.replace(/^\/+/, ""));
    if (!filePath.startsWith(staticDir)) return null;

    try {
      const fileStat = await stat(filePath);
      if (fileStat.isFile()) {
        return new Response(Bun.file(filePath));
      }
    } catch {
      // File doesn't exist
    }

    // SPA fallback: try serving index.html for non-file paths
    try {
      const indexPath = join(staticDir, "index.html");
      const indexStat = await stat(indexPath);
      if (indexStat.isFile()) {
        return new Response(Bun.file(indexPath));
      }
    } catch {
      // No index.html
    }

    return null;
  }

  type WsData = { sessionId: string; ticketsDir: string };

  const server = Bun.serve<WsData>({
    port,
    idleTimeout: 255, // max; prevents Bun from killing WebSocket upgrade requests
    async fetch(req, server) {
      const origin = req.headers.get("Origin");

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        return addCors(new Response(null, { status: 204 }), origin);
      }

      const url = new URL(req.url);

      // Terminal tab management
      if (url.pathname === "/api/terminal/sessions") {
        if (req.method === "GET") {
          // Return persisted tabs with alive status from in-memory PTY state
          const tabs = listTerminalTabs(ticketsDir);
          const aliveSet = new Set(getAliveSessions());
          const sessions = tabs.map((t) => ({ id: t.id, title: t.title, sortOrder: t.sort_order, tabNumber: t.tab_number, alive: aliveSet.has(t.id) }));
          return addCors(new Response(JSON.stringify({ sessions }), { headers: { "Content-Type": "application/json" } }), origin);
        }
        if (req.method === "POST") {
          // Server assigns id, title, and tab number
          const body = await req.json() as { sortOrder?: number };
          const tabNumber = getNextTabNumber(ticketsDir);
          const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const title = `Terminal ${tabNumber}`;
          const sortOrder = body.sortOrder ?? 0;
          upsertTerminalTab(ticketsDir, id, title, sortOrder, tabNumber);
          return addCors(new Response(JSON.stringify({ id, title, tabNumber, sortOrder }), { headers: { "Content-Type": "application/json" } }), origin);
        }
        if (req.method === "DELETE") {
          const body = await req.json() as { id?: string };
          if (!body.id) return addCors(new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: { "Content-Type": "application/json" } }), origin);

          // Close WebSocket first (gracefully) to prevent ECONNRESET
          const existingWs = wsConnections.get(body.id);
          if (existingWs) {
            try { existingWs.close(1000, "session destroyed"); } catch { /* already closed */ }
            wsConnections.delete(body.id);
          }

          destroyPtySession(body.id);
          return addCors(new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } }), origin);
        }
      }

      // WebSocket upgrade for terminal
      const termMatch = url.pathname.match(/^\/api\/terminal\/(.+)$/);
      if (termMatch && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const sessionId = decodeURIComponent(termMatch[1]);
        const success = server.upgrade(req, { data: { sessionId, ticketsDir } });
        if (success) return undefined as unknown as Response;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      // API routes
      if (url.pathname.startsWith("/api")) {
        const matched = matchRoute(routes, req);
        if (!matched) {
          return addCors(
            new Response(JSON.stringify({ error: "Not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }),
            origin,
          );
        }

        try {
          const response = await matched.handler(req, matched.params);
          return addCors(response, origin);
        } catch (err) {
          return addCors(handleError(err), origin);
        }
      }

      // Static file serving for UI
      const staticResponse = await tryServeStatic(url.pathname);
      if (staticResponse) return staticResponse;

      return new Response("Not found", { status: 404 });
    },
    websocket: {
      idleTimeout: 0, // disable — terminal sessions can be idle indefinitely
      open(ws) {
        const { sessionId } = ws.data;
        // Just track the connection — PTY creation is deferred until "init" handshake
        wsConnections.set(sessionId, ws);
      },
      message(ws, message) {
        const { sessionId, ticketsDir: cwd } = ws.data;
        try {
          const msg = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));

          if (msg.type === "init" && typeof msg.cols === "number" && typeof msg.rows === "number") {
            // Handshake: client sends its actual dimensions
            let session = getSession(sessionId);

            if (session?.alive) {
              // Wire callbacks BEFORE reattach so any output (resize reflow,
              // prompt redraw) reaches the client instead of being dropped
              session.onData = (data: string) => sendMsg(ws, { type: "output", data });
              session.onExit = () => { try { ws.close(); } catch { /* already closed */ } };
              // Resize PTY + clear stale scrollback buffer
              reattachPtySession(sessionId, msg.cols, msg.rows);
              // Send Ctrl-L to the shell — it will clear and redraw the prompt.
              // The xterm on the client is fresh (remounted on tab switch),
              // so we don't need to clear it ourselves.
              writeToPty(sessionId, "\x0c");
            } else {
              // New session: spawn PTY with correct dimensions
              session = createPtySession(sessionId, resolve(cwd, ".."), msg.cols, msg.rows);
              session.onData = (data: string) => sendMsg(ws, { type: "output", data });
              session.onExit = () => { try { ws.close(); } catch { /* already closed */ } };
            }

            sendMsg(ws, { type: "ready" });
            return;
          }

          if (msg.type === "input" && typeof msg.data === "string") {
            writeToPty(sessionId, msg.data);
          } else if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
            resizePty(sessionId, msg.cols, msg.rows);
          }
        } catch {
          // ignore malformed messages
        }
      },
      close(ws) {
        const { sessionId } = ws.data;
        wsConnections.delete(sessionId);
        // Don't destroy — start grace timer for reconnection
        detachPtySession(sessionId);
      },
    },
  });

  // Start file watchers for live SSE updates
  const ticketWatcher = createWatcher(ticketsDir, (event) =>
    broadcastEvent({ ...event, source: "ticket" }),
  );
  const planWatcher = createWatcher(plansDir, (event) =>
    broadcastEvent({ ...event, source: "plan" }),
  );

  process.on("SIGINT", () => {
    destroyAllSessions();
    ticketWatcher.close();
    planWatcher.close();
    server.stop();
    process.exit(0);
  });

  return {
    port: server.port ?? port,
    close() {
      ticketWatcher.close();
      planWatcher.close();
      server.stop();
    },
  };
}

// Direct execution
if (import.meta.main) {
  const ticketsDir = resolve(process.env.TICKETS_DIR ?? ".tickets");
  const plansDir = resolve(process.env.PLANS_DIR ?? ".plans");
  const port = parseInt(process.env.PORT ?? "4242", 10);
  const staticDir = resolve(
    process.env.STATIC_DIR ?? join(import.meta.dir, "../../ui/dist"),
  );

  const handle = startServer({ ticketsDir, plansDir, port, staticDir });
  console.log(`Ticketbook server listening on http://localhost:${handle.port}`);
  console.log(`Tickets directory: ${ticketsDir}`);
  console.log(`Plans directory: ${plansDir}`);
}
