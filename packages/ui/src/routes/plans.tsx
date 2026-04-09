import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { useAppContext } from "../context/AppContext";
import { PlanList } from "../components/PlanList";
import { PlanKanbanBoard } from "../components/PlanKanbanBoard";
import { PlanDetail } from "../components/PlanDetail";
import { Dialog, DialogContent } from "@/components/ui/dialog";

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
      <div className="board-content">
        {ctx.plans.length === 0 ? (
          <div className="empty-state" style={{ flex: 1 }}>
            <div className="empty-state-content">
              <p className="empty-state-title">No plans yet</p>
              <p className="empty-state-subtitle">Create your first plan to start brainstorming.</p>
              <div className="empty-state-hints">
                <span className="hint-row"><kbd>C</kbd> New plan</span>
              </div>
            </div>
          </div>
        ) : filteredPlans.length === 0 ? (
          <div className="empty-state" style={{ flex: 1 }}>
            <div className="empty-state-content">
              <p className="empty-state-title">No plans match</p>
              <p className="empty-state-subtitle">Try adjusting your search or filters.</p>
            </div>
          </div>
        ) : (
          <PlanKanbanBoard
            plans={filteredPlans}
            activePlanId={ctx.activePlanId}
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
                onTicketClick={ctx.handlePlanTicketClick}
                onTicketsCreated={ctx.loadTickets}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // List view
  return (
    <div className="list-content">
      {(!ctx.isMobile || !ctx.mobileShowDetail) && (
        <aside className="list-panel">
          {ctx.plans.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-content">
                <p className="empty-state-title">No plans yet</p>
                <p className="empty-state-subtitle">Create your first plan to start brainstorming.</p>
                <div className="empty-state-hints">
                  <span className="hint-row"><kbd>C</kbd> New plan</span>
                </div>
              </div>
            </div>
          ) : filteredPlans.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-content">
                <p className="empty-state-title">No plans match</p>
                <p className="empty-state-subtitle">Try adjusting your search or filters.</p>
              </div>
            </div>
          ) : (
            <PlanList
              plans={filteredPlans}
              activePlanId={ctx.activePlanId}
              onSelect={ctx.handleSelectPlan}
            />
          )}
        </aside>
      )}
      {(!ctx.isMobile || ctx.mobileShowDetail) && (
        <main className="detail-panel">
          {ctx.isMobile && (
            <button className="mobile-back-btn" onClick={ctx.handleMobileBack}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </button>
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
              onTicketClick={ctx.handlePlanTicketClick}
              onTicketsCreated={ctx.loadTickets}
            />
          ) : (
            <div className="empty-state">
              <div className="empty-state-content">
                <p className="empty-state-title">No plan selected</p>
                <div className="empty-state-hints">
                  <span className="hint-row"><kbd>&uarr;</kbd> <kbd>&darr;</kbd> Navigate</span>
                  <span className="hint-row"><kbd>Enter</kbd> Open</span>
                  <span className="hint-row"><kbd>C</kbd> New plan</span>
                  <span className="hint-row"><kbd>Esc</kbd> Deselect</span>
                </div>
              </div>
            </div>
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
    <div className="tab-bar">
      {ctx.openTabs.map((tabId) => {
        const isTicketTab = ctx.tickets.some((tk) => tk.id === tabId);
        const isPlanTab = ctx.plans.some((p) => p.id === tabId);
        const tabTitle =
          ctx.tickets.find((tk) => tk.id === tabId)?.title ??
          ctx.plans.find((p) => p.id === tabId)?.title ??
          tabId;
        const isActive = tabId === ctx.activePlanId;
        return (
          <div
            key={tabId}
            className={`tab-item ${isActive ? "tab-active" : ""} ${isPlanTab && !isTicketTab ? "tab-plan" : ""}`}
          >
            <button
              className="tab-label"
              onClick={() => {
                if (isTicketTab && !isPlanTab) {
                  navigate({ to: "/tickets", search: { view: "list", status: [], project: [], epic: [], sprint: [] } });
                  ctx.setActiveTicketId(tabId);
                } else {
                  ctx.setActivePlanId(tabId);
                }
              }}
            >
              {tabTitle}
            </button>
            <button
              className="tab-close"
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
