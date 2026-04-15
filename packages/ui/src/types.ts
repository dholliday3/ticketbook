export interface Task {
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

export type Status = Task["status"];
export type Priority = Task["priority"];

export interface TaskPatch {
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

export interface RelayConfig {
  prefix: string;
  deleteMode: "archive" | "hard";
  debriefStyle: DebriefStyle;
}

export interface CreateTaskInput {
  title: string;
  status?: Status;
  priority?: Priority;
  project?: string;
  epic?: string;
  sprint?: string;
  tags?: string[];
  body?: string;
}

// --- Plans ---

export interface Plan {
  id: string;
  title: string;
  status: "draft" | "active" | "completed" | "archived";
  created: string;
  updated: string;
  tags?: string[];
  project?: string;
  tasks?: string[];
  refs?: string[];
  body: string;
  filePath: string;
}

export type PlanStatus = Plan["status"];

export interface PlanPatch {
  title?: string;
  status?: PlanStatus;
  tags?: string[];
  project?: string | null;
  tasks?: string[];
  refs?: string[];
}

export interface CreatePlanInput {
  title: string;
  status?: PlanStatus;
  tags?: string[];
  project?: string;
  body?: string;
}

export interface PlanMeta {
  projects: string[];
  tags: string[];
}

export interface Doc {
  id: string;
  title: string;
  created: string;
  updated: string;
  tags?: string[];
  project?: string;
  refs?: string[];
  body: string;
  filePath: string;
}

export interface DocPatch {
  title?: string;
  tags?: string[];
  project?: string | null;
  refs?: string[];
}

export interface CreateDocInput {
  title: string;
  tags?: string[];
  project?: string;
  refs?: string[];
  body?: string;
}

export interface DocMeta {
  projects: string[];
  tags: string[];
}
