"use client";

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { STATUS_META } from "@/lib/status";
import type { ServiceStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  status: ServiceStatus;
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
}

export function StatusBadge({ status, size = "md", showLabel = true, className }: Props) {
  const meta = STATUS_META[status];
  const colorVar = `rgb(var(--status-${status.toLowerCase()}))`;

  return (
    <motion.span
      key={status}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 22 }}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        className,
      )}
      style={{
        color: colorVar,
        borderColor: `color-mix(in srgb, ${colorVar} 35%, transparent)`,
        background: `color-mix(in srgb, ${colorVar} 12%, transparent)`,
      }}
    >
      {meta.spinner ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <span className="relative flex size-2">
          {meta.pulse && (
            <span
              className="absolute inline-flex size-full rounded-full opacity-75 animate-status-pulse"
              style={{ background: colorVar }}
            />
          )}
          <span
            className="relative inline-flex size-2 rounded-full"
            style={{ background: colorVar }}
          />
        </span>
      )}
      {showLabel && <span>{meta.label}</span>}
    </motion.span>
  );
}
