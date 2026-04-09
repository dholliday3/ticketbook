import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAppContext } from "../context/AppContext";
import { Dashboard } from "../components/Dashboard";

export const Route = createFileRoute("/")({
  component: IndexRoute,
});

function IndexRoute() {
  const ctx = useAppContext();
  const navigate = useNavigate();

  return (
    <Dashboard
      tickets={ctx.tickets}
      plans={ctx.plans}
      meta={ctx.meta}
      onNavigate={(mode, filterKey, filterValue) => {
        const search: {
          view: "list" | "board";
          status: string[];
          project: string[];
          epic: string[];
          sprint: string[];
        } = {
          view: mode === "board" ? "board" : "list",
          status: [],
          project: [],
          epic: [],
          sprint: [],
        };
        if (filterKey && filterValue) {
          (search as any)[filterKey] = [filterValue];
        }
        navigate({ to: "/tasks", search });
      }}
      onNavigatePlans={() => {
        navigate({ to: "/plans", search: { view: "list", status: [], project: [] } });
      }}
    />
  );
}
