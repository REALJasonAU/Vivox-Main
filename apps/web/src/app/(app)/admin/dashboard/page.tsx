"use client";

import { useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Users,
  Server,
  Boxes,
  Activity,
  ShieldAlert,
  ArrowRight,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApi } from "@/hooks/useApi";
import { adminApi, nodesApi } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import type { Customer, Node, Service, ServiceStatus } from "@/lib/types";
import { ErrorBanner, Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { STATUS_META } from "@/lib/status";

const STATUS_COLORS: Record<ServiceStatus, string> = {
  RUNNING: "#10b981",
  STOPPED: "#71717a",
  PROVISIONING: "#f59e0b",
  STARTING: "#34d399",
  STOPPING: "#fb923c",
  CRASHED: "#ef4444",
};

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof Users;
  accent?: string;
  href?: string;
}) {
  const inner = (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-border-focus"
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "grid size-10 place-items-center rounded-xl bg-surface-raised",
            accent ?? "text-vivox-500",
          )}
        >
          <Icon className="size-5" />
        </div>
        {href && <ArrowRight className="size-4 text-muted" />}
      </div>
      <div>
        <p className="text-3xl font-semibold tracking-tight text-foreground">{value}</p>
        <p className="mt-0.5 text-sm text-muted">{label}</p>
        {sub && <p className="mt-1 text-xs text-subtle">{sub}</p>}
      </div>
    </motion.div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}

export default function AdminDashboardPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const { data: users, loading: usersLoading, error: usersError } = useApi<Customer[]>(
    () => adminApi.customers(),
    [],
  );
  const { data: services, loading: svcLoading, error: svcError } = useApi<Service[]>(
    () => adminApi.services(),
    [],
  );
  const { data: nodes, loading: nodesLoading, error: nodesError } = useApi<Node[]>(
    () => nodesApi.list(),
    [],
  );

  const loading = usersLoading || svcLoading || nodesLoading;
  const error = usersError || svcError || nodesError;

  const stats = useMemo(() => {
    const allUsers = users ?? [];
    const allServices = services ?? [];
    const allNodes = nodes ?? [];
    const running = allServices.filter((s) => s.status === "RUNNING").length;
    const onlineNodes = allNodes.filter((n) => n.online || n.status === "online").length;
    const activeUsers = allUsers.filter((u) => !u.is_suspended).length;
    return {
      users: allUsers.length,
      activeUsers,
      services: allServices.length,
      running,
      nodes: allNodes.length,
      onlineNodes,
    };
  }, [users, services, nodes]);

  const statusChart = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of services ?? []) {
      counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([status, count]) => ({
      status,
      label: STATUS_META[status as ServiceStatus]?.label ?? status,
      count,
      fill: STATUS_COLORS[status as ServiceStatus] ?? "#71717a",
    }));
  }, [services]);

  const typeChart = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of services ?? []) {
      counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
  }, [services]);

  if (role !== undefined && role !== "admin") {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <ShieldAlert className="size-8 text-muted" />
        <p className="text-sm text-muted">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Dashboard</h1>
      </div>

      {error && <ErrorBanner message={`Could not load dashboard (${error})`} />}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Registered users"
              value={stats.users}
              sub={`${stats.activeUsers} active`}
              icon={Users}
              href="/admin/users"
            />
            <StatCard
              label="Total servers"
              value={stats.services}
              sub={`${stats.running} running`}
              icon={Boxes}
              accent="text-emerald-500"
              href="/admin/servers"
            />
            <StatCard
              label="Edge nodes"
              value={stats.nodes}
              sub={`${stats.onlineNodes} online`}
              icon={Server}
              accent="text-sky-500"
              href="/admin/nodes"
            />
            <StatCard
              label="Fleet health"
              value={stats.services > 0 ? `${Math.round((stats.running / stats.services) * 100)}%` : "—"}
              sub="servers running"
              icon={Activity}
              accent="text-amber-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-5">
              <h2 className="text-sm font-medium text-foreground">Servers by status</h2>
              <p className="mt-0.5 text-xs text-muted">Current state across the platform</p>
              <div className="mt-4 h-56">
                {statusChart.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-sm text-muted">No servers yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statusChart} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: "rgb(var(--surface))",
                          border: "1px solid rgb(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                        {statusChart.map((entry) => (
                          <Cell key={entry.status} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-5">
              <h2 className="text-sm font-medium text-foreground">Servers by type</h2>
              <p className="mt-0.5 text-xs text-muted">Game, docker, database, static</p>
              <div className="mt-4 h-56">
                {typeChart.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-sm text-muted">No servers yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={typeChart}
                        dataKey="count"
                        nameKey="type"
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={80}
                        paddingAngle={3}
                      >
                        {typeChart.map((_, i) => (
                          <Cell key={i} fill={["#e5181b", "#3b82f6", "#8b5cf6", "#10b981"][i % 4]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "rgb(var(--surface))",
                          border: "1px solid rgb(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
