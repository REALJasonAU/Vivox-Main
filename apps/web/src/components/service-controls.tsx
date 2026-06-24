"use client";

import { useState } from "react";
import { Play, Square, RotateCcw } from "lucide-react";
import { servicesApi } from "@/lib/api";
import { toast } from "@/hooks/useToast";
import { allowedActions, isTransient, type ServiceAction } from "@/lib/status";
import type { Service } from "@/lib/types";
import { Button } from "./ui/button";

interface Props {
  service: Service;
  onChanged?: (service: Service) => void;
}

const SUCCESS_MESSAGES: Record<ServiceAction, string> = {
  start: "Service started",
  stop: "Service stopped",
  restart: "Service restarted",
};

export function ServiceControls({ service, onChanged }: Props) {
  const [pending, setPending] = useState<ServiceAction | null>(null);
  const allowed = allowedActions(service.status);
  const locked = isTransient(service.status);

  const run = async (action: ServiceAction) => {
    setPending(action);
    try {
      const updated = await servicesApi.action(service.id, action);
      onChanged?.(updated);
      toast(SUCCESS_MESSAGES[action], "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="primary"
          size="sm"
          actionType="start"
          disabled={!allowed.start || locked || pending !== null}
          loading={pending === "start"}
          onClick={() => run("start")}
          className={locked ? "opacity-80" : undefined}
        >
          <Play className="size-3.5" /> Start
        </Button>
        <Button
          variant="secondary"
          size="sm"
          actionType="restart"
          disabled={!allowed.restart || locked || pending !== null}
          loading={pending === "restart"}
          onClick={() => run("restart")}
        >
          <RotateCcw className="size-3.5" /> Restart
        </Button>
        <Button
          variant="danger"
          size="sm"
          actionType="stop"
          disabled={!allowed.stop || locked || pending !== null}
          loading={pending === "stop"}
          onClick={() => run("stop")}
        >
          <Square className="size-3.5" /> Stop
        </Button>
      </div>
      {locked && (
        <span className="text-[11px] text-subtle">Controls locked during transition…</span>
      )}
    </div>
  );
}
