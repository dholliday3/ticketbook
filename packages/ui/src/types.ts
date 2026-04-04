export interface Ticket {
  id: string;
  title: string;
  status: "draft" | "backlog" | "open" | "in-progress" | "done" | "cancelled";
  created: string;
  updated: string;
  priority?: "low" | "medium" | "high" | "urgent";
  order?: number;
  tags?: string[];
  project?: string;
  epic?: string;
  sprint?: string;
  blockedBy?: string[];
  relatedTo?: string[];
  assignee?: string;
  refs?: string[];
  body: string;
  filePath: string;
}

export type Status = Ticket["status"];
export type Priority = Ticket["priority"];

export interface TicketPatch {
  title?: string;
  status?: Status;
  priority?: Priority | null;
  project?: string | null;
  epic?: string | null;
  sprint?: string | null;
  tags?: string[];
  blockedBy?: string[];
  relatedTo?: string[];
  assignee?: string | null;
}

export interface Meta {
  projects: string[];
  epics: string[];
  sprints: string[];
  tags: string[];
}

export type DebriefStyle = "very-concise" | "concise" | "detailed" | "lengthy";

export interface TicketbookConfig {
  prefix: string;
  deleteMode: "archive" | "hard";
  debriefStyle: DebriefStyle;
}

export interface CreateTicketInput {
  title: string;
  status?: Status;
  priority?: Priority;
  project?: string;
  epic?: string;
  sprint?: string;
  tags?: string[];
  body?: string;
}
