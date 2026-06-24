"use client";

import { useCallback, useEffect, useState } from "react";

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

const MAX_TOASTS = 4;
const AUTO_DISMISS_MS = 4000;

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  const snapshot = [...toasts];
  listeners.forEach((fn) => fn(snapshot));
}

function scheduleDismiss(id: string) {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  timers.set(id, timer);
}

export function dismiss(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, variant: ToastVariant = "info"): void {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const entry: Toast = { id, message, variant };

  toasts = [...toasts, entry];
  while (toasts.length > MAX_TOASTS) {
    const oldest = toasts[0];
    const timer = timers.get(oldest.id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(oldest.id);
    }
    toasts = toasts.slice(1);
  }

  emit();
  scheduleDismiss(id);
}

export function useToasts(): { toasts: Toast[]; dismiss: (id: string) => void } {
  const [state, setState] = useState<Toast[]>(() => [...toasts]);

  useEffect(() => {
    const listener: Listener = (next) => setState([...next]);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const dismissToast = useCallback((id: string) => dismiss(id), []);

  return { toasts: state, dismiss: dismissToast };
}
