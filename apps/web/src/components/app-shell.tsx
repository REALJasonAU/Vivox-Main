"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { PageTransition } from "./page-transition";
import { useGlobalWatcher } from "@/hooks/useGlobalWatcher";

const SIDEBAR_KEY = "vivox-sidebar-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  useGlobalWatcher();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === "true") setCollapsed(true);
  }, []);

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  };

  return (
    <div className="relative flex min-h-screen bg-background">
      <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      <Sidebar
        mobile
        collapsed={false}
        onToggleCollapse={() => {}}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-7xl">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>
    </div>
  );
}
