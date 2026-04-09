import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  listTickets,
  getTicket,
  createTicket,
  updateTicket,
  deleteTicket,
  toggleSubtask,
  addSubtask,
  reorderTicket,
  sortTickets,
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  cutTicketsFromPlan,
} from "@ticketbook/core";
import type { Plan } from "@ticketbook/core";

function ticketSummary(t: {
  id: string;
  title: string;
  status: string;
  priority?: string;
  project?: string;
  epic?: string;
  sprint?: string;
  tags?: string[];
  order?: number;
  created: Date;
  updated: Date;
}): string {
  const parts = [`[${t.id}] ${t.title}`, `status: ${t.status}`];
  if (t.priority) parts.push(`priority: ${t.priority}`);
  if (t.project) parts.push(`project: ${t.project}`);
  if (t.epic) parts.push(`epic: ${t.epic}`);
  if (t.sprint) parts.push(`sprint: ${t.sprint}`);
  if (t.tags && t.tags.length > 0) parts.push(`tags: ${t.tags.join(", ")}`);
  return parts.join(" | ");
}

function formatTicketFull(t: {
  id: string;
  title: string;
  status: string;
  priority?: string;
  project?: string;
  epic?: string;
  sprint?: string;
  tags?: string[];
  order?: number;
  created: Date;
  updated: Date;
  body: string;
}): string {
  const lines = [
    `# ${t.id}: ${t.title}`,
    "",
    `- Status: ${t.status}`,
    `- Priority: ${t.priority ?? "none"}`,
  ];
  if (t.project) lines.push(`- Project: ${t.project}`);
  if (t.epic) lines.push(`- Epic: ${t.epic}`);
  if (t.sprint) lines.push(`- Sprint: ${t.sprint}`);
  if (t.tags && t.tags.length > 0)
    lines.push(`- Tags: ${t.tags.join(", ")}`);
  if ((t as any).assignee) lines.push(`- Assignee: ${(t as any).assignee}`);
  if ((t as any).blockedBy?.length) lines.push(`- Blocked by: ${(t as any).blockedBy.join(", ")}`);
  if ((t as any).relatedTo?.length) lines.push(`- Related to: ${(t as any).relatedTo.join(", ")}`);
  if ((t as any).refs?.length) lines.push(`- Refs: ${(t as any).refs.join(", ")}`);
  if (t.order != null) lines.push(`- Order: ${t.order}`);
  lines.push(`- Created: ${t.created.toISOString()}`);
  lines.push(`- Updated: ${t.updated.toISOString()}`);
  if (t.body) {
    lines.push("", "---", "", t.body);
  }
  return lines.join("\n");
}

function planSummary(p: Plan): string {
  const parts = [`[${p.id}] ${p.title}`, `status: ${p.status}`];
  if (p.project) parts.push(`project: ${p.project}`);
  if (p.tags && p.tags.length > 0) parts.push(`tags: ${p.tags.join(", ")}`);
  if (p.tickets && p.tickets.length > 0) parts.push(`tickets: ${p.tickets.join(", ")}`);
  return parts.join(" | ");
}

function formatPlanFull(p: Plan): string {
  const lines = [
    `# ${p.id}: ${p.title}`,
    "",
    `- Status: ${p.status}`,
  ];
  if (p.project) lines.push(`- Project: ${p.project}`);
  if (p.tags && p.tags.length > 0) lines.push(`- Tags: ${p.tags.join(", ")}`);
  if (p.tickets && p.tickets.length > 0) lines.push(`- Linked tasks: ${p.tickets.join(", ")}`);
  if (p.refs && p.refs.length > 0) lines.push(`- Refs: ${p.refs.join(", ")}`);
  lines.push(`- Created: ${p.created.toISOString()}`);
  lines.push(`- Updated: ${p.updated.toISOString()}`);
  if (p.body) {
    lines.push("", "---", "", p.body);
  }
  return lines.join("\n");
}

