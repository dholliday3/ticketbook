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

export const TicketFrontmatterSchema = z.object({
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

export const CreateTicketInputSchema = z.object({
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

export const TicketPatchSchema = z.object({
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

export const TicketFiltersSchema = z.object({
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

export const TicketbookConfigSchema = z.object({
  prefix: z.string().default("TASK"),
  planPrefix: z.string().default("PLAN"),
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
