import { describe, test, expect } from "bun:test";
import {
  StatusEnum,
  PriorityEnum,
  TicketFrontmatterSchema,
  CreateTicketInputSchema,
  TicketPatchSchema,
  TicketFiltersSchema,
  TicketbookConfigSchema,
} from "./schema.js";

describe("StatusEnum", () => {
  test("accepts valid statuses", () => {
    for (const s of ["draft", "backlog", "open", "in-progress", "done", "cancelled"]) {
      expect(StatusEnum.parse(s)).toBe(s);
    }
  });

  test("rejects invalid status", () => {
    expect(() => StatusEnum.parse("invalid")).toThrow();
  });
});

describe("PriorityEnum", () => {
  test("accepts valid priorities", () => {
    for (const p of ["low", "medium", "high", "urgent"]) {
      expect(PriorityEnum.parse(p)).toBe(p);
    }
  });

  test("rejects invalid priority", () => {
    expect(() => PriorityEnum.parse("critical")).toThrow();
  });
});

describe("TicketFrontmatterSchema", () => {
  test("parses valid frontmatter with all fields", () => {
    const input = {
      id: "TKT-001",
      title: "Test ticket",
      status: "open",
      created: "2024-01-01T00:00:00.000Z",
      updated: "2024-01-01T00:00:00.000Z",
      priority: "high",
      order: 1000,
      tags: ["bug", "frontend"],
      project: "ticketbook",
      epic: "v1",
      sprint: "sprint-1",
    };
    const result = TicketFrontmatterSchema.parse(input);
    expect(result.id).toBe("TKT-001");
    expect(result.status).toBe("open");
    expect(result.priority).toBe("high");
    expect(result.tags).toEqual(["bug", "frontend"]);
  });

  test("parses frontmatter with only required fields", () => {
    const result = TicketFrontmatterSchema.parse({
      id: "TKT-001",
      title: "Test",
      status: "backlog",
      created: "2024-01-01",
      updated: "2024-01-01",
    });
    expect(result.priority).toBeUndefined();
    expect(result.order).toBeUndefined();
    expect(result.tags).toBeUndefined();
  });

  test("coerces date strings to Date objects", () => {
    const result = TicketFrontmatterSchema.parse({
      id: "TKT-001",
      title: "Test",
      status: "open",
      created: "2024-01-01",
      updated: "2024-06-15T12:00:00Z",
    });
    expect(result.created).toBeInstanceOf(Date);
    expect(result.updated).toBeInstanceOf(Date);
  });

  test("rejects uppercase tags", () => {
    expect(() =>
      TicketFrontmatterSchema.parse({
        id: "TKT-001",
        title: "Test",
        status: "open",
        created: "2024-01-01",
        updated: "2024-01-01",
        tags: ["Bug"],
      }),
    ).toThrow();
  });

  test("order is an optional float", () => {
    const result = TicketFrontmatterSchema.parse({
      id: "TKT-001",
      title: "Test",
      status: "open",
      created: "2024-01-01",
      updated: "2024-01-01",
      order: 1500.5,
    });
    expect(result.order).toBe(1500.5);
  });
});

describe("CreateTicketInputSchema", () => {
  test("defaults status to open", () => {
    const result = CreateTicketInputSchema.parse({ title: "New ticket" });
    expect(result.status).toBe("open");
  });

  test("rejects empty title", () => {
    expect(() => CreateTicketInputSchema.parse({ title: "" })).toThrow();
  });

  test("accepts optional body", () => {
    const result = CreateTicketInputSchema.parse({
      title: "Test",
      body: "Some content",
    });
    expect(result.body).toBe("Some content");
  });
});

describe("TicketPatchSchema", () => {
  test("all fields are optional", () => {
    const result = TicketPatchSchema.parse({});
    expect(result).toEqual({});
  });

  test("priority can be null (to clear)", () => {
    const result = TicketPatchSchema.parse({ priority: null });
    expect(result.priority).toBeNull();
  });

  test("project/epic/sprint can be null (to clear)", () => {
    const result = TicketPatchSchema.parse({
      project: null,
      epic: null,
      sprint: null,
    });
    expect(result.project).toBeNull();
    expect(result.epic).toBeNull();
    expect(result.sprint).toBeNull();
  });
});

describe("TicketFiltersSchema", () => {
  test("accepts single status", () => {
    const result = TicketFiltersSchema.parse({ status: "open" });
    expect(result.status).toBe("open");
  });

  test("accepts array of statuses", () => {
    const result = TicketFiltersSchema.parse({
      status: ["open", "in-progress"],
    });
    expect(result.status).toEqual(["open", "in-progress"]);
  });
});

describe("TicketbookConfigSchema", () => {
  test("provides defaults for empty object", () => {
    const result = TicketbookConfigSchema.parse({});
    expect(result.prefix).toBe("TASK");
    expect(result.deleteMode).toBe("archive");
  });

  test("accepts custom prefix", () => {
    const result = TicketbookConfigSchema.parse({ prefix: "ART" });
    expect(result.prefix).toBe("ART");
  });
});
