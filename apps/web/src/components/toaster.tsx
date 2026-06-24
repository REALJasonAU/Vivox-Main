"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X, CheckCircle2, AlertTriangle, Info, XCircle } from "lucide-react";
import { useToasts } from "@/hooks/useToast";
import type { ToastVariant } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

const ICONS: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle2 className="size-4 text-emerald-400" />,
  error: <XCircle className="size-4 text-red-400" />,
  warning: <AlertTriangle className="size-4 text-amber-400" />,
  info: <Info className="size-4 text-vivox-400" />,
};

const TINT: Record<ToastVariant, string> = {
  success: "border-emerald-500/25 bg-emerald-500/10",
  error: "border-red-500/25 bg-red-500/10",
  warning: "border-amber-500/25 bg-amber-500/10",
  info: "border-vivox-500/25 bg-vivox-500/10",
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[9999] flex flex-col items-end gap-2">
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 80, scale: 0.88 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 70, scale: 0.88, transition: { duration: 0.22 } }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}
            className={cn(
              "pointer-events-auto flex w-80 items-start gap-3 rounded-xl border p-3.5 shadow-lg backdrop-blur-md",
              TINT[t.variant],
            )}
            role="status"
          >
            <span className="mt-0.5 shrink-0">{ICONS[t.variant]}</span>
            <span className="flex-1 text-sm text-zinc-100">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded p-0.5 text-zinc-500 hover:text-zinc-200"
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
