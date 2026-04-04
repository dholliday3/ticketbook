import { useMemo } from "react";
import type { Ticket, Status, Meta } from "../types";

type FilterKey = "status" | "project" | "epic" | "sprint";

interface DashboardProps {
  tickets: Ticket[];
  meta: Meta;
  onNavigate: (mode: "list" | "board", filterKey?: FilterKey, filterValue?: string) => void;
}

const STATUS_CONFIG: { key: Status; label: string; color: string }[] = [
  { key: "draft", label: "Draft", color: "#6b7280" },
  { key: "in-progress", label: "In Progress", color: "#3b82f6" },
  { key: "open", label: "Open", color: "#22c55e" },
  { key: "backlog", label: "Backlog", color: "#9ca3af" },
  { key: "done", label: "Done", color: "#8b5cf6" },
  { key: "cancelled", label: "Cancelled", color: "#ef4444" },
];

export function Dashboard({ tickets, meta, onNavigate }: DashboardProps) {
  const statusCounts = useMemo(() => {
    const counts: Record<Status, number> = {
      draft: 0,
      "in-progress": 0,
      open: 0,
      backlog: 0,
      done: 0,
      cancelled: 0,
    };
    for (const t of tickets) counts[t.status]++;
    return counts;
  }, [tickets]);

  const activeCount = statusCounts["in-progress"] + statusCounts["open"] + statusCounts["backlog"];

  const recentTickets = useMemo(() => {
    return [...tickets]
      .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime())
      .slice(0, 5);
  }, [tickets]);

  const projectGroups = useMemo(() => groupBy(tickets, "project"), [tickets]);
  const epicGroups = useMemo(() => groupBy(tickets, "epic"), [tickets]);
  const sprintGroups = useMemo(() => groupBy(tickets, "sprint"), [tickets]);

  return (
    <div className="dashboard">
      {/* Overview stats */}
      <section className="dash-section">
        <h2 className="dash-section-title">Overview</h2>
        <div className="dash-stats">
          <div className="dash-stat-card dash-stat-total">
            <span className="dash-stat-value">{tickets.length}</span>
            <span className="dash-stat-label">Total</span>
          </div>
          <div className="dash-stat-card dash-stat-active">
            <span className="dash-stat-value">{activeCount}</span>
            <span className="dash-stat-label">Active</span>
          </div>
          {STATUS_CONFIG.map(({ key, label, color }) => (
            <button
              key={key}
              className="dash-stat-card dash-stat-clickable"
              onClick={() => onNavigate("list", "status", key)}
            >
              <span className="dash-stat-value" style={{ color }}>{statusCounts[key]}</span>
              <span className="dash-stat-label">{label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Status bar chart */}
      {tickets.length > 0 && (
        <section className="dash-section">
          <div className="dash-bar-chart">
            {STATUS_CONFIG.map(({ key, color }) => {
              const pct = (statusCounts[key] / tickets.length) * 100;
              if (pct === 0) return null;
              return (
                <div
                  key={key}
                  className="dash-bar-segment"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                  title={`${key}: ${statusCounts[key]}`}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Recently updated */}
      {recentTickets.length > 0 && (
        <section className="dash-section">
          <h2 className="dash-section-title">Recently Updated</h2>
          <div className="dash-ticket-list">
            {recentTickets.map((t) => (
              <div key={t.id} className="dash-ticket-row">
                <span className="dash-ticket-status" style={{ color: STATUS_CONFIG.find((s) => s.key === t.status)?.color }}>
                  {STATUS_CONFIG.find((s) => s.key === t.status)?.label}
                </span>
                <span className="dash-ticket-title">{t.title}</span>
                <span className="dash-ticket-id">{t.id}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Projects */}
      {meta.projects.length > 0 && (
        <section className="dash-section">
          <h2 className="dash-section-title">Projects</h2>
          <div className="dash-group-grid">
            {meta.projects.map((name) => {
              const group = projectGroups.get(name) ?? [];
              const active = group.filter((t) => t.status === "in-progress" || t.status === "open").length;
              return (
                <button key={name} className="dash-group-card" onClick={() => onNavigate("list", "project", name)}>
                  <span className="dash-group-name">{name}</span>
                  <span className="dash-group-counts">{group.length} tickets &middot; {active} active</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Epics */}
      {meta.epics.length > 0 && (
        <section className="dash-section">
          <h2 className="dash-section-title">Epics</h2>
          <div className="dash-group-grid">
            {meta.epics.map((name) => {
              const group = epicGroups.get(name) ?? [];
              const done = group.filter((t) => t.status === "done").length;
              return (
                <button key={name} className="dash-group-card" onClick={() => onNavigate("list", "epic", name)}>
                  <span className="dash-group-name">{name}</span>
                  <span className="dash-group-counts">{group.length} tickets &middot; {done}/{group.length} done</span>
                  {group.length > 0 && (
                    <div className="dash-progress-bar">
                      <div className="dash-progress-fill" style={{ width: `${(done / group.length) * 100}%` }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Sprints / Cycles */}
      {meta.sprints.length > 0 && (
        <section className="dash-section">
          <h2 className="dash-section-title">Cycles</h2>
          <div className="dash-group-grid">
            {meta.sprints.map((name) => {
              const group = sprintGroups.get(name) ?? [];
              const done = group.filter((t) => t.status === "done").length;
              return (
                <button key={name} className="dash-group-card" onClick={() => onNavigate("list", "sprint", name)}>
                  <span className="dash-group-name">{name}</span>
                  <span className="dash-group-counts">{group.length} tickets &middot; {done}/{group.length} done</span>
                  {group.length > 0 && (
                    <div className="dash-progress-bar">
                      <div className="dash-progress-fill" style={{ width: `${(done / group.length) * 100}%` }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function groupBy(tickets: Ticket[], field: "project" | "epic" | "sprint"): Map<string, Ticket[]> {
  const map = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const val = t[field];
    if (!val) continue;
    const arr = map.get(val);
    if (arr) arr.push(t);
    else map.set(val, [t]);
  }
  return map;
}
