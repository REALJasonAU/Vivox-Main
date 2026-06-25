"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Square, RotateCcw, Skull } from "lucide-react";
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
  start: "Server started",
  stop: "Server stopped",
  restart: "Server restarted",
};

const KILL_AFTER_MS = 20_000;

export function ServiceControls({ service, onChanged }: Props) {
  const [pending, setPending] = useState<ServiceAction | "kill" | null>(null);
  const [showKill, setShowKill] = useState(false);
  const stoppingSince = useRef<number | null>(null);
  const allowed = allowedActions(service.status);
  const locked = isTransient(service.status);
  const isStopping = service.status === "STOPPING";

  useEffect(() => {
    if (service.status === "STOPPING") {
      if (stoppingSince.current === null) stoppingSince.current = Date.now();
    } else {
      stoppingSince.current = null;
      setShowKill(false);
    }
  }, [service.status]);

  useEffect(() => {
    if (!isStopping || stoppingSince.current === null) return;
    const elapsed = Date.now() - stoppingSince.current;
    if (elapsed >= KILL_AFTER_MS) {
      setShowKill(true);
      return;
    }
    const timer = window.setTimeout(() => setShowKill(true), KILL_AFTER_MS - elapsed);
    return () => window.clearTimeout(timer);
  }, [isStopping, service.id]);

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

  const forceKill = async () => {
    setPending("kill");
    try {
      const updated = await servicesApi.forceStop(service.id);
      onChanged?.(updated);
      toast("Force stop sent", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Force stop failed", "error");
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
          className={locked && !isStopping ? "opacity-80" : undefined}
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
        {!isStopping && (
          <Button
            variant="danger"
            size="sm"
            disabled={!allowed.stop || locked || pending !== null}
            loading={pending === "stop"}
            onClick={() => run("stop")}
          >
            <Square className="size-3.5" /> Stop
          </Button>
        )}
        {isStopping && showKill && (
          <Button
            variant="danger"
            size="sm"
            disabled={pending !== null}
            loading={pending === "kill"}
            onClick={() => void forceKill()}
          >
            <Skull className="size-3.5" /> Kill
          </Button>
        )}
      </div>
      {locked && (
        <span className="text-[11px] text-subtle">
          {isStopping && !showKill
            ? "Graceful shutdown in progress…"
            : "Controls locked during transition…"}
        </span>
      )}
    </div>
  );
}
