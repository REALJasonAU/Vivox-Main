"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useSpring, useTransform } from "framer-motion";
import { LayoutGrid, List, Server } from "lucide-react";
import { servicesApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useLiveServiceStatuses } from "@/hooks/useLiveStatuses";
import type { Service, ServiceStatus } from "@/lib/types";
import { ServiceCard } from "@/components/service-card";
import { ServiceRow } from "@/components/service-row";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { isTransient } from "@/lib/status";

type ViewMode = "grid" | "list";
const VIEW_KEY = "vivox-view";

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.055, delayChildren: 0.04 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const },
  },
};

function AnimatedNumber({ value }: { value: number }) {
  const spring = useSpring(0, { stiffness: 80, damping: 18 });
  const display = useTransform(spring, (v) => Math.round(v).toString());

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  return <motion.span>{display}</motion.span>;
}

function SummaryCard({ label, value, index }: { label: string; value: number; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
      className="rounded-xl border border-border bg-surface p-3"
    >
      <p className="text-3xl font-semibold tracking-tight text-foreground">
        <AnimatedNumber value={value} />
      </p>
      <p className="mt-1 text-xs uppercase tracking-wider text-muted">{label}</p>
    </motion.div>
  );
}

function isStartingStatus(status: ServiceStatus): boolean {
  return isTransient(status);
}

export default function DashboardPage() {
  const { data: ownedData, loading, error: ownedError } = useApi<Service[]>(
    () => servicesApi.list(),
  );
  const services = ownedData ?? [];
  const error = ownedError;
  const statusMap = useLiveServiceStatuses(services);
  const [view, setView] = useState<ViewMode>("grid");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const allTags = useMemo(
    () => [...new Set(services.flatMap((s) => s.tags ?? []))].sort(),
    [services],
  );

  useEffect(() => {
    const stored = localStorage.getItem(VIEW_KEY);
    if (stored === "list" || stored === "grid") setView(stored);
  }, []);

  const setViewMode = (mode: ViewMode) => {
    setView(mode);
    localStorage.setItem(VIEW_KEY, mode);
  };

  const liveServices = useMemo(
    () =>
      services.map((s) => ({
        ...s,
        status: statusMap.get(s.id) ?? s.status,
      })),
    [services, statusMap],
  );

  const filteredServices = useMemo(
    () =>
      activeTag ? liveServices.filter((s) => s.tags?.includes(activeTag)) : liveServices,
    [liveServices, activeTag],
  );

  const running = filteredServices.filter((s) => s.status === "RUNNING").length;
  const starting = filteredServices.filter((s) => isStartingStatus(s.status)).length;
  const stopped = filteredServices.filter((s) => s.status === "STOPPED").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">My Servers</h1>
        <div className="flex items-center gap-2">
          {services.length > 0 && (
            <div className="flex rounded-lg border border-border bg-background/50 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={cn(
                  "rounded-md p-2 transition-colors",
                  view === "grid" ? "bg-surface-raised text-foreground" : "text-muted hover:text-foreground",
                )}
                aria-label="Grid view"
              >
                <LayoutGrid className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={cn(
                  "rounded-md p-2 transition-colors",
                  view === "list" ? "bg-surface-raised text-foreground" : "text-muted hover:text-foreground",
                )}
                aria-label="List view"
              >
                <List className="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((tag) => (
            <motion.button
              key={tag}
              type="button"
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              whileTap={{ scale: 0.95 }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                activeTag === tag
                  ? "border-vivox-500/50 bg-vivox-500/10 text-vivox-400"
                  : "border-border-focus text-muted hover:border-border-focus hover:text-foreground",
              )}
            >
              {tag}
            </motion.button>
          ))}
        </div>
      )}

      {!loading && services.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryCard label="Running" value={running} index={0} />
          <SummaryCard label="Starting" value={starting} index={1} />
          <SummaryCard label="Stopped" value={stopped} index={2} />
        </div>
      )}

      {error && (
        <ErrorBanner
          message={`Could not load services (${error}). The control plane API may be offline.`}
        />
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[132px]" />
          ))}
        </div>
      ) : filteredServices.length === 0 && activeTag ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-sm text-muted">
            No servers tagged{" "}
            <span className="font-mono text-foreground">#{activeTag}</span>
          </p>
          <Button variant="ghost" size="sm" onClick={() => setActiveTag(null)}>
            Clear filter
          </Button>
        </div>
      ) : services.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border py-14 text-center">
          <div className="grid size-16 place-items-center rounded-2xl bg-surface-raised">
            <Server className="size-8 text-muted" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-foreground">No servers here</h2>
            <p className="mt-1 text-sm text-muted">
              Your servers will appear here once they&apos;ve been set up. Contact support to get started.
            </p>
          </div>
        </div>
      ) : view === "list" ? (
        <div className="flex flex-col gap-2">
          {filteredServices.map((service) => (
            <ServiceRow key={service.id} service={service} />
          ))}
        </div>
      ) : (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {filteredServices.map((service) => (
            <motion.div key={service.id} variants={cardVariants}>
              <ServiceCard service={service} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
