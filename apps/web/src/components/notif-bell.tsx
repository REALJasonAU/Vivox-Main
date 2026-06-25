"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell } from "lucide-react";
import {
  isAlertNotif,
  loadNotifications,
  markAllRead,
  notifEmoji,
  notifLabel,
  useNotifications,
} from "@/lib/notifications";
import { formatRelativeTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

const DROPDOWN_MAX = 10;

export function NotifBell({ compact = false }: { compact?: boolean }) {
  const notifs = useNotifications();
  const [open, setOpen] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const unread = notifs.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    void loadNotifications();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as HTMLElement)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const shown = notifs.slice(0, DROPDOWN_MAX);
  const more = notifs.length - shown.length;

  return (
    <div className={cn("relative", compact && "inline-flex")} ref={panelRef}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        aria-label="Activity notifications"
        className={cn("relative", compact && "size-10 rounded-xl")}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <>
            <motion.span
              key={notifs.length}
              initial={{ scale: 1, opacity: 1 }}
              animate={{ scale: 2.2, opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="absolute right-1 top-1 size-2 rounded-full bg-red-500"
            />
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-red-500 ring-2 ring-surface" />
          </>
        )}
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -6 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "glass-raised absolute z-50 w-80 overflow-hidden rounded-xl border border-border shadow-xl",
              compact ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2",
            )}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <span className="text-sm font-medium text-foreground">Activity</span>
              {notifs.length > 0 && (
                <button
                  type="button"
                  disabled={markingRead}
                  onClick={() => {
                    setMarkingRead(true);
                    void markAllRead().finally(() => setMarkingRead(false));
                  }}
                  className="text-xs text-vivox-400 hover:underline disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {shown.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted">No notifications yet</p>
              ) : (
                <ul className="divide-y divide-border">
                  {shown.map((n) => (
                    <li key={n.id}>
                      <Link
                        href={`/services/${n.serviceId}/overview`}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex items-start gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-surface-raised/50",
                          !n.read && "bg-surface-raised/30",
                          isAlertNotif(n.kind) && !n.read && "bg-amber-500/5",
                        )}
                      >
                        <span className="mt-0.5 shrink-0">{notifEmoji(n.kind)}</span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block",
                              isAlertNotif(n.kind) ? "text-amber-300" : "text-foreground",
                            )}
                          >
                            {notifLabel(n.kind, n.serviceName, n.meta)}
                          </span>
                          <span className="text-xs text-muted">
                            {formatRelativeTime(new Date(n.ts))}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {more > 0 && (
                <p className="border-t border-border px-3 py-2 text-center text-xs text-muted">
                  {more} more event{more === 1 ? "" : "s"}…
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
