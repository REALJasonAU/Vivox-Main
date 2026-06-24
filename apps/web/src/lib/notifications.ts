"use client";

import { useCallback, useEffect, useState } from "react";

export type NotifKind = "crash" | "running" | "stopped" | "deploy_ok" | "deploy_fail" | "alert";

export interface AlertMeta {
  metric?: string;
  value?: number;
  threshold?: number;
  operator?: string;
}

export interface Notification {
  id: string;
  serviceId: string;
  serviceName: string;
  kind: NotifKind;
  ts: number;
  read: boolean;
  meta?: AlertMeta;
}

const MAX = 50;
let _notifs: Notification[] = [];
const _listeners = new Set<(n: Notification[]) => void>();

function emit() {
  const snapshot = [..._notifs];
  _listeners.forEach((fn) => fn(snapshot));
}

export function pushNotif(n: Omit<Notification, "id" | "ts" | "read">) {
  const entry: Notification = {
    ...n,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ts: Date.now(),
    read: false,
  };
  _notifs = [entry, ..._notifs];
  if (_notifs.length > MAX) {
    _notifs = _notifs.slice(0, MAX);
  }
  emit();
}

export function markAllRead() {
  _notifs = _notifs.map((n) => ({ ...n, read: true }));
  emit();
}

export function useNotifications(): Notification[] {
  const [state, setState] = useState<Notification[]>(() => [..._notifs]);

  useEffect(() => {
    const listener = (next: Notification[]) => setState([...next]);
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  }, []);

  return state;
}

export function useUnreadCount(): number {
  const notifs = useNotifications();
  return notifs.filter((n) => !n.read).length;
}

export function notifLabel(kind: NotifKind, serviceName: string, meta?: AlertMeta): string {
  switch (kind) {
    case "crash":
      return `${serviceName} crashed`;
    case "running":
      return `${serviceName} came back online`;
    case "stopped":
      return `${serviceName} stopped`;
    case "deploy_ok":
      return `${serviceName} deployed successfully`;
    case "deploy_fail":
      return `${serviceName} deploy failed`;
    case "alert": {
      if (!meta?.metric) return `${serviceName} alert triggered`;
      const unit = meta.metric === "cpu" ? "%" : " MB";
      const op = meta.operator === "lt" ? "<" : ">";
      const val = meta.value != null ? Math.round(meta.value) : "?";
      const label = meta.metric === "cpu" ? "CPU" : "Memory";
      return `${label} ${op} ${meta.threshold ?? "?"}${unit} on ${serviceName} (${val}${unit})`;
    }
  }
}

export function notifEmoji(kind: NotifKind): string {
  switch (kind) {
    case "crash":
    case "deploy_fail":
      return "🔴";
    case "alert":
      return "⚠️";
    case "running":
    case "deploy_ok":
      return "🟢";
    case "stopped":
      return "⚪";
  }
}

export function isAlertNotif(kind: NotifKind): boolean {
  return kind === "alert";
}
