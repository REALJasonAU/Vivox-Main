"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { servicesApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useTopic } from "@/hooks/useWebSocket";
import type { HealthPayload, ServiceHealth } from "@/lib/types";
import { cn } from "@/lib/utils";

export function HealthIndicator({ serviceId }: { serviceId: string }) {
  const { data: initial } = useApi(() => servicesApi.health(serviceId), [serviceId]);
  const [health, setHealth] = useState<ServiceHealth | null>(null);

  useEffect(() => {
    if (initial) setHealth(initial);
  }, [initial]);

  useTopic<HealthPayload>(`service:${serviceId}:health`, (payload) => {
    if (!payload) return;
    setHealth({
      available: true,
      healthy: Boolean(payload.healthy),
      status_code: payload.status_code,
      latency_ms: payload.latency_ms,
      error: payload.error,
      checked_at: payload.timestamp,
    });
  });

  if (!health?.available) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm",
        health.healthy
          ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-400"
          : "border-red-500/25 bg-red-500/8 text-red-400",
      )}
    >
      <motion.span
        animate={health.healthy ? {} : { scale: [1, 1.3, 1] }}
        transition={{ repeat: Infinity, duration: 1.5 }}
        className={cn("size-2 rounded-full", health.healthy ? "bg-emerald-500" : "bg-red-500")}
      />
      {health.healthy ? "Healthy" : "Unhealthy"}
      {health.status_code != null && health.status_code > 0 && (
        <span className="text-xs opacity-70">HTTP {health.status_code}</span>
      )}
      {health.latency_ms != null && health.latency_ms > 0 && (
        <span className="text-xs opacity-70">{health.latency_ms}ms</span>
      )}
    </motion.div>
  );
}
