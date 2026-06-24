"use client";

import { Copy } from "lucide-react";
import type { PortDisplay } from "@/lib/ports";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";

async function copyPort(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard", "success");
  } catch {
    toast("Copy failed", "error");
  }
}

export function PortDisplayList({
  ports,
  className,
  compact,
}: {
  ports: PortDisplay[];
  className?: string;
  compact?: boolean;
}) {
  if (ports.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {ports.map((p, i) => (
        <div
          key={`${p.copyText}-${i}`}
          className={cn(
            "flex items-center justify-between rounded-lg border px-3 py-2",
            compact
              ? "border-border bg-background/50"
              : p.isMain
                ? "border-vivox-500/30 bg-vivox-500/5"
                : "border-border bg-background/40",
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-sm text-foreground">{p.label}</span>
            <button
              type="button"
              onClick={() => void copyPort(p.copyText)}
              className="shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-surface-raised hover:text-vivox-400"
              aria-label={`Copy ${p.label}`}
            >
              <Copy className="size-3.5" />
            </button>
          </div>
          <span className={cn("shrink-0 pl-3 text-xs", p.isMain ? "text-vivox-400" : "text-muted")}>
            {p.detail}
          </span>
        </div>
      ))}
    </div>
  );
}
