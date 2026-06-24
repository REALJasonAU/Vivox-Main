"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Server } from "lucide-react";
import { nodesApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { Node, Service } from "@/lib/types";
import { NodeSetupPanel } from "@/components/NodeSetupPanel";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Skeleton } from "@/components/ui/states";
import { cn, formatRelativeTime } from "@/lib/utils";
import { toast } from "@/hooks/useToast";

export default function NodeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: node, loading, error, refetch } = useApi<Node>(() => nodesApi.get(id), [id]);
  const { data: services, loading: servicesLoading } = useApi<Service[]>(
    () => nodesApi.services(id),
    [id],
  );
  const [setup, setSetup] = useState<{ node: Node; token: string } | null>(null);
  const [rotating, setRotating] = useState(false);

  const rotateToken = async () => {
    if (!node) return;
    setRotating(true);
    try {
      const res = await nodesApi.rotateToken(id);
      setSetup({ node: res.node, token: res.agent_token });
      void refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Token rotation failed", "error");
    } finally {
      setRotating(false);
    }
  };

  if (loading) {
    return <Skeleton className="h-64" />;
  }

  if (error || !node) {
    return <ErrorBanner message={error ?? "Node not found"} />;
  }

  const online = (node as Node & { online?: boolean }).online ?? node.status === "online";
  const agentId = (node as Node & { agent_id?: string }).agent_id;
  const svcList = services ?? [];

  return (
    <div className="flex flex-col gap-6">
      {setup && (
        <NodeSetupPanel
          node={setup.node}
          token={setup.token}
          onClose={() => setSetup(null)}
        />
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Link
            href="/admin/nodes"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300"
          >
            <ArrowLeft className="size-4" /> Back to nodes
          </Link>
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-vivox-500/20">
              <Server className="size-5 text-vivox-400" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">{node.name}</h1>
              <p className="text-sm text-zinc-500">{node.region}</p>
            </div>
            <span
              className={cn(
                "ml-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs capitalize",
                online
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-zinc-800 text-zinc-400",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  online ? "bg-emerald-500" : "bg-zinc-500",
                )}
              />
              {node.status}
            </span>
          </div>
        </div>
        <Button onClick={() => void rotateToken()} loading={rotating}>
          <RefreshCw className="size-4" /> Re-register agent
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="CPU cores" value={String(node.capacity.cpu_cores)} />
        <StatCard label="RAM" value={`${Math.round(node.capacity.ram_mb / 1024)} GB`} />
        <StatCard label="Disk" value={`${node.capacity.disk_gb} GB`} />
        <StatCard label="Services" value={String(node.service_count ?? svcList.length)} />
        <StatCard label="Memory used" value={`${node.memory_used_mb ?? 0} MB`} />
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-sm font-medium text-zinc-100">Connected agent</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Stream</dt>
            <dd className={online ? "text-emerald-400" : "text-zinc-400"}>
              {online ? "Online" : "Offline"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Agent ID</dt>
            <dd className="font-mono text-zinc-300">{agentId || "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Last updated</dt>
            <dd className="text-zinc-300">{formatRelativeTime(node.updated_at)}</dd>
          </div>
        </dl>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-medium text-zinc-100">Assigned services</h2>
        </div>
        {servicesLoading ? (
          <div className="p-4">
            <Skeleton className="h-24" />
          </div>
        ) : svcList.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">No services on this node</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#1f1f23] text-left text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {svcList.map((s) => (
                <tr key={s.id} className="hover:bg-[#1c1c20]">
                  <td className="px-4 py-3">
                    <Link href={`/services/${s.id}`} className="font-medium text-vivox-400 hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{s.type}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.status} size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">{value}</p>
    </div>
  );
}
