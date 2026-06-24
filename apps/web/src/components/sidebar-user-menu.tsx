"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, User as UserIcon, ChevronUp, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession, signOut } from "@/lib/auth-client";

interface SidebarUserMenuProps {
  collapsed: boolean;
  isAdmin?: boolean;
  inAdminArea?: boolean;
  onNavigate?: () => void;
}

export function SidebarUserMenu({
  collapsed,
  isAdmin = false,
  inAdminArea = false,
  onNavigate,
}: SidebarUserMenuProps) {
  const router = useRouter();
  const { data } = useSession();
  const [open, setOpen] = useState(false);

  const user = data?.user;
  const initial = (user?.name ?? user?.email ?? "?").charAt(0).toUpperCase();
  const displayName = user?.name ?? user?.email ?? "Account";

  const closeAnd = (fn: () => void) => {
    setOpen(false);
    onNavigate?.();
    fn();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        title={collapsed ? displayName : undefined}
        className={cn(
          "flex w-full items-center rounded-xl transition-colors hover:bg-surface-raised",
          collapsed ? "size-10 justify-center p-0" : "gap-2.5 px-2.5 py-2",
        )}
        aria-label="Account menu"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-vivox-500/15 text-sm font-semibold text-vivox-500 ring-1 ring-border">
          {initial}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-medium text-foreground">{displayName}</span>
              <span className="block truncate text-xs text-muted">{user?.email ?? "—"}</span>
            </span>
            <ChevronUp
              className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")}
            />
          </>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "glass-raised absolute bottom-full z-50 mb-2 overflow-hidden rounded-xl border border-border p-1 shadow-xl",
              collapsed ? "left-0 w-56" : "inset-x-0",
            )}
          >
            <button
              type="button"
              onClick={() => closeAnd(() => router.push("/settings"))}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              <UserIcon className="size-4 shrink-0" /> Profile & settings
            </button>
            {isAdmin && !inAdminArea && (
              <button
                type="button"
                onClick={() => closeAnd(() => router.push("/admin/dashboard"))}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-vivox-500/10 hover:text-vivox-500"
              >
                <Shield className="size-4 shrink-0" /> Admin panel
              </button>
            )}
            {isAdmin && inAdminArea && (
              <button
                type="button"
                onClick={() => closeAnd(() => router.push("/dashboard"))}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                User panel
              </button>
            )}
            <div className="my-1 h-px bg-border/60" />
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                onNavigate?.();
                await signOut();
                router.push("/login");
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              <LogOut className="size-4 shrink-0" /> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
