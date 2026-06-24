"use client";

import { useEffect, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { Node, Service, ServiceStatus, StatusPayload } from "@/lib/types";

export interface NodeStatusPayload {
  status?: string;
  cpu_cores?: number;
  ram_mb?: number;
  disk_gb?: number;
}

export function useLiveServiceStatuses(services: Service[]) {
  const { subscribe } = useWebSocket();
  const [statuses, setStatuses] = useState<Map<string, ServiceStatus>>(() => new Map());

  useEffect(() => {
    setStatuses(new Map(services.map((s) => [s.id, s.status])));
  }, [services]);

  useEffect(() => {
    if (services.length === 0) return;
    const unsubs = services.map((s) =>
      subscribe<StatusPayload>(`service:${s.id}:status`, (payload) => {
        if (!payload?.status) return;
        setStatuses((prev) => {
          const next = new Map(prev);
          next.set(s.id, payload.status!);
          return next;
        });
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [services, subscribe]);

  return statuses;
}

export interface LiveNodeState {
  status: string;
  capacity?: { cpu_cores: number; ram_mb: number; disk_gb: number };
}

export function useLiveNodeStatuses(nodes: Node[]) {
  const { subscribe } = useWebSocket();
  const [live, setLive] = useState<Map<string, LiveNodeState>>(() => new Map());

  useEffect(() => {
    setLive(
      new Map(
        nodes.map((n) => [
          n.id,
          {
            status: n.status,
            capacity: n.capacity,
          },
        ]),
      ),
    );
  }, [nodes]);

  useEffect(() => {
    if (nodes.length === 0) return;
    const unsubs = nodes.map((n) =>
      subscribe<NodeStatusPayload>(`node:${n.id}:status`, (payload) => {
        if (!payload) return;
        setLive((prev) => {
          const next = new Map(prev);
          const cur = next.get(n.id) ?? { status: n.status, capacity: n.capacity };
          const capacity =
            payload.cpu_cores != null || payload.ram_mb != null || payload.disk_gb != null
              ? {
                  cpu_cores: payload.cpu_cores ?? cur.capacity?.cpu_cores ?? 0,
                  ram_mb: payload.ram_mb ?? cur.capacity?.ram_mb ?? 0,
                  disk_gb: payload.disk_gb ?? cur.capacity?.disk_gb ?? 0,
                }
              : cur.capacity;
          next.set(n.id, {
            status: payload.status ?? cur.status,
            capacity,
          });
          return next;
        });
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [nodes, subscribe]);

  return live;
}

export function useLiveNodeStatus(node: Node | undefined) {
  const nodes = node ? [node] : [];
  const live = useLiveNodeStatuses(nodes);
  if (!node) return undefined;
  return live.get(node.id);
}
