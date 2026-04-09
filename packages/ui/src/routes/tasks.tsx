import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { CaretLeftIcon } from "@phosphor-icons/react";
import { useAppContext } from "../context/AppContext";
import { TaskList } from "../components/TaskList";
import { KanbanBoard } from "../components/KanbanBoard";
import { TaskDetail } from "../components/TaskDetail";
import { EmptyState, HintRow } from "../components/EmptyState";
import {
  Dialog,
  DialogContent,
} from "../components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Status, Task } from "../types";

const tasksSearchSchema = z.object({
  view: z.enum(["list", "board"]).catch("list"),
  status: z.array(z.string()).catch([]),
  project: z.array(z.string()).catch([]),
  epic: z.array(z.string()).catch([]),
  sprint: z.array(z.string()).catch([]),
  q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/tasks")({
  validateSearch: (search) => tasksSearchSchema.parse(search),
  component: TasksRoute,
});

function TasksRoute() {
  const ctx = useAppContext();
  const navigate = useNavigate();
  const { view, status, project, epic, sprint, q } = Route.useSearch();

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return ctx.tasks.filter((t) => {
      if (q) {
        const query = q.toLowerCase();
        if (!t.title.toLowerCase().includes(query) && !t.body.toLowerCase().includes(query)) {
          return false;
        }
      }
      if (status.length > 0 && !status.includes(t.status)) return false;
      if (project.length > 0 && (!t.project || !project.includes(t.project))) return false;
      if (epic.length > 0 && (!t.epic || !epic.includes(t.epic))) return false;
      if (sprint.length > 0 && (!t.sprint || !sprint.includes(t.sprint))) return false;
      return true;
    });
  }, [ctx.tasks, q, status, project, epic, sprint]);

  const activeTask = ctx.tasks.find((t) => t.id === ctx.activeTaskId) ?? null;

  if (view === "board") {
    return (
      <div className="relative flex min-h-0 flex-1">
        {ctx.tasks.length === 0 ? (
          <EmptyState
            className="flex-1"
            title="Welcome to Ticketbook"
            subtitle="Create your first task to get started."
          >
            <HintRow><kbd>C</kbd> New task</HintRow>
          </EmptyState>
        ) : filteredTasks.length === 0 ? (
          <EmptyState
            className="flex-1"
            title="No tasks match"
            subtitle="Try adjusting your search or filters."
          />
        ) : (
          <KanbanBoard
            tasks={filteredTasks}
            activeTaskId={ctx.activeTaskId}
            hideBadges={ctx.hideItemBadges}
            onSelect={ctx.handleSelect}
            onMove={ctx.handleKanbanMove}
            onCreateInColumn={ctx.handleCreateInColumn}
          />
        )}
        <Dialog
          open={activeTask != null}
          onOpenChange={(open) => {
            if (!open) ctx.setActiveTaskId(null);
          }}
        >
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto p-6 pt-10">
            {activeTask && (
              <TaskDetail
                task={activeTask}
                meta={ctx.meta}
                onUpdated={ctx.loadTasks}
                onDelete={ctx.handleDeleteRequest}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // List view
  return (
    <div className="flex min-h-0 flex-1">
      {(!ctx.isMobile || !ctx.mobileShowDetail) && (
        <aside className="flex min-h-0 w-[300px] min-w-[300px] flex-col overflow-y-auto border-r border-border bg-card md:w-[300px] max-md:w-full max-md:min-w-0 max-md:border-r-0">
          {ctx.tasks.length === 0 ? (
            <EmptyState
              title="Welcome to Ticketbook"
              subtitle="Create your first task to get started."
            >
              <HintRow><kbd>C</kbd> New task</HintRow>
            </EmptyState>
          ) : filteredTasks.length === 0 ? (
            <EmptyState
              title="No tasks match"
              subtitle="Try adjusting your search or filters."
            />
          ) : (
            <TaskList
              tasks={filteredTasks}
              activeTaskId={ctx.activeTaskId}
              hideBadges={ctx.hideItemBadges}
              onSelect={ctx.handleSelect}
              onReorder={ctx.handleReorder}
              onMove={ctx.handleKanbanMove}
              onCreateInStatus={ctx.handleCreateInColumn}
            />
          )}
        </aside>
      )}
      {(!ctx.isMobile || ctx.mobileShowDetail) && (
        <main className="min-h-0 flex-1 overflow-y-auto p-6 max-md:w-full">
          {ctx.isMobile && (
            <Button
              variant="outline"
              size="sm"
              className="mb-3"
              onClick={ctx.handleMobileBack}
            >
              <CaretLeftIcon />
              Back
            </Button>
          )}
          {ctx.openTabs.length > 0 && !ctx.isMobile && (
            <TabBar />
          )}
          {activeTask ? (
            <div className="pt-4">
              <TaskDetail
                task={activeTask}
                meta={ctx.meta}
                onUpdated={ctx.loadTasks}
                onDelete={ctx.handleDeleteRequest}
              />
            </div>
          ) : (
            <EmptyState title="No task selected">
              <HintRow><kbd>&uarr;</kbd> <kbd>&darr;</kbd> Navigate</HintRow>
              <HintRow><kbd>Enter</kbd> Open</HintRow>
              <HintRow><kbd>C</kbd> New task</HintRow>
              <HintRow><kbd>Esc</kbd> Deselect</HintRow>
            </EmptyState>
          )}
        </main>
      )}
    </div>
  );
}

function TabBar() {
  const ctx = useAppContext();
  const navigate = useNavigate();

  return (
    <div className="flex shrink-0 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ctx.openTabs.map((tabId) => {
        const isTaskTab = ctx.tasks.some((tk) => tk.id === tabId);
        const isPlanTab = ctx.plans.some((p) => p.id === tabId);
        const tabTitle =
          ctx.tasks.find((tk) => tk.id === tabId)?.title ??
          ctx.plans.find((p) => p.id === tabId)?.title ??
          tabId;
        const isActive = tabId === ctx.activeTaskId;
        const isPlanOnly = isPlanTab && !isTaskTab;
        return (
          <div
            key={tabId}
            className={cn(
              "group/tab flex max-w-[180px] shrink-0 items-center gap-0.5 border-r border-border",
              isActive && "border-b-2 border-b-primary bg-background",
            )}
          >
            <button
              type="button"
              className={cn(
                "cursor-pointer truncate border-0 bg-transparent py-1.5 pl-3 pr-2 text-xs transition-colors hover:text-foreground",
                isActive ? "font-medium text-foreground" : "text-muted-foreground",
                isPlanOnly && "italic",
              )}
              onClick={() => {
                if (isPlanOnly) {
                  navigate({ to: "/plans", search: { view: "list", status: [], project: [] } });
                  ctx.setActivePlanId(tabId);
                } else {
                  ctx.setActiveTaskId(tabId);
                }
              }}
            >
              {tabTitle}
            </button>
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent py-0.5 pl-0.5 pr-1.5 text-sm leading-none text-muted-foreground opacity-0 transition-opacity group-hover/tab:opacity-100 hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                ctx.handleCloseTab(tabId);
              }}
              aria-label="Close tab"
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}
