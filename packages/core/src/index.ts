export {
  StatusEnum,
  PriorityEnum,
  TaskFrontmatterSchema,
  CreateTaskInputSchema,
  TaskPatchSchema,
  TaskFiltersSchema,
  DeleteModeEnum,
  TicketbookConfigSchema,
} from "./schema.js";

export type {
  Task,
  TaskFrontmatter,
  CreateTaskInput,
  TaskPatch,
  TaskFilters,
  TicketbookConfig,
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

export type { ClientMessage, ServerMessage } from "./terminal-protocol.js";

export { initTicketbook, codexMcpInstructions } from "./init.js";
export type { InitTicketbookOptions, InitTicketbookResult } from "./init.js";

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

// Server-only — pulls in gray-matter. Import via @ticketbook/core/expansion
// in server code; don't import from the UI bundle.
export {
  renderContextRefExpansion,
  renderDeletedContextRef,
} from "./context-refs-expansion.js";
