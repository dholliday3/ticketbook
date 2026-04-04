import type { z } from "zod";
import type {
  TicketFrontmatterSchema,
  CreateTicketInputSchema,
  TicketPatchSchema,
  TicketFiltersSchema,
  TicketbookConfigSchema,
} from "./schema.js";

export type TicketFrontmatter = z.infer<typeof TicketFrontmatterSchema>;

export type Ticket = TicketFrontmatter & {
  body: string;
  filePath: string;
};

export type CreateTicketInput = z.infer<typeof CreateTicketInputSchema>;

export type TicketPatch = z.infer<typeof TicketPatchSchema>;

export type TicketFilters = z.infer<typeof TicketFiltersSchema>;

export type TicketbookConfig = z.infer<typeof TicketbookConfigSchema>;
