"use client";

import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { auditApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/states";
import { formatRelativeTime } from "@/lib/utils";

const filterInputClass =
  "input-field w-full min-w-[200px] rounded-lg border border-border bg-background/50 px-3 py-2 text-sm text-foreground outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus";

export default function AuditPage() {
  const [actor, setActor] = useState("");
  const [targetType, setTargetType] = useState("");
  const { data, loading, error, refetch } = useApi(
    () =>
      auditApi.list({
        actor_id: actor || undefined,
        target_type: targetType || undefined,
        limit: 200,
      }),
    [actor, targetType],
  );

  const events = data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Audit Logs
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className={filterInputClass}
          placeholder="Filter by actor id"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
        />
        <input
          className={filterInputClass}
          placeholder="Filter by target type"
          value={targetType}
          onChange={(e) => setTargetType(e.target.value)}
        />
        <Button type="button" onClick={() => void refetch()}>
          Refresh
        </Button>
      </div>

      {error && <ErrorBanner message={`Could not load audit events (${error}).`} />}

      {loading ? (
        <Skeleton className="h-64" />
      ) : events.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-6" />}
          title="No audit events"
          description="Actions across users, services, and nodes will appear here as they occur."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-[#1f1f23] text-xs font-semibold uppercase tracking-wider text-muted">
                <th className="p-4 font-medium">Time</th>
                <th className="p-4 font-medium">Actor</th>
                <th className="p-4 font-medium">Action</th>
                <th className="p-4 font-medium">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map((e) => (
                <tr key={e.id} className="transition-colors duration-200 hover:bg-[#1c1c20]">
                  <td className="p-4 font-mono text-xs text-muted">
                    <span title={new Date(e.created_at).toLocaleString()}>
                      {formatRelativeTime(e.created_at)}
                    </span>
                  </td>
                  <td className="p-4 font-mono text-xs text-foreground">{e.actor_id}</td>
                  <td className="p-4 text-foreground">{e.action}</td>
                  <td className="p-4 font-mono text-xs text-muted">
                    {e.target_type}:{e.target_id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
