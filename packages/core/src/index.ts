export {
  StatusEnum,
  PriorityEnum,
  TaskFrontmatterSchema,
  CreateTaskInputSchema,
  TaskPatchSchema,
  TaskFiltersSchema,
  DeleteModeEnum,
  RelayConfigSchema,
  WorktreeModeEnum,
} from "./schema.js";

export type {
  Task,
  TaskFrontmatter,
  CreateTaskInput,
  TaskPatch,
  TaskFilters,
  RelayConfig,
} from "./types.js";

export { getConfig, updateConfig } from "./config.js";

export {
  listTasks,
  getTask,
  searchTasks,
  getProjects,
  getEpics,
  getSprints,
  getTags,
} from "./reader.js";

export { nextId, nextIdForDir, slugify, formatId, formatFilename } from "./id.js";

export {
  createTask,
  updateTask,
  deleteTask,
  restoreTask,
  toggleSubtask,
  addSubtask,
} from "./writer.js";

export { reorderTask, rebalanceOrder, sortTasks } from "./order.js";

export {
  PlanStatusEnum,
  PlanFrontmatterSchema,
  CreatePlanInputSchema,
  PlanPatchSchema,
  PlanFiltersSchema,
} from "./plan-schema.js";

export type {
  Plan,
  PlanFrontmatter,
  CreatePlanInput,
  PlanPatch,
  PlanFilters,
} from "./plan-types.js";

export {
  listPlans,
  getPlan,
  searchPlans,
  getPlanProjects,
  getPlanTags,
} from "./plan-reader.js";

export {
  createPlan,
  updatePlan,
  deletePlan,
  restorePlan,
  cutTasksFromPlan,
  cutTicketsFromPlan,
} from "./plan-writer.js";

export type { CutTasksResult } from "./plan-writer.js";

export {
  DocFrontmatterSchema,
  CreateDocInputSchema,
  DocPatchSchema,
  DocFiltersSchema,
} from "./doc-schema.js";

export type {
  Doc,
  DocFrontmatter,
  CreateDocInput,
  DocPatch,
  DocFilters,
} from "./doc-types.js";

export {
  listDocs,
  getDoc,
  searchDocs,
  getDocProjects,
  getDocTags,
} from "./doc-reader.js";

export {
  createDoc,
  updateDoc,
  deleteDoc,
  restoreDoc,
} from "./doc-writer.js";

export { withLock } from "./lock.js";
export { atomicWriteFile } from "./atomic.js";
export { runDoctor, formatDoctorReport } from "./doctor.js";
export type { DoctorOptions, DoctorResult, DiagnosticItem, Severity } from "./doctor.js";
export { sync } from "./sync.js";
export type { SyncOptions, SyncResult } from "./sync.js";
export { resolveWorktreeRoot, findRelayDirWithWorktree } from "./worktree.js";
export type { ClientMessage, ServerMessage } from "./terminal-protocol.js";

export { initRelay, codexMcpInstructions } from "./init.js";
export type { InitRelayOptions, InitRelayResult } from "./init.js";
export { VERSION } from "./version.js";
export { runUpgrade, getCurrentVersion, fetchLatestVersion } from "./upgrade.js";
export type { RunUpgradeOptions, RunUpgradeResult } from "./upgrade.js";

export {
  createContextRefRegex,
  parseContextRefs,
  splitByContextRefs,
  renderContextRefMarker,
  encodeTitleAttr,
} from "./context-refs.js";
export type {
  ContextRef,
  ContextRefKind,
  ContextRefSpan,
} from "./context-refs.js";

// Server-only — pulls in gray-matter. Import via @relay/core/expansion
// in server code; don't import from the UI bundle.
export {
  renderContextRefExpansion,
  renderDeletedContextRef,
} from "./context-refs-expansion.js";
