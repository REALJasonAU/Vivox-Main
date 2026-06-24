"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, ChevronRight, Clock } from "lucide-react";
import type { MetricsPayload, Service, ServiceStatus, StatusPayload } from "@/lib/types";
import { STATUS_META } from "@/lib/status";
import { useTopic } from "@/hooks/useWebSocket";
import { cn, formatBytes } from "@/lib/utils";

function uptimeStr(updatedAt: string): string {
  const diff = Date.now() - new Date(updatedAt).getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ServiceRow({
  service,
  selectionMode = false,
  selected = false,
  onToggle,
  onLongPress,
}: {
  service: Service;
  selectionMode?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onLongPress?: () => void;
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const cpuValue = metrics ? `${metrics.cpu.toFixed(1)}%` : "—";
  const memValue = metrics ? formatBytes(metrics.mem) : "—";
  const uptime =
    status === "RUNNING" ? (
      <span className="inline-flex items-center gap-1 text-emerald-500/80">
        <Clock className="size-3" />
        {uptimeStr(service.updated_at)}
      </span>
    ) : (
      "—"
    );

  const startLongPress = () => {
    longPressTimer.current = setTimeout(() => {
      onLongPress?.();
    }, 500);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const inner = (
  <>
      {selectionMode && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative z-20 shrink-0"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggle?.();
          }}
        >
          <motion.div
            animate={selected ? { backgroundColor: "#e5181b", borderColor: "#e5181b" } : {}}
            className="flex size-5 items-center justify-center rounded-full border-2 border-border-focus bg-surface-raised"
          >
            {selected && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 600, damping: 20 }}
              >
                <Check className="size-3 text-white" />
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
      <span
        className={cn("size-2 shrink-0 rounded-full", meta.pulse && "animate-pulse")}
        style={{ background: `rgb(var(--status-${meta.color}))` }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{service.name}</span>
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
      <span className="hidden w-16 shrink-0 font-mono text-xs text-muted lg:block">{cpuValue}</span>
      <span className="hidden w-20 shrink-0 font-mono text-xs text-muted lg:block">{memValue}</span>
      {!selectionMode && (
        <ChevronRight className="size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      )}
  </>
  );

  if (selectionMode) {
    return (
      <div
        role="button"
        tabIndex={0}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onClick={onToggle}
        className={cn(
          "group relative flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-all duration-200",
          !selected && "opacity-60",
        )}
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={`/services/${service.id}`}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-all duration-200 hover:border-border-focus"
    >
      {inner}
    </Link>
  );
}
