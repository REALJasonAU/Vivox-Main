"use client";

import { Copy } from "lucide-react";
import type { Service } from "@/lib/types";
import { formatConnectAddress, mainConnectEndpoint } from "@/lib/ports";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard", "success");
  } catch {
    toast("Copy failed", "error");
  }
}

export function ConnectAddress({
  service,
  className,
  compact,
}: {
  service: Service;
  className?: string;
  compact?: boolean;
}) {
  const endpoint = mainConnectEndpoint(service);
  if (!endpoint) return null;

  const address = formatConnectAddress(endpoint);

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 font-mono text-muted",
        compact ? "text-[11px]" : "text-xs",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="truncate text-foreground/90">{address}</span>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void copyText(address);
        }}
        className="shrink-0 rounded p-0.5 text-subtle transition-colors hover:bg-surface-raised hover:text-vivox-400"
        aria-label={`Copy ${address}`}
      >
        <Copy className={compact ? "size-3" : "size-3.5"} />
      </button>
    </span>
  );
}
