import { z } from "zod";

export const StatusEnum = z.enum([
  "draft",
  "backlog",
  "open",
  "in-progress",
  "done",
  "cancelled",
]);

export const PriorityEnum = z.enum(["low", "medium", "high", "urgent"]);

const lowercaseString = z
  .string()
  .refine((s) => s === s.toLowerCase(), "Tags must be lowercase");

export const TaskFrontmatterSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: StatusEnum,
  created: z.coerce.date(),
  updated: z.coerce.date(),
  priority: PriorityEnum.optional(),
  order: z.number().optional(),
  tags: z.array(lowercaseString).optional(),
  project: z.string().optional(),
  epic: z.string().optional(),
  sprint: z.string().optional(),
  blockedBy: z.array(z.string()).optional(),
  relatedTo: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  refs: z.array(z.string()).optional(),
});

export const CreateTaskInputSchema = z.object({
  title: z.string().min(1),
  status: StatusEnum.default("open"),
  priority: PriorityEnum.optional(),
  order: z.number().optional(),
  tags: z.array(lowercaseString).optional(),
  project: z.string().optional(),
  epic: z.string().optional(),
  sprint: z.string().optional(),
  body: z.string().optional(),
  blockedBy: z.array(z.string()).optional(),
  relatedTo: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  refs: z.array(z.string()).optional(),
});

export const TaskPatchSchema = z.object({
  title: z.string().min(1).optional(),
  status: StatusEnum.optional(),
  priority: PriorityEnum.nullish(),
  order: z.number().nullish(),
  tags: z.array(lowercaseString).optional(),
  project: z.string().nullish(),
  epic: z.string().nullish(),
  sprint: z.string().nullish(),
  body: z.string().optional(),
  blockedBy: z.array(z.string()).optional(),
  relatedTo: z.array(z.string()).optional(),
  assignee: z.string().nullish(),
  refs: z.array(z.string()).optional(),
});

export const TaskFiltersSchema = z.object({
  status: z.union([StatusEnum, z.array(StatusEnum)]).optional(),
  priority: z.union([PriorityEnum, z.array(PriorityEnum)]).optional(),
  project: z.string().optional(),
  epic: z.string().optional(),
  sprint: z.string().optional(),
  tags: z.array(z.string()).optional(),
  search: z.string().optional(),
});

export const DeleteModeEnum = z.enum(["archive", "hard"]);

export const DebriefStyleEnum = z.enum(["very-concise", "concise", "detailed", "lengthy"]);

export const RelayConfigSchema = z.object({
  /**
   * Optional project identifier, auto-populated by `relay init` from
   * the basename of the target directory. Used to give each MCP server
   * instance a per-project name (`relay-<name>`) so multi-repo setups
   * have distinguishable identities in `claude mcp list` and error logs.
   */
  name: z.string().optional(),
  prefix: z.string().default("TASK"),
  planPrefix: z.string().default("PLAN"),
  docPrefix: z.string().default("DOC"),
  deleteMode: DeleteModeEnum.default("archive"),
  debriefStyle: DebriefStyleEnum.default("very-concise"),
  /**
   * Terminal scrollback buffer size in lines. Controls how much output
   * history is preserved per terminal session (visible on reconnect via
   * the server-side headless xterm + SerializeAddon replay).
   * Applied when new sessions are created; existing sessions keep their
   * original scrollback.
   */
  terminalScrollback: z.number().int().positive().default(5000),
});
