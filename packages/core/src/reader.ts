import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import matter from "gray-matter";
import { TicketFrontmatterSchema } from "./schema.js";
import type { Ticket, TicketFilters } from "./types.js";

const IGNORED_FILES = new Set([".counter", ".config.yaml"]);
const IGNORED_DIRS = new Set([".archive"]);

async function parseTicketFile(filePath: string): Promise<Ticket | null> {
  const raw = await readFile(filePath, "utf-8");
  const { data, content } = matter(raw);
  const result = TicketFrontmatterSchema.safeParse(data);
  if (!result.success) return null;
  return {
    ...result.data,
    body: content.trim(),
    filePath,
  };
}

async function readAllTickets(dir: string): Promise<Ticket[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const tickets: Ticket[] = [];
  for (const entry of entries) {
    if (IGNORED_FILES.has(entry) || IGNORED_DIRS.has(entry)) continue;
    if (extname(entry) !== ".md") continue;
    const ticket = await parseTicketFile(join(dir, entry));
    if (ticket) tickets.push(ticket);
  }
  return tickets;
}

function matchesFilters(ticket: Ticket, filters: TicketFilters): boolean {
  if (filters.status) {
    const statuses = Array.isArray(filters.status)
      ? filters.status
      : [filters.status];
    if (!statuses.includes(ticket.status)) return false;
  }

  if (filters.priority) {
    const priorities = Array.isArray(filters.priority)
      ? filters.priority
      : [filters.priority];
    if (!ticket.priority || !priorities.includes(ticket.priority)) return false;
  }

  if (filters.project !== undefined) {
    if (ticket.project !== filters.project) return false;
  }

  if (filters.epic !== undefined) {
    if (ticket.epic !== filters.epic) return false;
  }

  if (filters.sprint !== undefined) {
    if (ticket.sprint !== filters.sprint) return false;
  }

  if (filters.tags && filters.tags.length > 0) {
    if (!ticket.tags) return false;
    if (!filters.tags.every((t) => ticket.tags!.includes(t))) return false;
  }

  if (filters.search) {
    const q = filters.search.toLowerCase();
    const haystack = `${ticket.title} ${ticket.body}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  return true;
}

export async function listTickets(
  dir: string,
  filters?: TicketFilters,
): Promise<Ticket[]> {
  const tickets = await readAllTickets(dir);
  if (!filters) return tickets;
  return tickets.filter((t) => matchesFilters(t, filters));
}

export async function getTicket(
  dir: string,
  id: string,
): Promise<Ticket | null> {
  const tickets = await readAllTickets(dir);
  return tickets.find((t) => t.id === id) ?? null;
}

export async function searchTickets(
  dir: string,
  query: string,
): Promise<Ticket[]> {
  return listTickets(dir, { search: query });
}

export async function getProjects(dir: string): Promise<string[]> {
  const tickets = await readAllTickets(dir);
  const set = new Set<string>();
  for (const t of tickets) {
    if (t.project) set.add(t.project);
  }
  return [...set].sort();
}

export async function getEpics(dir: string): Promise<string[]> {
  const tickets = await readAllTickets(dir);
  const set = new Set<string>();
  for (const t of tickets) {
    if (t.epic) set.add(t.epic);
  }
  return [...set].sort();
}

export async function getSprints(dir: string): Promise<string[]> {
  const tickets = await readAllTickets(dir);
  const set = new Set<string>();
  for (const t of tickets) {
    if (t.sprint) set.add(t.sprint);
  }
  return [...set].sort();
}

export async function getTags(dir: string): Promise<string[]> {
  const tickets = await readAllTickets(dir);
  const set = new Set<string>();
  for (const t of tickets) {
    if (t.tags) {
      for (const tag of t.tags) set.add(tag);
    }
  }
  return [...set].sort();
}
