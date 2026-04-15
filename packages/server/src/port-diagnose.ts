/**
 * Diagnostics for "port already in use" failures. When the explicit-port
 * path in bin/relay.ts hits EADDRINUSE we shell out to `lsof` + `ps` to
 * figure out who's squatting, with special recognition for orphaned
 * relay processes (the most common cause: a previous `bun dev` whose
 * shell died without the EXIT trap firing).
 *
 * The shell-out is best-effort. If `lsof`/`ps` aren't installed, or the race
 * between error and probe causes lsof to miss the process, we fall back to a
 * generic message. We never throw from here — diagnostics failing should not
 * replace the original error.
 */

export interface PortSquatter {
  pid: number;
  /** Full command line as reported by `ps -o command`. */
  command: string;
  /** Elapsed time in seconds, or null if we couldn't read it. */
  elapsedSeconds: number | null;
  /** True if the command looks like a relay server process. */
  isRelay: boolean;
}

/**
 * Extract the PID from `lsof -i :PORT -sTCP:LISTEN -n -P` output.
 *
 * Example input:
 * ```
 * COMMAND   PID           USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
 * bun     40575 danielholliday    5u  IPv6 0x2db4a690ac4945ec      0t0  TCP *:4242 (LISTEN)
 * ```
 */
export function parseLsofListenPid(output: string): number | null {
  const lines = output.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  for (const line of lines) {
    if (line.startsWith("COMMAND")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const pid = Number.parseInt(parts[1], 10);
    if (Number.isFinite(pid) && pid > 0) return pid;
  }
  return null;
}

/**
 * Parse a single-process `ps -o pid=,etime=,command=` row. The trailing `=`
 * on each column suppresses the header, so input is one line like:
 *
 * ```
 *  40575    01-18:29:45 bun bin/relay.ts --port 4242 --no-ui
 * ```
 *
 * We use `etime` (portable across macOS and Linux) rather than `etimes`
 * (Linux-only), and parse the `[[dd-]hh:]mm:ss` format via `parseEtime`.
 * Returns null if the row doesn't look like a valid ps entry (e.g. empty
 * output when the pid no longer exists).
 */
export function parsePsRow(
  output: string,
): { pid: number; elapsedSeconds: number | null; command: string } | null {
  const line = output.split("\n").find((l) => l.trim().length > 0);
  if (!line) return null;
  const trimmed = line.trim();
  // First token is pid, second is etime, the rest is the command.
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace < 0) return null;
  const pid = Number.parseInt(trimmed.slice(0, firstSpace), 10);
  const afterPid = trimmed.slice(firstSpace + 1).trimStart();
  const secondSpace = afterPid.indexOf(" ");
  if (secondSpace < 0) return null;
  const etimeRaw = afterPid.slice(0, secondSpace);
  const command = afterPid.slice(secondSpace + 1).trimStart();
  if (!Number.isFinite(pid) || !command) return null;
  return { pid, elapsedSeconds: parseEtime(etimeRaw), command };
}

/**
 * Parse a `ps -o etime` elapsed-time string into seconds.
 *
 * Format: `[[DD-]HH:]MM:SS` — examples:
 *   - `"01:23"`        → 83 seconds
 *   - `"12:34:56"`     → 45296 seconds
 *   - `"01-18:29:45"`  → 152985 seconds
 *
 * Returns null for unparseable input so callers can display the squatter
 * info without the elapsed field rather than dropping the whole lookup.
 */
export function parseEtime(etime: string): number | null {
  const trimmed = etime.trim();
  const match = trimmed.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!match) return null;
  const days = match[1] ? Number.parseInt(match[1], 10) : 0;
  const hours = match[2] ? Number.parseInt(match[2], 10) : 0;
  const mins = Number.parseInt(match[3], 10);
  const secs = Number.parseInt(match[4], 10);
  if (
    !Number.isFinite(days) ||
    !Number.isFinite(hours) ||
    !Number.isFinite(mins) ||
    !Number.isFinite(secs)
  ) {
    return null;
  }
  return days * 86400 + hours * 3600 + mins * 60 + secs;
}

/**
 * Heuristic for recognizing a relay server process from its command line.
 * Matches both the dev-mode form (`bun bin/relay.ts`) and the published
 * form (`bunx relay` or `relay` on PATH), but not the `--mcp` mode
 * (stdio, no port) or the init subcommand.
 */
