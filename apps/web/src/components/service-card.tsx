"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, Clock } from "lucide-react";
import type { MetricsPayload, Service, ServiceStatus, StatusPayload } from "@/lib/types";
import { isTransient } from "@/lib/status";
import { useTopic } from "@/hooks/useWebSocket";
import { StatusBadge } from "./status-badge";
import { ConnectAddress } from "@/components/connect-address";
import { ServiceIconBadge } from "@/components/service-type-icon";
import { cn, formatBytes } from "@/lib/utils";

function MetricBar({ label, value, percent }: { label: string; value: string; percent: number }) {
  const barColor =
    percent > 85 ? "bg-red-500" : percent > 60 ? "bg-amber-500" : "bg-emerald-500";
  const valueColor =
    percent > 85
      ? "text-red-400"
      : percent > 60
        ? "text-amber-400"
        : percent > 0
          ? "text-emerald-400"
          : "text-muted";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted">
        <span>{label}</span>
        <span className={cn("font-mono normal-case tracking-normal font-medium", valueColor)}>
          {value}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, percent)}%` }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          className={cn("h-full rounded-full", barColor)}
        />
      </div>
    </div>
  );
}

function uptimeStr(updatedAt: string): string {
  const diff = Date.now() - new Date(updatedAt).getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ServiceCard({ service }: { service: Service }) {
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

  const locked = isTransient(status);
  const memLimitBytes = service.resource_limits.memory_mb * 1024 * 1024;
  const memPct = metrics ? (metrics.mem / memLimitBytes) * 100 : 0;
  const cpuPct = metrics?.cpu ?? 0;

  const memValue = metrics ? formatBytes(metrics.mem) : "—";
  const cpuValue = metrics ? `${metrics.cpu.toFixed(0)}%` : "—";

  return (
    <motion.div
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 22 }}
      className={cn(
        "group relative flex flex-col gap-4 overflow-hidden rounded-xl border border-border bg-surface p-5 transition-colors hover:border-border-focus",
        locked && "opacity-90",
      )}
    >
      {/* TailAdmin-style radial gradient hover overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(450px circle at 50% -10%, rgba(229,24,27,0.055) 0%, transparent 70%)",
        }}
      />

      <Link
        href={`/services/${service.id}/overview`}
        className="absolute inset-0 z-10 rounded-xl"
        aria-label={service.name}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ServiceIconBadge service={service} />
          <div className="min-w-0">
            <h3 className="truncate font-medium tracking-tight text-foreground">{service.name}</h3>
            <ConnectAddress service={service} className="relative z-20 mt-0.5" />
            {service.tags && service.tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {service.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border-focus bg-surface-raised px-2 py-0.5 text-[10px] text-muted"
                  >
                    {tag}
                  </span>
                ))}
                {service.tags.length > 3 && (
                  <span className="text-[10px] text-subtle">+{service.tags.length - 3}</span>
                )}
              </div>
            )}
          </div>
        </div>
        <StatusBadge status={status} size="sm" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricBar label="Memory" value={memValue} percent={memPct} />
        <MetricBar label="CPU" value={cpuValue} percent={cpuPct} />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted">
        <div className="flex min-w-0 items-center gap-2">
          {status === "RUNNING" && (
            <span className="inline-flex shrink-0 items-center gap-1 text-emerald-500/80">
              <Clock className="size-3" />
              {uptimeStr(service.updated_at)}
            </span>
          )}
        </div>
        <ChevronRight className="ml-auto size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>
    </motion.div>
  );
}