export async function startMcpServer(ticketsDir: string, plansDir?: string): Promise<void> {
  const server = new McpServer({
    name: "ticketbook",
    version: "0.1.0",
  });

  // --- Agent workflow instructions (exposed via list_tasks description) ---

  // --- list_tasks ---
  server.tool(
    "list_tasks",
    "List tasks with optional filters. Returns compact summaries sorted by order/priority/date. Agent workflow: when picking up a ticket, set its status to 'in-progress' and assignee to your agent name. When done, set status to 'done' and add a debrief to agent notes (body after '<!-- agent-notes -->' marker).",
    {
      status: z
        .enum(["draft", "backlog", "open", "in-progress", "done", "cancelled"])
        .optional()
        .describe("Filter by status"),
      priority: z
        .enum(["low", "medium", "high", "urgent"])
        .optional()
        .describe("Filter by priority"),
      project: z.string().optional().describe("Filter by project name"),
      epic: z.string().optional().describe("Filter by epic name"),
      sprint: z.string().optional().describe("Filter by sprint name"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter by tags (all must match)"),
    },
    async (args) => {
      const filters: Record<string, unknown> = {};
      if (args.status) filters.status = args.status;
      if (args.priority) filters.priority = args.priority;
      if (args.project) filters.project = args.project;
      if (args.epic) filters.epic = args.epic;
      if (args.sprint) filters.sprint = args.sprint;
      if (args.tags) filters.tags = args.tags;

      const tickets = await listTickets(
        ticketsDir,
        Object.keys(filters).length > 0 ? filters : undefined,
      );
      const sorted = sortTickets(tickets);

      if (sorted.length === 0) {
        return { content: [{ type: "text", text: "No tasks found." }] };
      }

      const text = sorted.map((t) => ticketSummary(t)).join("\n");
      return {
        content: [
          { type: "text", text: `${sorted.length} task(s):\n\n${text}` },
        ],
      };
    },
  );

  // --- get_task ---
  server.tool(
    "get_task",
    "Get full details of a task by ID, including body content.",
    {
      id: z.string().describe("Task ID (e.g. TKT-001)"),
    },
    async (args) => {
      const ticket = await getTicket(ticketsDir, args.id);
      if (!ticket) {
        return {
          content: [
            { type: "text", text: `Task not found: ${args.id}` },
          ],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: formatTicketFull(ticket) }] };
    },
  );

  // --- create_task ---
  server.tool(
    "create_task",
    "Create a new task. Returns the created ticket details.",
    {
      title: z.string().min(1).describe("Task title (required)"),
      status: z
        .enum(["draft", "backlog", "open", "in-progress", "done", "cancelled"])
        .optional()
        .describe("Initial status (default: open)"),
      priority: z
        .enum(["low", "medium", "high", "urgent"])
        .optional()
        .describe("Priority level"),
      tags: z.array(z.string()).optional().describe("Tags (lowercase)"),
      project: z.string().optional().describe("Project name"),
      epic: z.string().optional().describe("Epic name"),
      sprint: z.string().optional().describe("Sprint name"),
      body: z.string().optional().describe("Markdown body content"),
      blockedBy: z.array(z.string()).optional().describe("Task IDs that block this ticket"),
      relatedTo: z.array(z.string()).optional().describe("Related task IDs"),
      assignee: z.string().optional().describe("Assignee name (use your agent name when picking up a ticket)"),
    },
    async (args) => {
      const ticket = await createTicket(ticketsDir, args);
      return {
        content: [
          {
            type: "text",
            text: `Created ${ticket.id}: ${ticket.title}\n\n${formatTicketFull(ticket)}`,
          },
        ],
      };
    },
  );

  // --- update_task ---
  server.tool(
    "update_task",
    "Update an existing task's fields. Only provided fields are changed.",
    {
      id: z.string().describe("Task ID to update"),
      title: z.string().min(1).optional().describe("New title"),
      status: z
        .enum(["draft", "backlog", "open", "in-progress", "done", "cancelled"])
        .optional()
        .describe("New status"),
      priority: z
        .enum(["low", "medium", "high", "urgent"])
        .nullable()
        .optional()
        .describe("New priority (null to clear)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("New tags (replaces existing)"),
      project: z
        .string()
        .nullable()
        .optional()
        .describe("New project (null to clear)"),
      epic: z
        .string()
        .nullable()
        .optional()
        .describe("New epic (null to clear)"),
      sprint: z
        .string()
        .nullable()
        .optional()
        .describe("New sprint (null to clear)"),
      body: z.string().optional().describe("New markdown body content"),
      blockedBy: z.array(z.string()).optional().describe("Task IDs that block this ticket"),
      relatedTo: z.array(z.string()).optional().describe("Related task IDs"),
      assignee: z.string().nullable().optional().describe("Assignee (null to clear). Set to your agent name when starting work."),
    },
    async (args) => {
      const { id, ...patch } = args;
      const ticket = await updateTicket(ticketsDir, id, patch);
      return {
        content: [
          {
            type: "text",
            text: `Updated ${ticket.id}\n\n${formatTicketFull(ticket)}`,
          },
        ],
      };
    },
  );

  // --- link_ref ---
  server.tool(
    "link_ref",
    "Link a commit SHA or PR URL to a task. Use this after creating a commit or PR that addresses a ticket. Convention: include the task ID in your commit message (e.g. 'TKTB-015: fix bug').",
    {
      id: z.string().describe("Task ID to link to"),
      ref: z.string().describe("Commit SHA or PR URL to link"),
    },
    async (args) => {
      const ticket = await getTicket(ticketsDir, args.id);
      if (!ticket) {
        return { content: [{ type: "text", text: `Task not found: ${args.id}` }] };
      }
      const existingRefs = ticket.refs ?? [];
      if (existingRefs.includes(args.ref)) {
        return { content: [{ type: "text", text: `Ref already linked to ${args.id}` }] };
      }
      await updateTicket(ticketsDir, args.id, { refs: [...existingRefs, args.ref] });
      return {
        content: [{ type: "text", text: `Linked ${args.ref} to ${args.id}` }],
      };
    },
  );

  // --- delete_task ---
  server.tool(
    "delete_task",
    "Delete (archive) a task by ID.",
    {
      id: z.string().describe("Task ID to delete"),
    },
    async (args) => {
      await deleteTicket(ticketsDir, args.id);
      return {
        content: [{ type: "text", text: `Deleted ticket ${args.id}` }],
      };
    },
  );

  // --- complete_subtask ---
  server.tool(
    "complete_subtask",
    "Mark a subtask as done. Provide either the subtask index (0-based) or a text substring to match.",
    {
      id: z.string().describe("Task ID"),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("0-based subtask index"),
      text: z
        .string()
        .optional()
        .describe("Substring to match against subtask text"),
    },
    async (args) => {
      // Resolve the subtask index
      let taskIndex: number;

      if (args.index != null) {
        taskIndex = args.index;
      } else if (args.text) {
        // Read ticket body to find matching subtask
        const ticket = await getTicket(ticketsDir, args.id);
        if (!ticket) {
          return {
            content: [
              { type: "text", text: `Task not found: ${args.id}` },
            ],
            isError: true,
          };
        }

        const checkboxRegex = /^\s*- \[( |x)\]\s*(.*)$/;
        const lines = ticket.body.split("\n");
        let foundIndex = -1;
        let idx = 0;
        const query = args.text.toLowerCase();

        for (const line of lines) {
          const match = line.match(checkboxRegex);
          if (match) {
            if (match[2].toLowerCase().includes(query)) {
              foundIndex = idx;
              break;
            }
            idx++;
          }
        }

        if (foundIndex === -1) {
          return {
            content: [
              {
                type: "text",
                text: `No subtask matching "${args.text}" found in ${args.id}`,
              },
            ],
            isError: true,
          };
        }

        taskIndex = foundIndex;
      } else {
        return {
          content: [
            {
              type: "text",
              text: "Provide either 'index' or 'text' to identify the subtask",
            },
          ],
          isError: true,
        };
      }

      // Check if already complete before toggling
      const ticket = await getTicket(ticketsDir, args.id);
      if (!ticket) {
        return {
          content: [
            { type: "text", text: `Task not found: ${args.id}` },
          ],
          isError: true,
        };
      }

      const checkboxRegex = /^\s*- \[( |x)\]\s*(.*)$/;
      const lines = ticket.body.split("\n");
      let idx = 0;
      for (const line of lines) {
        const match = line.match(checkboxRegex);
        if (match) {
          if (idx === taskIndex) {
            if (match[1] === "x") {
              return {
                content: [
                  {
                    type: "text",
                    text: `Subtask ${taskIndex} is already complete: ${match[2].trim()}`,
                  },
                ],
              };
            }
            break;
          }
          idx++;
        }
      }

      const updated = await toggleSubtask(ticketsDir, args.id, taskIndex);
      return {
        content: [
          {
            type: "text",
            text: `Completed subtask ${taskIndex} in ${updated.id}`,
          },
        ],
      };
    },
  );

  // --- add_subtask ---
  server.tool(
    "add_subtask",
    "Add a new subtask (checkbox item) to a ticket.",
    {
      id: z.string().describe("Task ID"),
      text: z.string().min(1).describe("Subtask text"),
    },
    async (args) => {
      const updated = await addSubtask(ticketsDir, args.id, args.text);
      return {
        content: [
          {
            type: "text",
            text: `Added subtask to ${updated.id}: ${args.text}`,
          },
        ],
      };
    },
  );

  // --- reorder_task ---
  server.tool(
    "reorder_task",
    "Reorder a task by placing it between two neighbors within its status group.",
    {
      id: z.string().describe("Task ID to move"),
      afterId: z
        .string()
        .nullable()
        .optional()
        .describe("Task ID above (null for top)"),
      beforeId: z
        .string()
        .nullable()
        .optional()
        .describe("Task ID below (null for bottom)"),
    },
    async (args) => {
      const updated = await reorderTicket(
        ticketsDir,
        args.id,
        args.afterId ?? null,
        args.beforeId ?? null,
      );
      return {
        content: [
          {
            type: "text",
            text: `Reordered ${updated.id} (new order: ${updated.order})`,
          },
        ],
      };
    },
  );

  // --- Resource: tasks://list ---
  server.resource(
    "task-list",
    "tasks://list",
    { description: "Full ticket list in compact format", mimeType: "text/plain" },
    async () => {
      const tickets = await listTickets(ticketsDir);
      const sorted = sortTickets(tickets);
      const text =
        sorted.length === 0
          ? "No tasks found."
          : sorted.map((t) => ticketSummary(t)).join("\n");
      return {
        contents: [{ uri: "tasks://list", text, mimeType: "text/plain" }],
      };
    },
  );

  // --- Prompt: ticket-context ---
  server.prompt(
    "task-context",
    "Get formatted context for working on a specific task, including details, subtasks, and related tickets",
    { id: z.string().describe("Task ID (e.g. TKT-001)") },
    async (args) => {
      const ticket = await getTicket(ticketsDir, args.id);
      if (!ticket) {
        return {
          messages: [
            {
              role: "user" as const,
              content: { type: "text" as const, text: `Task not found: ${args.id}` },
            },
          ],
        };
      }

      const sections: string[] = [];

      // Ticket details
      sections.push(formatTicketFull(ticket));

      // Subtasks summary
      const checkboxRegex = /^\s*- \[( |x)\]\s*(.*)$/;
      const subtasks = ticket.body
        .split("\n")
        .filter((line) => checkboxRegex.test(line));
      if (subtasks.length > 0) {
        const done = subtasks.filter((l) => l.includes("[x]")).length;
        sections.push(
          `\n## Subtasks (${done}/${subtasks.length} complete)\n${subtasks.join("\n")}`,
        );
      }

      // Related tasks (same project or epic)
      const related: string[] = [];
      if (ticket.project || ticket.epic) {
        const allTickets = await listTickets(ticketsDir);
        const sorted = sortTickets(allTickets);
        for (const t of sorted) {
          if (t.id === ticket.id) continue;
          const sameProject = ticket.project && t.project === ticket.project;
          const sameEpic = ticket.epic && t.epic === ticket.epic;
          if (sameProject || sameEpic) {
            related.push(ticketSummary(t));
          }
        }
      }
      if (related.length > 0) {
        sections.push(`\n## Related Tickets\n${related.join("\n")}`);
      }

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Here is the context for task ${ticket.id}. Please review and begin work.\n\n${sections.join("\n")}`,
            },
          },
        ],
      };
    },
  );

  // --- Plan tools ---
  if (plansDir) {
    // --- list_plans ---
    server.tool(
      "list_plans",
      "List plans with optional filters. Plans are strategic documents (PRDs, feature specs, brainstorms) that can link to tickets.",
      {
        status: z
          .enum(["draft", "active", "completed", "archived"])
          .optional()
          .describe("Filter by status"),
        project: z.string().optional().describe("Filter by project name"),
        tags: z
          .array(z.string())
          .optional()
          .describe("Filter by tags (all must match)"),
      },
      async (args) => {
        const filters: Record<string, unknown> = {};
        if (args.status) filters.status = args.status;
        if (args.project) filters.project = args.project;
        if (args.tags) filters.tags = args.tags;

        const plans = await listPlans(
          plansDir,
          Object.keys(filters).length > 0 ? filters : undefined,
        );

        if (plans.length === 0) {
          return { content: [{ type: "text", text: "No plans found." }] };
        }

        const text = plans.map((p) => planSummary(p)).join("\n");
        return {
          content: [
            { type: "text", text: `${plans.length} plan(s):\n\n${text}` },
          ],
        };
      },
    );

    // --- get_plan ---
    server.tool(
      "get_plan",
      "Get full details of a plan by ID, including body content.",
      {
        id: z.string().describe("Plan ID (e.g. PLAN-001)"),
      },
      async (args) => {
        const plan = await getPlan(plansDir, args.id);
        if (!plan) {
          return {
            content: [{ type: "text", text: `Plan not found: ${args.id}` }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: formatPlanFull(plan) }] };
      },
    );

    // --- create_plan ---
    server.tool(
      "create_plan",
      "Create a new plan. Plans are strategic documents for brainstorming, feature specs, or PRDs.",
      {
        title: z.string().min(1).describe("Plan title (required)"),
        status: z
          .enum(["draft", "active", "completed", "archived"])
          .optional()
          .describe("Initial status (default: draft)"),
        tags: z.array(z.string()).optional().describe("Tags (lowercase)"),
        project: z.string().optional().describe("Project name"),
        tickets: z.array(z.string()).optional().describe("Linked task IDs"),
        body: z.string().optional().describe("Markdown body content"),
      },
      async (args) => {
        const plan = await createPlan(ticketsDir, plansDir, args);
        return {
          content: [
            {
              type: "text",
              text: `Created ${plan.id}: ${plan.title}\n\n${formatPlanFull(plan)}`,
            },
          ],
        };
      },
    );

    // --- update_plan ---
    server.tool(
      "update_plan",
      "Update an existing plan's fields. Only provided fields are changed.",
      {
        id: z.string().describe("Plan ID to update"),
        title: z.string().min(1).optional().describe("New title"),
        status: z
          .enum(["draft", "active", "completed", "archived"])
          .optional()
          .describe("New status"),
        tags: z
          .array(z.string())
          .optional()
          .describe("New tags (replaces existing)"),
        project: z
          .string()
          .nullable()
          .optional()
          .describe("New project (null to clear)"),
        tickets: z
          .array(z.string())
          .optional()
          .describe("Linked task IDs (replaces existing)"),
        body: z.string().optional().describe("New markdown body content"),
      },
      async (args) => {
        const { id, ...patch } = args;
        const plan = await updatePlan(plansDir, id, patch);
        return {
          content: [
            {
              type: "text",
              text: `Updated ${plan.id}\n\n${formatPlanFull(plan)}`,
            },
          ],
        };
      },
    );

    // --- delete_plan ---
    server.tool(
      "delete_plan",
      "Delete (archive) a plan by ID.",
      {
        id: z.string().describe("Plan ID to delete"),
      },
      async (args) => {
        await deletePlan(ticketsDir, plansDir, args.id);
        return {
          content: [{ type: "text", text: `Deleted plan ${args.id}` }],
        };
      },
    );

    // --- link_task_to_plan ---
    server.tool(
      "link_task_to_plan",
      "Link a task ID to a plan. Adds the ticket to the plan's linked tickets list.",
      {
        planId: z.string().describe("Plan ID"),
        ticketId: z.string().describe("Task ID to link"),
      },
      async (args) => {
        const plan = await getPlan(plansDir, args.planId);
        if (!plan) {
          return {
            content: [{ type: "text", text: `Plan not found: ${args.planId}` }],
            isError: true,
          };
        }
        const existingTickets = plan.tickets ?? [];
        if (existingTickets.includes(args.ticketId)) {
          return {
            content: [{ type: "text", text: `Ticket ${args.ticketId} already linked to ${args.planId}` }],
          };
        }
        await updatePlan(plansDir, args.planId, {
          tickets: [...existingTickets, args.ticketId],
        });
        return {
          content: [{ type: "text", text: `Linked ${args.ticketId} to plan ${args.planId}` }],
        };
      },
    );

    // --- cut_tasks_from_plan ---
    server.tool(
      "cut_tasks_from_plan",
      "Parse unchecked checkboxes from a plan's body, create a task for each, link them to the plan, and check off the items. Great for converting brainstorm items into actionable tasks.",
      {
        planId: z.string().describe("Plan ID to cut tasks from"),
      },
      async (args) => {
        const result = await cutTicketsFromPlan(ticketsDir, plansDir, args.planId);
        if (result.createdTickets.length === 0) {
          return {
            content: [{ type: "text", text: `No unchecked items found in ${args.planId}` }],
          };
        }
        const ticketList = result.createdTickets
          .map((t) => `  - ${t.id}: ${t.title}`)
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: `Cut ${result.createdTickets.length} task(s) from plan ${args.planId}:\n${ticketList}`,
            },
          ],
        };
      },
    );

    // --- Resource: plans://list ---
    server.resource(
      "plan-list",
      "plans://list",
      { description: "Full plan list in compact format", mimeType: "text/plain" },
      async () => {
        const plans = await listPlans(plansDir);
        const text =
          plans.length === 0
            ? "No plans found."
            : plans.map((p) => planSummary(p)).join("\n");
        return {
          contents: [{ uri: "plans://list", text, mimeType: "text/plain" }],
        };
      },
    );

    // --- Prompt: plan-context ---
    server.prompt(
      "plan-context",
      "Get formatted context for working on a plan, including linked tickets",
      { id: z.string().describe("Plan ID (e.g. PLAN-001)") },
      async (args) => {
        const plan = await getPlan(plansDir, args.id);
        if (!plan) {
          return {
            messages: [
              {
                role: "user" as const,
                content: { type: "text" as const, text: `Plan not found: ${args.id}` },
              },
            ],
          };
        }

        const sections: string[] = [formatPlanFull(plan)];

        // Include linked ticket summaries
        if (plan.tickets && plan.tickets.length > 0) {
          const ticketDetails: string[] = [];
          for (const tid of plan.tickets) {
            const ticket = await getTicket(ticketsDir, tid);
            if (ticket) {
              ticketDetails.push(ticketSummary(ticket));
            } else {
              ticketDetails.push(`[${tid}] (not found)`);
            }
          }
          sections.push(`\n## Linked Tickets\n${ticketDetails.join("\n")}`);
        }

        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `Here is the context for plan ${plan.id}. Review and provide input.\n\n${sections.join("\n")}`,
              },
            },
          ],
        };
      },
    );
  }

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
