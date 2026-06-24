"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell } from "lucide-react";
import {
  isAlertNotif,
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
  const panelRef = useRef<HTMLDivElement>(null);
  const unread = notifs.filter((n) => !n.read).length;
  const prevCount = useRef(notifs.length);

  useEffect(() => {
    prevCount.current = notifs.length;
  }, [notifs.length]);

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
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2.5">
              <span className="text-sm font-medium text-zinc-100">Activity</span>
              {notifs.length > 0 && (
                <button
                  type="button"
                  onClick={() => markAllRead()}
                  className="text-xs text-vivox-400 hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {shown.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-zinc-500">No notifications yet</p>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {shown.map((n) => (
                    <li key={n.id}>
                      <Link
                        href={`/services/${n.serviceId}`}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex items-start gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-zinc-800/50",
                          !n.read && "bg-zinc-800/30",
                          isAlertNotif(n.kind) && !n.read && "bg-amber-500/5",
                        )}
                      >
                        <span className="mt-0.5 shrink-0">{notifEmoji(n.kind)}</span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block",
                              isAlertNotif(n.kind) ? "text-amber-300" : "text-zinc-200",
                            )}
                          >
                            {notifLabel(n.kind, n.serviceName, n.meta)}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {formatRelativeTime(new Date(n.ts))}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {more > 0 && (
                <p className="border-t border-zinc-800 px-3 py-2 text-center text-xs text-zinc-500">
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
