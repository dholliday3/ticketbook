import { useMemo } from "react";
import type { Task, Status, Meta, Plan, PlanStatus } from "../types";
import { Button } from "@/components/ui/button";

type FilterKey = "status" | "project" | "epic" | "sprint";

interface DashboardProps {
  tasks: Task[];
  plans: Plan[];
  meta: Meta;
  onNavigate: (mode: "list" | "board", filterKey?: FilterKey, filterValue?: string) => void;
  onNavigatePlans?: () => void;
}

const STATUS_CONFIG: { key: Status; label: string; color: string }[] = [
  { key: "draft", label: "Draft", color: "#6b7280" },
  { key: "in-progress", label: "In Progress", color: "#3b82f6" },
  { key: "open", label: "Open", color: "#22c55e" },
  { key: "backlog", label: "Backlog", color: "#9ca3af" },
  { key: "done", label: "Done", color: "#8b5cf6" },
  { key: "cancelled", label: "Cancelled", color: "#ef4444" },
];

const PLAN_STATUS_CONFIG: { key: PlanStatus; label: string; color: string }[] = [
  { key: "active", label: "Active", color: "#3b82f6" },
  { key: "draft", label: "Draft", color: "#9ca3af" },
  { key: "completed", label: "Completed", color: "#22c55e" },
  { key: "archived", label: "Archived", color: "#6b7280" },
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

function StatCard({
  value,
  label,
  valueClassName,
  valueStyle,
}: {
  value: number | string;
  label: string;
  valueClassName?: string;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <div className="min-w-20 rounded-lg border border-border bg-card px-4 py-3 text-center md:min-w-20">
      <span
        className={`block text-[22px] font-bold leading-tight ${valueClassName ?? ""}`}
        style={valueStyle}
      >
        {value}
      </span>
      <span className="mt-0.5 block text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function StatButton({
  value,
  label,
  valueStyle,
  onClick,
}: {
  value: number | string;
  label: string;
  valueStyle?: React.CSSProperties;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      className="h-auto min-w-20 flex-col gap-0.5 rounded-lg bg-card px-4 py-3 text-center hover:border-primary"
      onClick={onClick}
    >
      <span className="block text-[22px] font-bold leading-tight" style={valueStyle}>
        {value}
      </span>
      <span className="block text-[11px] font-normal text-muted-foreground">{label}</span>
    </Button>
  );
}

function GroupCard({
  name,
  countsText,
  progressPct,
  onClick,
}: {
  name: string;
  countsText: string;
  progressPct?: number;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      className="flex h-auto flex-col items-start gap-1 rounded-lg bg-card px-4 py-3.5 text-left hover:border-primary"
      onClick={onClick}
    >
      <span className="text-sm font-semibold text-foreground">{name}</span>
      <span className="text-xs font-normal text-muted-foreground">{countsText}</span>
      {progressPct !== undefined && (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </Button>
  );
}

function DashListRow({
  statusLabel,
  statusColor,
  title,
  id,
  onClick,
}: {
  statusLabel: string;
  statusColor?: string;
  title: string;
  id: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span
        className="min-w-20 text-[11px] font-medium"
        style={statusColor ? { color: statusColor } : undefined}
      >
        {statusLabel}
      </span>
      <span className="flex-1 truncate text-foreground">{title}</span>
      <span className="font-mono text-[11px] text-muted-foreground">{id}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className="flex w-full items-center gap-2.5 border-b border-border bg-card px-3 py-2 text-left text-[13px] transition-colors last:border-b-0 hover:bg-accent"
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2.5 border-b border-border bg-card px-3 py-2 text-[13px] last:border-b-0">
      {content}
    </div>
  );
}

export function Dashboard({ tasks, plans, meta, onNavigate, onNavigatePlans }: DashboardProps) {
  const statusCounts = useMemo(() => {
    const counts: Record<Status, number> = {
      draft: 0,
      "in-progress": 0,
      open: 0,
      backlog: 0,
      done: 0,
      cancelled: 0,
    };
    for (const t of tasks) counts[t.status]++;
    return counts;
  }, [tasks]);

  const activeCount = statusCounts["in-progress"] + statusCounts["open"] + statusCounts["backlog"];

  const recentTasks = useMemo(() => {
    return [...tasks]
      .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime())
      .slice(0, 5);
  }, [tasks]);

  const projectGroups = useMemo(() => groupBy(tasks, "project"), [tasks]);
  const epicGroups = useMemo(() => groupBy(tasks, "epic"), [tasks]);
  const sprintGroups = useMemo(() => groupBy(tasks, "sprint"), [tasks]);

  return (
    <div className="mx-auto box-border w-full max-w-[900px] flex-1 overflow-y-auto px-4 py-4 md:px-8 md:py-6">
      {/* Overview stats */}
      <section className="mb-6">
        <SectionTitle>Overview</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <StatCard value={tasks.length} label="Total" />
          <StatCard
            value={activeCount}
            label="Active"
            valueClassName="text-primary"
          />
          {STATUS_CONFIG.map(({ key, label, color }) => (
            <StatButton
              key={key}
              value={statusCounts[key]}
              label={label}
              valueStyle={{ color }}
              onClick={() => onNavigate("list", "status", key)}
            />
          ))}
        </div>
      </section>

      {/* Status bar chart */}
      {tasks.length > 0 && (
        <section className="mb-6">
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-sm">
            {STATUS_CONFIG.map(({ key, color }) => {
              const pct = (statusCounts[key] / tasks.length) * 100;
              if (pct === 0) return null;
              return (
                <div
                  key={key}
                  className="min-w-1 rounded-[2px] transition-[width] duration-300"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                  title={`${key}: ${statusCounts[key]}`}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Recently updated */}
      {recentTasks.length > 0 && (
        <section className="mb-6">
          <SectionTitle>Recently Updated</SectionTitle>
          <div className="flex flex-col overflow-hidden rounded-lg border border-border">
            {recentTasks.map((t) => (
              <DashListRow
                key={t.id}
                statusLabel={STATUS_CONFIG.find((s) => s.key === t.status)?.label ?? t.status}
                statusColor={STATUS_CONFIG.find((s) => s.key === t.status)?.color}
                title={t.title}
                id={t.id}
              />
            ))}
          </div>
        </section>
      )}

      {/* Projects */}
      {meta.projects.length > 0 && (
        <section className="mb-6">
          <SectionTitle>Projects</SectionTitle>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
            {meta.projects.map((name) => {
              const group = projectGroups.get(name) ?? [];
              const active = group.filter((t) => t.status === "in-progress" || t.status === "open").length;
              return (
                <GroupCard
                  key={name}
                  name={name}
                  countsText={`${group.length} tasks · ${active} active`}
                  onClick={() => onNavigate("list", "project", name)}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Epics */}
      {meta.epics.length > 0 && (
        <section className="mb-6">
          <SectionTitle>Epics</SectionTitle>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
            {meta.epics.map((name) => {
              const group = epicGroups.get(name) ?? [];
              const done = group.filter((t) => t.status === "done").length;
              return (
                <GroupCard
                  key={name}
                  name={name}
                  countsText={`${group.length} tasks · ${done}/${group.length} done`}
                  progressPct={group.length > 0 ? (done / group.length) * 100 : undefined}
                  onClick={() => onNavigate("list", "epic", name)}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Sprints / Cycles */}
      {meta.sprints.length > 0 && (
        <section className="mb-6">
          <SectionTitle>Cycles</SectionTitle>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
            {meta.sprints.map((name) => {
              const group = sprintGroups.get(name) ?? [];
              const done = group.filter((t) => t.status === "done").length;
              return (
                <GroupCard
                  key={name}
                  name={name}
                  countsText={`${group.length} tasks · ${done}/${group.length} done`}
                  progressPct={group.length > 0 ? (done / group.length) * 100 : undefined}
                  onClick={() => onNavigate("list", "sprint", name)}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Plans */}
      {plans.length > 0 && (
        <section className="mb-6">
          <SectionTitle>Plans</SectionTitle>
          <div className="flex flex-wrap gap-2">
            <StatCard value={plans.length} label="Total" />
            {PLAN_STATUS_CONFIG.map(({ key, label, color }) => {
              const count = plans.filter((p) => p.status === key).length;
              if (count === 0) return null;
              return (
                <StatButton
                  key={key}
                  value={count}
                  label={label}
                  valueStyle={{ color }}
                  onClick={() => onNavigatePlans?.()}
                />
              );
            })}
          </div>
          <div className="mt-3 flex flex-col overflow-hidden rounded-lg border border-border">
            {[...plans]
              .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime())
              .slice(0, 5)
              .map((p) => (
                <DashListRow
                  key={p.id}
                  statusLabel={PLAN_STATUS_CONFIG.find((s) => s.key === p.status)?.label ?? p.status}
                  statusColor={PLAN_STATUS_CONFIG.find((s) => s.key === p.status)?.color}
                  title={p.title}
                  id={p.id}
                  onClick={() => onNavigatePlans?.()}
                />
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

function groupBy(tasks: Task[], field: "project" | "epic" | "sprint"): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    const val = t[field];
    if (!val) continue;
    const arr = map.get(val);
    if (arr) arr.push(t);
    else map.set(val, [t]);
  }
  return map;
}
