import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer, type ServerHandle } from "./index.js";

describe("REST API", () => {
  let dir: string;
  let ticketsDir: string;
  let plansDir: string;
  let handle: ServerHandle;
  let base: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-api-"));
    ticketsDir = join(dir, ".tickets");
    plansDir = join(dir, ".plans");
    await mkdir(join(ticketsDir, ".archive"), { recursive: true });
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(ticketsDir, ".counter"), "0", "utf-8");
    await writeFile(join(ticketsDir, ".config.yaml"), "prefix: TASK\ndeleteMode: archive\n", "utf-8");
    handle = startServer({ ticketsDir, plansDir, port: 0 });
    base = `http://localhost:${handle.port}`;
  });

  afterEach(async () => {
    handle.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("GET /api/tasks returns empty array", async () => {
    const res = await fetch(`${base}/api/tasks`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("POST /api/tasks creates a ticket", async () => {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test ticket" }),
    });
    expect(res.status).toBe(201);
    const ticket = await res.json();
    expect(ticket.id).toBe("TASK-001");
    expect(ticket.title).toBe("Test ticket");
    expect(ticket.status).toBe("open");
  });

  test("GET /api/tasks/:id returns a ticket", async () => {
    // Create first
    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Findable" }),
    });

    const res = await fetch(`${base}/api/tasks/TASK-001`);
    expect(res.status).toBe(200);
    const ticket = await res.json();
    expect(ticket.title).toBe("Findable");
  });

  test("GET /api/tasks/:id returns 404 for missing", async () => {
    const res = await fetch(`${base}/api/tasks/TASK-999`);
    expect(res.status).toBe(404);
  });

  test("PATCH /api/tasks/:id updates fields", async () => {
    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Original" }),
    });

    const res = await fetch(`${base}/api/tasks/TASK-001`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in-progress", priority: "high" }),
    });
    expect(res.status).toBe(200);
    const ticket = await res.json();
    expect(ticket.status).toBe("in-progress");
    expect(ticket.priority).toBe("high");
  });

  test("PATCH /api/tasks/:id/body updates body", async () => {
    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Body Test" }),
    });

    const res = await fetch(`${base}/api/tasks/TASK-001/body`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "New content" }),
    });
    expect(res.status).toBe(200);
    const ticket = await res.json();
    expect(ticket.body).toBe("New content");
  });

  test("DELETE /api/tasks/:id archives a ticket", async () => {
    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "To Delete" }),
    });

    const res = await fetch(`${base}/api/tasks/TASK-001`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    // Verify it's gone from the list
    const listRes = await fetch(`${base}/api/tasks`);
    const tickets = await listRes.json();
    expect(tickets).toHaveLength(0);
  });

  test("POST /api/tasks/:id/restore restores a ticket", async () => {
    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Restorable" }),
    });
    await fetch(`${base}/api/tasks/TASK-001`, { method: "DELETE" });

    const res = await fetch(`${base}/api/tasks/TASK-001/restore`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const ticket = await res.json();
    expect(ticket.title).toBe("Restorable");
  });

  test("GET /api/meta returns aggregated metadata", async () => {
    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", project: "myproj", tags: ["bug"] }),
    });

    const res = await fetch(`${base}/api/meta`);
    expect(res.status).toBe(200);
    const meta = await res.json();
    expect(meta.projects).toContain("myproj");
    expect(meta.tags).toContain("bug");
  });

  test("GET /api/config returns config", async () => {
    const res = await fetch(`${base}/api/config`);
    expect(res.status).toBe(200);
    const config = await res.json();
    expect(config.prefix).toBe("TASK");
    expect(config.deleteMode).toBe("archive");
  });

  test("PATCH /api/config updates config", async () => {
    const res = await fetch(`${base}/api/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "BUG" }),
    });
    expect(res.status).toBe(200);
    const config = await res.json();
    expect(config.prefix).toBe("BUG");
  });

  test("POST /api/tasks with invalid body returns 400", async () => {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("CORS headers are set for localhost", async () => {
    const res = await fetch(`${base}/api/tasks`, {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173",
    );
  });

  test("OPTIONS preflight returns 204", async () => {
    const res = await fetch(`${base}/api/tasks`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(204);
  });
});
