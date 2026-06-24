"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Boxes,
  Server,
  ScrollText,
  LayoutTemplate,
  ChevronLeft,
  X,
  Users,
  LayoutDashboard,
  HardDrive,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VivoxLogo } from "./vivox-logo";
import { useSession } from "@/lib/auth-client";
import { NotifBell } from "./notif-bell";
import { ThemeToggle } from "./theme-toggle";
import { SidebarUserMenu } from "./sidebar-user-menu";

const USER_NAV = [
  { href: "/dashboard", label: "My Servers", icon: HardDrive, match: ["/dashboard", "/services"] },
];

const ADMIN_NAV = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard, match: ["/admin/dashboard"] },
  { href: "/admin/servers", label: "Servers", icon: Boxes, match: ["/admin/servers", "/admin/services"] },
  { href: "/admin/users", label: "Users", icon: Users, match: ["/admin/users", "/admin/customers"] },
  { href: "/admin/nodes", label: "Nodes", icon: Server, match: ["/admin/nodes"] },
  { href: "/admin/audit", label: "Audit", icon: ScrollText, match: ["/admin/audit"] },
  { href: "/deploy", label: "Templates", icon: LayoutTemplate, match: ["/deploy"] },
];

function isAdminArea(pathname: string) {
  return pathname.startsWith("/admin") || pathname.startsWith("/deploy");
}

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  mobile?: boolean;
}

const NAV_ICON_BOX = "grid size-5 shrink-0 place-items-center";

export function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen = false,
  onMobileClose,
  mobile = false,
}: SidebarProps) {
  const pathname = usePathname();
  const isCollapsed = collapsed && !mobile;
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === "admin";
  const inAdminArea = isAdminArea(pathname);
  const NAV = isAdmin && inAdminArea ? ADMIN_NAV : USER_NAV;
  const homeHref = isAdmin && inAdminArea ? "/admin/dashboard" : "/dashboard";

  const content = (
    <>
      {/* Logo */}
      <div
        className={cn(
          "flex shrink-0 items-center",
          isCollapsed ? "justify-center px-0 py-3" : "justify-between gap-2 px-1 py-3",
        )}
      >
        <Link
          href={homeHref}
          className={cn(
            "flex items-center",
            isCollapsed ? "size-10 justify-center" : "min-w-0 gap-2.5",
          )}
          title="Vivox"
        >
          <motion.div
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className="grid size-9 shrink-0 place-items-center"
          >
            <VivoxLogo size={isCollapsed ? 28 : 32} />
          </motion.div>
          {!isCollapsed && (
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">
              Vivox
            </span>
          )}
        </Link>
        {mobile && onMobileClose && (
          <button
            type="button"
            onClick={onMobileClose}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-raised hover:text-foreground md:hidden"
            aria-label="Close menu"
          >
            <X className="size-5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="mt-1 flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden">
        {NAV.map((item) => {
          const active = item.match.some((m) => pathname.startsWith(m));
          const Icon = item.icon;
          return (
            <Link
              key={item.href + item.label}
              href={item.href}
              title={isCollapsed ? item.label : undefined}
              onClick={mobile ? onMobileClose : undefined}
              className={cn(
                "group relative flex items-center rounded-xl text-sm font-medium transition-colors duration-200",
                isCollapsed ? "mx-auto size-10 justify-center" : "h-10 gap-3 px-3",
                active
                  ? "bg-surface-raised text-foreground"
                  : "text-muted hover:bg-surface-raised/70 hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId={mobile ? "mobile-sidebar-active" : "sidebar-active"}
                  className="absolute inset-0 -z-10 rounded-xl bg-surface-raised"
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                />
              )}
              <span className={NAV_ICON_BOX}>
                <Icon className={cn("size-[18px]", active && "text-vivox-500")} strokeWidth={active ? 2.25 : 2} />
              </span>
              {!isCollapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer: notifications, theme, user, collapse */}
      <div className={cn("mt-auto flex shrink-0 flex-col gap-1 pt-3", isCollapsed && "items-center")}>
        <div
          className={cn(
            "flex items-center",
            isCollapsed ? "flex-col gap-1" : "gap-1 px-1",
          )}
        >
          <NotifBell compact />
          <ThemeToggle compact />
          {isAdmin && !inAdminArea && (
            <Link
              href="/admin/dashboard"
              title="Admin panel"
              onClick={mobile ? onMobileClose : undefined}
              className="grid size-10 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-vivox-500/10 hover:text-vivox-500"
            >
              <Shield className="size-4" strokeWidth={2} />
            </Link>
          )}
        </div>

        <div className={cn("w-full", isCollapsed ? "flex justify-center" : "px-0")}>
          <SidebarUserMenu
            collapsed={isCollapsed}
            isAdmin={isAdmin}
            inAdminArea={inAdminArea}
            onNavigate={mobile ? onMobileClose : undefined}
          />
        </div>

        {isAdmin && inAdminArea && (
          <Link
            href="/dashboard"
            onClick={mobile ? onMobileClose : undefined}
            className={cn(
              "w-full rounded-lg border-t border-border/50 text-muted transition-colors hover:bg-surface-raised hover:text-foreground",
              isCollapsed
                ? "mt-0.5 px-1 py-2 text-center text-[10px] font-medium leading-tight"
                : "mt-0.5 px-2.5 py-2 text-sm font-medium",
            )}
          >
            {isCollapsed ? "User panel" : "← User panel"}
          </Link>
        )}

        {!mobile && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className={cn(
              "flex items-center rounded-lg text-xs text-muted transition-colors hover:bg-surface-raised hover:text-foreground",
              isCollapsed ? "size-10 justify-center" : "mt-1 h-9 w-full justify-center gap-2",
            )}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <motion.span
              animate={{ rotate: isCollapsed ? 180 : 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 24 }}
              className="grid size-5 place-items-center"
            >
              <ChevronLeft className="size-4" />
            </motion.span>
            {!isCollapsed && "Collapse"}
          </button>
        )}
      </div>
    </>
  );

  if (mobile) {
    return (
      <>
        {mobileOpen && (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden dark:bg-black/60"
            onClick={onMobileClose}
            aria-label="Close navigation"
          />
        )}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[17.5rem] flex-col border-r border-border bg-surface p-3 transition-transform duration-200 md:hidden",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          {content}
        </aside>
      </>
    );
  }

  return (
    <motion.aside
      animate={{ width: isCollapsed ? 72 : 256 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="sticky top-0 z-40 hidden h-screen shrink-0 flex-col border-r border-border bg-surface p-3 md:flex"
    >
      {content}
    </motion.aside>
  );
}
