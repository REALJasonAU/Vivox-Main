"use client";

import { motion } from "framer-motion";
import { useWebSocket, type WsStatus } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";

const META: Record<WsStatus, { label: string; color: string; pulse: boolean }> = {
  open: { label: "Live", color: "rgb(var(--status-running))", pulse: false },
  connecting: { label: "Connecting", color: "rgb(var(--status-provisioning))", pulse: true },
  closed: { label: "Offline", color: "rgb(var(--status-stopped))", pulse: false },
  error: { label: "Error", color: "rgb(var(--status-crashed))", pulse: false },
};

export function WsStatusIndicator({ className }: { className?: string }) {
  const { status } = useWebSocket();
  const meta = META[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted",
        className,
      )}
      title={`Realtime: ${meta.label}`}
    >
      <motion.span
        key={status}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 600, damping: 20 }}
        className={cn("size-1.5 rounded-full", meta.pulse && "animate-status-pulse")}
        style={{ background: meta.color }}
      />
      {meta.label}
    </span>
  );
}
