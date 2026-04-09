import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { CaretLeftIcon } from "@phosphor-icons/react";
import { useAppContext } from "../context/AppContext";
import { PlanList } from "../components/PlanList";
import { PlanKanbanBoard } from "../components/PlanKanbanBoard";
import { PlanDetail } from "../components/PlanDetail";
import { EmptyState, HintRow } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const plansSearchSchema = z.object({
  view: z.enum(["list", "board"]).catch("list"),
  status: z.array(z.string()).catch([]),
  project: z.array(z.string()).catch([]),
  q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/plans")({
  validateSearch: (search) => plansSearchSchema.parse(search),
  component: PlansRoute,
});

function PlansRoute() {
  const ctx = useAppContext();
  const navigate = useNavigate();
  const { view, status, project, q } = Route.useSearch();

  // Filter plans
  const filteredPlans = useMemo(() => {
    return ctx.plans.filter((p) => {
      if (q) {
        const query = q.toLowerCase();
        if (!p.title.toLowerCase().includes(query) && !p.body.toLowerCase().includes(query)) {
          return false;
        }
      }
      if (status.length > 0 && !status.includes(p.status)) return false;
      if (project.length > 0 && (!p.project || !project.includes(p.project))) return false;
      return true;
    });
  }, [ctx.plans, q, status, project]);

  const activePlan = ctx.plans.find((p) => p.id === ctx.activePlanId) ?? null;

  if (view === "board") {
    return (
      <div className="relative flex min-h-0 flex-1">
        {ctx.plans.length === 0 ? (
          <EmptyState
            className="flex-1"
            title="No plans yet"
            subtitle="Create your first plan to start brainstorming."
          >
            <HintRow><kbd>C</kbd> New plan</HintRow>
          </EmptyState>
        ) : filteredPlans.length === 0 ? (
          <EmptyState
            className="flex-1"
            title="No plans match"
            subtitle="Try adjusting your search or filters."
          />
        ) : (
          <PlanKanbanBoard
            plans={filteredPlans}
            activePlanId={ctx.activePlanId}
            hideBadges={ctx.hideItemBadges}
            onSelect={ctx.handleSelectPlan}
            onMove={ctx.handlePlanKanbanMove}
          />
        )}
        <Dialog
          open={activePlan !== null}
          onOpenChange={(open) => {
            if (!open) ctx.setActivePlanId(null);
          }}
        >
          <DialogContent className="flex max-h-[85vh] w-full max-w-[700px] flex-col gap-3 overflow-y-auto p-6 sm:max-w-[700px]">
            {activePlan && (
              <PlanDetail
                plan={activePlan}
                planMeta={ctx.planMeta}
                onUpdated={ctx.loadPlans}
                onDelete={ctx.handleDeleteRequest}
                onTaskClick={ctx.handlePlanTaskClick}
                onTasksCreated={ctx.loadTasks}
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
          {ctx.plans.length === 0 ? (
            <EmptyState
              title="No plans yet"
              subtitle="Create your first plan to start brainstorming."
            >
              <HintRow><kbd>C</kbd> New plan</HintRow>
            </EmptyState>
          ) : filteredPlans.length === 0 ? (
            <EmptyState
              title="No plans match"
              subtitle="Try adjusting your search or filters."
            />
          ) : (
            <PlanList
              plans={filteredPlans}
              activePlanId={ctx.activePlanId}
              hideBadges={ctx.hideItemBadges}
              onSelect={ctx.handleSelectPlan}
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
            <PlanTabBar />
          )}
          {activePlan ? (
            <PlanDetail
              plan={activePlan}
              planMeta={ctx.planMeta}
              onUpdated={ctx.loadPlans}
              onDelete={ctx.handleDeleteRequest}
              onTaskClick={ctx.handlePlanTaskClick}
              onTasksCreated={ctx.loadTasks}
            />
          ) : (
            <EmptyState title="No plan selected">
              <HintRow><kbd>&uarr;</kbd> <kbd>&darr;</kbd> Navigate</HintRow>
              <HintRow><kbd>Enter</kbd> Open</HintRow>
              <HintRow><kbd>C</kbd> New plan</HintRow>
              <HintRow><kbd>Esc</kbd> Deselect</HintRow>
            </EmptyState>
          )}
        </main>
      )}
    </div>
  );
}

function PlanTabBar() {
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
        const isActive = tabId === ctx.activePlanId;
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
                if (isTaskTab && !isPlanTab) {
                  navigate({ to: "/tasks", search: { view: "list", status: [], project: [], epic: [], sprint: [] } });
                  ctx.setActiveTaskId(tabId);
                } else {
                  ctx.setActivePlanId(tabId);
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
