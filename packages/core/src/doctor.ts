import { readdir, readFile, unlink, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import matter from "gray-matter";
import { TaskFrontmatterSchema } from "./schema.js";
import { PlanFrontmatterSchema } from "./plan-schema.js";
import { DocFrontmatterSchema } from "./doc-schema.js";
import { atomicWriteFile } from "./atomic.js";

export type Severity = "pass" | "warn" | "fail";

export interface DiagnosticItem {
  severity: Severity;
  check: string;
  message: string;
  fixable: boolean;
}

export interface DoctorResult {
  items: DiagnosticItem[];
  fixed: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const COUNTER_FILE = ".counter";
const IGNORED = new Set([COUNTER_FILE]);
const IGNORED_DIRS = new Set([".archive"]);

function item(
  severity: Severity,
  check: string,
  message: string,
  fixable = false,
): DiagnosticItem {
  return { severity, check, message, fixable };
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

function parseIdNumber(id: string): number | null {
  const match = id.match(/-(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

// ---------------------------------------------------------------------------
// Counter validation
// ---------------------------------------------------------------------------

async function checkCounter(
  dir: string,
  label: string,
  maxId: number,
  fix: boolean,
  items: DiagnosticItem[],
): Promise<number> {
  let fixed = 0;
  const counterPath = join(dir, COUNTER_FILE);

  let counterValue: number;
  try {
    const raw = await readFile(counterPath, "utf-8");
    counterValue = parseInt(raw.trim(), 10);
    if (Number.isNaN(counterValue)) {
      items.push(item("fail", `${label}-counter`, `Counter file is not a valid number`, fix));
      if (fix) {
        await atomicWriteFile(counterPath, String(maxId));
        items.push(item("pass", `${label}-counter`, `Fixed: counter set to ${maxId}`, false));
        fixed++;
      }
      return fixed;
    }
  } catch {
    // No counter file
    if (maxId > 0) {
      items.push(item("fail", `${label}-counter`, `Counter file missing but ${maxId} artifacts exist`, fix));
      if (fix) {
        await atomicWriteFile(counterPath, String(maxId));
        items.push(item("pass", `${label}-counter`, `Fixed: counter created with value ${maxId}`, false));
        fixed++;
      }
    } else {
      items.push(item("pass", `${label}-counter`, "No counter file needed (no artifacts)", false));
    }
    return fixed;
  }

  if (counterValue < maxId) {
    items.push(
      item("fail", `${label}-counter`, `Counter (${counterValue}) is behind highest ID (${maxId})`, fix),
    );
    if (fix) {
      await atomicWriteFile(counterPath, String(maxId));
      items.push(item("pass", `${label}-counter`, `Fixed: counter advanced to ${maxId}`, false));
      fixed++;
    }
  } else if (counterValue > maxId + 100) {
    items.push(
      item("warn", `${label}-counter`, `Counter (${counterValue}) is far ahead of highest ID (${maxId}) — possible gap`, false),
    );
  } else {
    items.push(
      item("pass", `${label}-counter`, `Counter (${counterValue}) is consistent with highest ID (${maxId})`, false),
    );
  }

  return fixed;
}

// ---------------------------------------------------------------------------
// Stale lock detection
// ---------------------------------------------------------------------------

async function checkStaleLocks(
  dir: string,
  label: string,
  fix: boolean,
  items: DiagnosticItem[],
): Promise<number> {
  let fixed = 0;
  const entries = await safeReaddir(dir);

  for (const entry of entries) {
    if (!entry.endsWith(".lock")) continue;
    const lockPath = join(dir, entry);
    try {
      const info = await stat(lockPath);
      const ageMs = Date.now() - info.mtimeMs;
      if (ageMs > 30_000) {
        items.push(item("warn", `${label}-stale-lock`, `Stale lock: ${entry} (${Math.round(ageMs / 1000)}s old)`, fix));
        if (fix) {
          await unlink(lockPath);
          items.push(item("pass", `${label}-stale-lock`, `Fixed: removed ${entry}`, false));
          fixed++;
        }
      }
    } catch {
      // Lock vanished, fine
    }
  }

  return fixed;
}

// ---------------------------------------------------------------------------
// Artifact parsing + validation
// ---------------------------------------------------------------------------

interface ParsedArtifact {
  file: string;
  id: string;
  idNumber: number | null;
  data: Record<string, unknown>;
}

async function parseArtifacts(
  dir: string,
  label: string,
  schema: { safeParse: (data: unknown) => { success: boolean; error?: unknown } },
  fix: boolean,
  items: DiagnosticItem[],
): Promise<{ artifacts: ParsedArtifact[]; fixed: number }> {
  const entries = await safeReaddir(dir);
  const artifacts: ParsedArtifact[] = [];
  const fixed = 0;

  for (const entry of entries) {
    if (IGNORED.has(entry) || IGNORED_DIRS.has(entry)) continue;
    if (extname(entry) !== ".md") continue;

    const filePath = join(dir, entry);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch {
      items.push(item("fail", `${label}-read`, `Cannot read: ${entry}`, false));
      continue;
    }

    let parsed: { data: Record<string, unknown>; content: string };
    try {
      parsed = matter(raw) as { data: Record<string, unknown>; content: string };
    } catch {
      items.push(item("fail", `${label}-parse`, `Malformed frontmatter: ${entry}`, false));
      continue;
    }

    const result = schema.safeParse(parsed.data);
    if (!result.success) {
      items.push(item("fail", `${label}-schema`, `Schema validation failed: ${entry}`, false));
      continue;
    }

    const id = parsed.data.id as string;
    artifacts.push({
      file: entry,
      id,
      idNumber: parseIdNumber(id),
      data: parsed.data,
    });
  }

  return { artifacts, fixed };
}

// ---------------------------------------------------------------------------
// Duplicate ID detection
// ---------------------------------------------------------------------------

function checkDuplicateIds(
  artifacts: ParsedArtifact[],
  label: string,
  items: DiagnosticItem[],
): void {
  const seen = new Map<string, string[]>();
  for (const a of artifacts) {
    const files = seen.get(a.id) ?? [];
    files.push(a.file);
    seen.set(a.id, files);
  }

  for (const [id, files] of seen) {
    if (files.length > 1) {
      items.push(
        item("fail", `${label}-duplicate`, `Duplicate ID ${id} in: ${files.join(", ")}`, false),
      );
    }
  }

  const noDups = [...seen.values()].every((f) => f.length === 1);
  if (noDups && artifacts.length > 0) {
    items.push(item("pass", `${label}-duplicate`, `No duplicate IDs (${artifacts.length} artifacts)`, false));
  }
}

// ---------------------------------------------------------------------------
// Reference integrity (blockedBy, relatedTo, plan.tasks)
// ---------------------------------------------------------------------------

function checkReferences(
  artifacts: ParsedArtifact[],
  validIds: Set<string>,
  label: string,
  refFields: string[],
  items: DiagnosticItem[],
): void {
  for (const a of artifacts) {
    for (const field of refFields) {
      const refs = a.data[field];
      if (!Array.isArray(refs)) continue;
      for (const ref of refs) {
        if (typeof ref === "string" && !validIds.has(ref)) {
          items.push(
            item("warn", `${label}-dangling-ref`, `${a.id} has dangling ${field} reference: ${ref}`, false),
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// .gitattributes check
// ---------------------------------------------------------------------------

async function checkGitattributes(
  projectRoot: string,
  fix: boolean,
  items: DiagnosticItem[],
): Promise<number> {
  let fixed = 0;
  const gaPath = join(projectRoot, ".gitattributes");
  let content = "";

  try {
    content = await readFile(gaPath, "utf-8");
  } catch {
    // File doesn't exist
  }

  const requiredLines = [
    ".relay/tasks/.counter merge=ours",
    ".relay/plans/.counter merge=ours",
    ".relay/docs/.counter merge=ours",
  ];

  const missing: string[] = [];
  for (const line of requiredLines) {
    if (!content.includes(line)) {
      missing.push(line);
    }
  }

  if (missing.length === 0) {
    items.push(item("pass", "gitattributes", "Merge strategies configured for counter files", false));
  } else {
    items.push(
      item("fail", "gitattributes", `Missing merge strategies: ${missing.join(", ")}`, fix),
    );
    if (fix) {
      const addition = "\n# Relay: counter files use 'ours' merge to avoid conflicts\n" +
        missing.join("\n") + "\n";
      await atomicWriteFile(gaPath, content + addition);
      items.push(item("pass", "gitattributes", "Fixed: added merge strategies to .gitattributes", false));
      fixed++;
    }
  }

  return fixed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DoctorOptions {
  tasksDir: string;
  plansDir?: string;
  docsDir?: string;
  projectRoot?: string;
  fix?: boolean;
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const { tasksDir, plansDir, docsDir, fix = false } = options;
  const items: DiagnosticItem[] = [];
  let totalFixed = 0;

  // --- Tasks ---
  const { artifacts: tasks } = await parseArtifacts(
    tasksDir, "task", TaskFrontmatterSchema, fix, items,
  );
  const maxTaskId = Math.max(0, ...tasks.map((a) => a.idNumber ?? 0));
  checkDuplicateIds(tasks, "task", items);

  const allTaskIds = new Set(tasks.map((a) => a.id));
  checkReferences(tasks, allTaskIds, "task", ["blockedBy", "relatedTo"], items);

  totalFixed += await checkCounter(tasksDir, "task", maxTaskId, fix, items);
  totalFixed += await checkStaleLocks(tasksDir, "task", fix, items);

  // --- Plans ---
  if (plansDir) {
    const { artifacts: plans } = await parseArtifacts(
      plansDir, "plan", PlanFrontmatterSchema, fix, items,
    );
    const maxPlanId = Math.max(0, ...plans.map((a) => a.idNumber ?? 0));
    checkDuplicateIds(plans, "plan", items);

    // Plan tasks references should point to valid task IDs
    checkReferences(plans, allTaskIds, "plan", ["tasks"], items);

    totalFixed += await checkCounter(plansDir, "plan", maxPlanId, fix, items);
    totalFixed += await checkStaleLocks(plansDir, "plan", fix, items);
  }

  // --- Docs ---
  if (docsDir) {
    const { artifacts: docs } = await parseArtifacts(
      docsDir, "doc", DocFrontmatterSchema, fix, items,
    );
    const maxDocId = Math.max(0, ...docs.map((a) => a.idNumber ?? 0));
    checkDuplicateIds(docs, "doc", items);

    totalFixed += await checkCounter(docsDir, "doc", maxDocId, fix, items);
    totalFixed += await checkStaleLocks(docsDir, "doc", fix, items);
  }

  // --- .gitattributes ---
  if (options.projectRoot) {
    totalFixed += await checkGitattributes(options.projectRoot, fix, items);
  }

  return { items, fixed: totalFixed };
}

/**
 * Format doctor results as a human-readable report.
 */
export function formatDoctorReport(result: DoctorResult): string {
  const lines: string[] = [];
  const counts = { pass: 0, warn: 0, fail: 0 };

  for (const it of result.items) {
    counts[it.severity]++;
    const icon = it.severity === "pass" ? "OK" : it.severity === "warn" ? "WARN" : "FAIL";
    const fixHint = it.fixable ? " (fixable)" : "";
    lines.push(`  [${icon}] ${it.check}: ${it.message}${fixHint}`);
  }

  lines.push("");
  lines.push(`Summary: ${counts.pass} passed, ${counts.warn} warnings, ${counts.fail} failures`);
  if (result.fixed > 0) {
    lines.push(`Auto-fixed: ${result.fixed} issue(s)`);
  }

  return lines.join("\n");
}
