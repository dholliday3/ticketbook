import { resolve, join } from "node:path";
import { stat } from "node:fs/promises";
import { createRoutes, matchRoute, handleError, broadcastEvent } from "./api.js";
import { createWatcher } from "./watcher.js";
import { createPtySession, getSession, getAliveSessions, writeToPty, resizePty, detachPtySession, reattachPtySession, destroyPtySession, destroyAllSessions, setDataDir } from "./terminal.js";
import { listTerminalTabs, upsertTerminalTab, deleteTerminalTab } from "./db.js";

export interface ServerConfig {
  ticketsDir: string;
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

export function startServer(config: ServerConfig): ServerHandle {
  const { ticketsDir, port, staticDir } = config;
  const routes = createRoutes(ticketsDir);

  // Initialize terminal data dir (SQLite db lives alongside .tickets)
  setDataDir(ticketsDir);

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
          const sessions = tabs.map((t) => ({ id: t.id, title: t.title, sortOrder: t.sort_order, alive: aliveSet.has(t.id) }));
          return addCors(new Response(JSON.stringify({ sessions }), { headers: { "Content-Type": "application/json" } }), origin);
        }
        if (req.method === "POST") {
          // Create a new tab entry (PTY is created on WS connect)
          const body = await req.json() as { id?: string; title?: string; sortOrder?: number };
          if (!body.id || !body.title) return addCors(new Response(JSON.stringify({ error: "id and title required" }), { status: 400, headers: { "Content-Type": "application/json" } }), origin);
          upsertTerminalTab(ticketsDir, body.id, body.title, body.sortOrder ?? 0);
          return addCors(new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } }), origin);
        }
        if (req.method === "DELETE") {
          const body = await req.json() as { id?: string };
          if (!body.id) return addCors(new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: { "Content-Type": "application/json" } }), origin);
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
      open(ws) {
        const { sessionId, ticketsDir: cwd } = ws.data;

        // Try to reattach to an existing session first
        const replay = reattachPtySession(sessionId);
        let session = getSession(sessionId);

        if (!session?.alive) {
          // No existing session — create new
          session = createPtySession(sessionId, resolve(cwd, ".."));
        }

        // Wire up data/exit callbacks to this WebSocket
        session.onData = (data: string) => {
          try {
            ws.send(JSON.stringify({ type: "output", data }));
          } catch {
            // ws closed
          }
        };
        session.onExit = () => {
          try { ws.close(); } catch { /* already closed */ }
        };

        // Send scrollback replay if reconnecting
        if (replay) {
          ws.send(JSON.stringify({ type: "replay", data: replay }));
        }
      },
      message(ws, message) {
        const { sessionId } = ws.data;
        try {
          const msg = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
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
        // Don't destroy — start grace timer for reconnection
        detachPtySession(sessionId);
      },
    },
  });

  // Start file watcher for live SSE updates
  const watcher = createWatcher(ticketsDir, broadcastEvent);

  process.on("SIGINT", () => {
    destroyAllSessions();
    watcher.close();
    server.stop();
    process.exit(0);
  });

  return {
    port: server.port ?? port,
    close() {
      watcher.close();
      server.stop();
    },
  };
}

// Direct execution
if (import.meta.main) {
  const ticketsDir = resolve(process.env.TICKETS_DIR ?? ".tickets");
  const port = parseInt(process.env.PORT ?? "4242", 10);
  const staticDir = resolve(
    process.env.STATIC_DIR ?? join(import.meta.dir, "../../ui/dist"),
  );

  const handle = startServer({ ticketsDir, port, staticDir });
  console.log(`Ticketbook server listening on http://localhost:${handle.port}`);
  console.log(`Tickets directory: ${ticketsDir}`);
}
