"use client";

import Link from "next/link";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { Server, Plus, ShieldAlert } from "lucide-react";
import { nodesApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useLiveNodeStatuses, mergeNodeWithLive } from "@/hooks/useLiveStatuses";
import { useSession } from "@/lib/auth-client";
import type { Node } from "@/lib/types";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/states";
import { formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

export default function AdminNodesPage() {
  const { data: session } = useSession();
  const { data, loading, error } = useApi<Node[]>(() => nodesApi.list());

  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === undefined || role === "admin";

  const nodes = data ?? [];
  const liveNodes = useLiveNodeStatuses(nodes);
  const displayNodes = useMemo(
    () => nodes.map((n) => mergeNodeWithLive(n, liveNodes.get(n.id))),
    [nodes, liveNodes],
  );

  const metrics = useMemo(() => {
    const online = displayNodes.filter((n) => n.status === "online").length;
    const totalServices = displayNodes.reduce((sum, n) => sum + (n.service_count ?? 0), 0);
    const avgCpu =
      displayNodes.length > 0
        ? Math.round(displayNodes.reduce((s, n) => s + (n.cpu_usage_percent ?? 0), 0) / displayNodes.length)
        : 0;
    return { online, totalServices, avgCpu };
  }, [displayNodes]);

  if (!isAdmin) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-6" />}
        title="Admin access required"
        description="Node management is restricted to administrators."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Nodes</h1>
        <Link
          href="/admin/nodes/create"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-vivox-500/50 bg-vivox-500 px-4 text-sm font-medium text-white shadow-sm shadow-vivox-500/20 transition-colors hover:bg-vivox-600"
        >
          <Plus className="size-4" /> Register node
        </Link>
      </div>

      {!loading && nodes.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard label="Total nodes" value={String(nodes.length)} />
          <MetricCard label="Online" value={String(metrics.online)} accent="emerald" />
          <MetricCard label="Servers" value={String(metrics.totalServices)} />
          <MetricCard label="Avg CPU" value={`${metrics.avgCpu}%`} />
        </div>
      )}

      {error && (
        <ErrorBanner message={`Could not load nodes (${error}). The control plane API may be offline.`} />
      )}

      {loading ? (
        <Skeleton className="h-64" />
      ) : displayNodes.length === 0 ? (
        <EmptyState
          icon={<Server className="size-6" />}
          title="No nodes registered"
          description="Register an edge node to start scheduling services onto it."
          action={
            <Link
              href="/admin/nodes/create"
              className="inline-flex h-8 items-center rounded-lg border border-vivox-500/50 bg-vivox-500 px-3 text-xs font-medium text-white hover:bg-vivox-600"
            >
              Register node
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">ID</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">CPU</th>
                <th className="px-4 py-3 font-medium">Memory</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Servers</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Last seen</th>
              </tr>
            </thead>
            <motion.tbody
              className="divide-y divide-border"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              {displayNodes.map((node) => (
                <NodeRow key={node.id} node={node} />
              ))}
            </motion.tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "emerald";
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight",
          accent === "emerald" ? "text-emerald-500" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function NodeRow({ node }: { node: Node }) {
  const statusColor =
    node.status === "online" ? "running" : node.status === "degraded" ? "stopping" : "stopped";

  const memPct =
    node.capacity.ram_mb > 0 ? ((node.memory_used_mb ?? 0) / node.capacity.ram_mb) * 100 : 0;

  return (
    <motion.tr variants={rowVariants} className="transition-colors duration-200 hover:bg-surface-raised/50">
      <td className="px-4 py-3 font-medium text-foreground">
        <Link href={`/admin/nodes/${node.id}`} className="hover:text-vivox-400">
          {node.name}
        </Link>
      </td>
      <td className="hidden px-4 py-3 font-mono text-xs text-muted md:table-cell">
        {node.id.slice(0, 8)}…
      </td>
      <td className="px-4 py-3">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs capitalize"
          style={{
            color: `rgb(var(--status-${statusColor}))`,
            background: `color-mix(in srgb, rgb(var(--status-${statusColor})) 12%, transparent)`,
          }}
        >
          <span
            className="size-1.5 rounded-full"
            style={{ background: `rgb(var(--status-${statusColor}))` }}
          />
          {node.status}
        </span>
      </td>
      <td className="px-4 py-3">
        <UsageCell percent={node.cpu_usage_percent ?? 0} detail={`${node.capacity.cpu_cores}c`} />
      </td>
      <td className="px-4 py-3">
        <UsageCell
          percent={memPct}
          detail={`${Math.round(node.capacity.ram_mb / 1024)}G`}
        />
      </td>
      <td className="hidden px-4 py-3 font-mono text-muted sm:table-cell">{node.service_count ?? 0}</td>
      <td className="hidden px-4 py-3 text-muted lg:table-cell">
        {node.last_seen_at ? formatRelativeTime(node.last_seen_at) : "never"}
      </td>
    </motion.tr>
  );
}

function UsageCell({ percent, detail }: { percent: number; detail: string }) {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-raised">
        <div
          className={cn(
            "h-full rounded-full",
            pct > 85 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-xs text-muted">
        {Math.round(pct)}% · {detail}
      </span>
    </div>
  );
}
