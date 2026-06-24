"use client";

import { useEffect, useRef } from "react";
import { servicesApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useWebSocket } from "@/hooks/useWebSocket";
import { pushNotif } from "@/lib/notifications";
import type { AlertPayload, ServiceStatus, StatusPayload } from "@/lib/types";

const RUNNING = "RUNNING";
const CRASHED = "CRASHED";

export function useGlobalWatcher() {
  const { data: services } = useApi(() => servicesApi.list(), []);
  const { subscribe } = useWebSocket();
  const prevStatus = useRef<Record<string, ServiceStatus>>({});

  useEffect(() => {
    if (!services) return;
    for (const svc of services) {
      if (!prevStatus.current[svc.id]) {
        prevStatus.current[svc.id] = svc.status;
      }
    }
  }, [services]);

  useEffect(() => {
    if (!services || services.length === 0) return;

    const unsubs = services.flatMap((svc) => [
      subscribe<StatusPayload>(`service:${svc.id}:status`, (payload) => {
        if (!payload?.status) return;
        const next = payload.status;
        const prev = prevStatus.current[svc.id];
        if (prev === next) return;

        if (next === CRASHED) {
          pushNotif({
            kind: "crash",
            serviceId: svc.id,
            serviceName: svc.name,
          });
        } else if (next === RUNNING && prev && prev !== RUNNING) {
          pushNotif({
            kind: "running",
            serviceId: svc.id,
            serviceName: svc.name,
          });
        } else if (next === "STOPPED" && prev === RUNNING) {
          pushNotif({
            kind: "stopped",
            serviceId: svc.id,
            serviceName: svc.name,
          });
        }

        prevStatus.current[svc.id] = next;
      }),
      subscribe<AlertPayload>(`service:${svc.id}:alert`, (payload) => {
        if (!payload?.metric) return;
        pushNotif({
          kind: "alert",
          serviceId: svc.id,
          serviceName: svc.name,
          meta: {
            metric: payload.metric as "cpu" | "memory",
            value: payload.value ?? 0,
            threshold: payload.threshold ?? 0,
            operator: (payload.operator as "gt" | "lt") ?? "gt",
          },
        });
      }),
    ]);

    return () => unsubs.forEach((u) => u());
  }, [services, subscribe]);
}
