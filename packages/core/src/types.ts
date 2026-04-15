import type { z } from "zod";
import type {
  TaskFrontmatterSchema,
  CreateTaskInputSchema,
  TaskPatchSchema,
  TaskFiltersSchema,
  RelayConfigSchema,
} from "./schema.js";

export type TaskFrontmatter = z.infer<typeof TaskFrontmatterSchema>;

export type Task = TaskFrontmatter & {
  body: string;
  filePath: string;
};

export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export type TaskPatch = z.infer<typeof TaskPatchSchema>;

export type TaskFilters = z.infer<typeof TaskFiltersSchema>;

export type RelayConfig = z.infer<typeof RelayConfigSchema>;
