"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, Clock } from "lucide-react";
import type { MetricsPayload, Service, ServiceStatus, StatusPayload } from "@/lib/types";
import { STATUS_META } from "@/lib/status";
import { useTopic } from "@/hooks/useWebSocket";
import { ConnectAddress } from "@/components/connect-address";
import { getServiceKindLabel, ServiceIconBadge } from "@/components/service-type-icon";
import { cn, formatBytes } from "@/lib/utils";

function uptimeStr(updatedAt: string): string {
  const diff = Date.now() - new Date(updatedAt).getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function MiniBar({ percent, value }: { percent: number; value: string }) {
  const pct = Math.max(0, Math.min(100, percent));
  const barColor =
    pct > 85 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500";
  const textColor =
    pct > 85
      ? "text-red-400"
      : pct > 60
        ? "text-amber-400"
        : pct > 0
          ? "text-emerald-400"
          : "text-muted";

  return (
    <div className="flex flex-col gap-1">
      <span className={cn("font-mono text-xs font-medium", textColor)}>{value}</span>
      <div className="h-1 w-14 overflow-hidden rounded-full bg-surface-raised">
        <div
          className={cn("h-full rounded-full transition-all duration-500", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ServiceRow({ service }: { service: Service }) {
  const [status, setStatus] = useState<ServiceStatus>(service.status);
  const [metrics, setMetrics] = useState<{ cpu: number; mem: number } | null>(null);

  useEffect(() => {
    setStatus(service.status);
  }, [service.status]);

  useTopic<StatusPayload>(`service:${service.id}:status`, (payload) => {
    if (payload?.status) setStatus(payload.status);
  });

  useTopic<MetricsPayload>(`service:${service.id}:metrics`, (payload) => {
    if (!payload) return;
    setMetrics({
      cpu: payload.cpu_usage_percent,
      mem: payload.memory_bytes_used,
    });
  });

  const meta = STATUS_META[status];
  const memLimitBytes = service.resource_limits.memory_mb * 1024 * 1024;
  const cpuPct = metrics?.cpu ?? 0;
  const memPct = metrics ? (metrics.mem / memLimitBytes) * 100 : 0;
  const cpuValue = metrics ? `${metrics.cpu.toFixed(1)}%` : "—";
  const memValue = metrics ? formatBytes(metrics.mem) : "—";
  const kindLabel = getServiceKindLabel(service);
  const uptime =
    status === "RUNNING" ? (
      <span className="inline-flex items-center gap-1 text-emerald-500/80">
        <Clock className="size-3" />
        {uptimeStr(service.updated_at)}
      </span>
    ) : (
      "—"
    );

  return (
    <Link
      href={`/services/${service.id}/overview`}
      className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-all duration-200 hover:border-border-focus hover:bg-surface-raised/30"
    >
      <ServiceIconBadge service={service} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn("size-2 shrink-0 rounded-full", meta.pulse && "animate-pulse")}
            style={{ background: `rgb(var(--status-${meta.color}))` }}
            aria-hidden
          />
          <span className="truncate font-medium text-foreground">{service.name}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted">{kindLabel}</span>
          <ConnectAddress service={service} compact className="relative z-20" />
        </div>
      </div>
      {service.tags && service.tags.length > 0 && (
        <span className="hidden gap-1 md:flex">
          {service.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-border-focus bg-surface-raised px-1.5 py-0.5 text-[10px] text-muted"
            >
              {tag}
            </span>
          ))}
        </span>
      )}
      <span className="hidden w-24 shrink-0 text-xs uppercase tracking-wider text-muted sm:block">
        {meta.label}
      </span>
      <span className="hidden w-20 shrink-0 text-xs text-muted md:block">{uptime}</span>
      <span className="hidden w-20 shrink-0 lg:block">
        <MiniBar percent={cpuPct} value={cpuValue} />
      </span>
      <span className="hidden w-24 shrink-0 lg:block">
        <MiniBar percent={memPct} value={memValue} />
      </span>
      <ChevronRight className="size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  );
}
