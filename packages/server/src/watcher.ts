import { watch, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { access } from "node:fs/promises";

export type ChangeType = "created" | "updated" | "deleted";

export interface TicketChangeEvent {
  ticketId: string;
  changeType: ChangeType;
  filename: string;
  timestamp: string;
}

type EventCallback = (event: TicketChangeEvent) => void;

/** Extract ticket ID from filename like "TKT-001-some-slug.md" → "TKT-001" */
function extractTicketId(filename: string): string | null {
  const name = filename.replace(/\.md$/, "");
  const match = name.match(/^(.+?-\d+)/);
  return match ? match[1] : null;
}

export function createWatcher(
  dir: string,
  onEvent: EventCallback,
  debounceMs = 100,
): { close: () => void } {
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const knownFiles = new Set<string>();

  // Seed known files so we can distinguish created vs updated
  readdir(dir)
    .then((entries) => {
      for (const entry of entries) {
        if (extname(entry) === ".md") knownFiles.add(entry);
      }
    })
    .catch(() => {
      // Directory may not exist yet — that's fine
    });

  let watcher: FSWatcher;
  try {
    watcher = watch(dir, (_, filename) => {
      if (!filename || extname(filename) !== ".md") return;

      const ticketId = extractTicketId(filename);
      if (!ticketId) return;

      // Debounce per-file
      const existing = debounceTimers.get(filename);
      if (existing) clearTimeout(existing);

      debounceTimers.set(
        filename,
        setTimeout(async () => {
          debounceTimers.delete(filename);

          let changeType: ChangeType;
          try {
            await access(join(dir, filename));
            // File exists
            changeType = knownFiles.has(filename) ? "updated" : "created";
            knownFiles.add(filename);
          } catch {
            // File doesn't exist → deleted
            changeType = "deleted";
            knownFiles.delete(filename);
          }

          onEvent({
            ticketId,
            changeType,
            filename,
            timestamp: new Date().toISOString(),
          });
        }, debounceMs),
      );
    });
  } catch {
    return { close() {} };
  }

  return {
    close() {
      watcher.close();
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();
    },
  };
}