export function isRelayCommand(command: string): boolean {
  if (!command.includes("relay")) return false;
  if (command.includes("--mcp")) return false;
  if (/\brelay\s+init\b/.test(command)) return false;
  if (/\brelay\.ts\b/.test(command)) return true;
  if (/\bbunx\s+relay\b/.test(command)) return true;
  if (/\brelay\b/.test(command)) return true;
  return false;
}

/**
 * Humanize an elapsed-seconds count into a short label. We only want the two
 * most significant units — precision beyond that is noise for "how long has
 * this been stuck here".
 */
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  const day = 86400;
  const hour = 3600;
  const minute = 60;
  if (seconds >= day) {
    const d = Math.floor(seconds / day);
    const h = Math.floor((seconds % day) / hour);
    return `${d}d${h}h`;
  }
  if (seconds >= hour) {
    const h = Math.floor(seconds / hour);
    const m = Math.floor((seconds % hour) / minute);
    return `${h}h${m}m`;
  }
  if (seconds >= minute) {
    const m = Math.floor(seconds / minute);
    const s = seconds % minute;
    return `${m}m${s}s`;
  }
  return `${seconds}s`;
}

/**
 * Run a command via Bun.spawn and return its trimmed stdout, or null on any
 * failure (exit code != 0, binary missing, non-zero stderr, etc). Used for
 * best-effort diagnostics — we never want this to throw up the stack.
 */
async function runCapture(cmd: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    if (code !== 0) return null;
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Look up the process holding `port` and return structured info about it.
 * Returns null if we can't determine the squatter for any reason (lsof
 * missing, race, non-macOS/Linux). Callers should fall back to a generic
 * message in that case.
 */
export async function describePortSquatter(
  port: number,
): Promise<PortSquatter | null> {
  const lsofOut = await runCapture([
    "lsof",
    "-i",
    `:${port}`,
    "-sTCP:LISTEN",
    "-n",
    "-P",
  ]);
  if (!lsofOut) return null;
  const pid = parseLsofListenPid(lsofOut);
  if (pid == null) return null;

  const psOut = await runCapture([
    "ps",
    "-p",
    String(pid),
    "-o",
    "pid=,etime=,command=",
  ]);
  if (!psOut) {
    // lsof found the pid but ps couldn't read it (process exited between
    // calls). Return what we know.
    return {
      pid,
      command: "",
      elapsedSeconds: null,
      isRelay: false,
    };
  }

  const row = parsePsRow(psOut);
  if (!row) {
    return { pid, command: "", elapsedSeconds: null, isRelay: false };
  }
  return {
    pid: row.pid,
    command: row.command,
    elapsedSeconds: row.elapsedSeconds,
    isRelay: isRelayCommand(row.command),
  };
}

/**
 * Format a human-readable error message for an EADDRINUSE on an explicit
 * port, using the squatter info if available. Returns a multi-line string
 * suitable for writing to stderr.
 */
export function formatPortInUseMessage(
  port: number,
  squatter: PortSquatter | null,
): string {
  const lines: string[] = [];
  if (squatter && squatter.isRelay) {
    const elapsed =
      squatter.elapsedSeconds != null
        ? ` (running ${formatElapsed(squatter.elapsedSeconds)})`
        : "";
    lines.push(
      `Port ${port} is already in use by another relay instance (likely an orphaned \`bun dev\`):`,
    );
    lines.push(`  PID ${squatter.pid}  ${squatter.command}${elapsed}`);
    lines.push("");
    lines.push(`Stop it:            kill ${squatter.pid}`);
    lines.push(`Or pick another port: relay --port <N>`);
  } else if (squatter) {
    const elapsed =
      squatter.elapsedSeconds != null
        ? ` (running ${formatElapsed(squatter.elapsedSeconds)})`
        : "";
    const cmd = squatter.command || "<unknown command>";
    lines.push(`Port ${port} is already in use:`);
    lines.push(`  PID ${squatter.pid}  ${cmd}${elapsed}`);
    lines.push("");
    lines.push(`Stop the process or pick another port: relay --port <N>`);
  } else {
    lines.push(`Port ${port} is already in use.`);
    lines.push("");
    lines.push(`Pick another port: relay --port <N>`);
  }
  return lines.join("\n");
}
