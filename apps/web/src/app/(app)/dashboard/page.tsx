"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useSpring, useTransform } from "framer-motion";
import { Boxes, LayoutGrid, List, Play, Rocket, RotateCcw, Server, Square, X, User, Users, Share2 } from "lucide-react";
import { servicesApi, adminApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { Service, ServiceStatus, StatusPayload } from "@/lib/types";
import { ServiceCard } from "@/components/service-card";
import { ServiceRow } from "@/components/service-row";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { useSession } from "@/lib/auth-client";

type ViewMode = "grid" | "list";
type AdminScope = "mine" | "shared" | "others";
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

function useLiveServiceStatuses(services: Service[]) {
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
          next.set(s.id, payload.status);
          return next;
        });
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [services, subscribe]);

  return statuses;
}

function LiveStatsStrip({
  services,
  statusMap,
}: {
  services: Service[];
  statusMap: Map<string, ServiceStatus>;
}) {
  const counts = useMemo(() => {
    let running = 0;
    let starting = 0;
    let stopped = 0;
    for (const s of services) {
      const status = statusMap.get(s.id) ?? s.status;
      if (status === "RUNNING") running++;
      else if (status === "PROVISIONING" || status === "STARTING" || status === "STOPPING")
        starting++;
      else if (status === "STOPPED") stopped++;
    }
    return { running, starting, stopped };
  }, [services, statusMap]);

  if (services.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/90 px-4 py-3 text-sm text-zinc-300 backdrop-blur-md">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
        <span>
          <strong className="font-semibold text-zinc-100">{counts.running}</strong> running
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-full border border-amber-400 bg-amber-400/30 animate-pulse" aria-hidden />
        <span>
          <strong className="font-semibold text-zinc-100">{counts.starting}</strong> starting
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-sm border border-zinc-500 bg-zinc-700" aria-hidden />
        <span>
          <strong className="font-semibold text-zinc-100">{counts.stopped}</strong> stopped
        </span>
      </span>
    </div>
  );
}

function SummaryCard({ label, value, index }: { label: string; value: number; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
      className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
    >
      <p className="text-3xl font-semibold tracking-tight text-zinc-100">
        <AnimatedNumber value={value} />
      </p>
      <p className="mt-1 text-xs uppercase tracking-wider text-zinc-500">{label}</p>
    </motion.div>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const userId = session?.user?.id;
  const isAdmin = role === "admin";

  const { data: ownedData, loading: ownedLoading, error: ownedError } = useApi<Service[]>(
    () => servicesApi.list(),
  );
  const { data: allData, loading: allLoading } = useApi<Service[]>(
    () => (isAdmin ? adminApi.services() : Promise.resolve([])),
    [isAdmin],
  );

  const [adminScope, setAdminScope] = useState<AdminScope>("mine");
  const services = useMemo(() => {
    if (!isAdmin || adminScope === "mine") return ownedData ?? [];
    const all = allData ?? [];
    if (adminScope === "shared") {
      return all.filter((s) => s.team_id === userId && s.owner_id !== userId);
    }
    return all.filter((s) => s.owner_id !== userId && s.team_id !== userId);
  }, [isAdmin, adminScope, ownedData, allData, userId]);

  const loading = isAdmin && adminScope !== "mine" ? allLoading : ownedLoading;
  const error = ownedError;
  const statusMap = useLiveServiceStatuses(services);
  const [view, setView] = useState<ViewMode>("grid");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState<"start" | "stop" | "restart" | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const allTags = useMemo(
    () => [...new Set(services.flatMap((s) => s.tags ?? []))].sort(),
    [services],
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectionMode(true);
  };

  const selectAll = () => setSelected(new Set(services.map((s) => s.id)));
  const clearSelection = () => {
    setSelected(new Set());
    setSelectionMode(false);
  };

  const enterSelection = (id: string) => {
    setSelectionMode(true);
    setSelected(new Set([id]));
  };

  const bulkAction = async (action: "start" | "stop" | "restart") => {
    setBulkLoading(action);
    const ids = Array.from(selected);
    const results = await Promise.allSettled(ids.map((id) => servicesApi.action(id, action)));
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) {
      toast(`${action} sent to ${succeeded} service${succeeded > 1 ? "s" : ""}`, "success");
    } else {
      toast(`${succeeded} succeeded, ${failed} failed`, "warning");
    }
    clearSelection();
    setBulkLoading(null);
  };

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
  const stopped = filteredServices.filter((s) => s.status === "STOPPED").length;
  const ramUsedMb = filteredServices
    .filter((s) => s.status === "RUNNING")
    .reduce((sum, s) => sum + s.resource_limits.memory_mb, 0);
  const transient = filteredServices.filter((s) =>
    ["PROVISIONING", "STARTING", "STOPPING"].includes(s.status),
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">My Servers</h1>
          <p className="mt-1 text-sm text-muted">
            {activeTag ? `${filteredServices.length} tagged · ` : ""}
            {services.length} in view · {running} running
            {transient > 0 && ` · ${transient} in transition`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {services.length > 0 && (
            <div className="flex rounded-lg border border-zinc-800 bg-zinc-950/50 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={cn(
                  "rounded-md p-2 transition-colors",
                  view === "grid" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
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
                  view === "list" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
                )}
                aria-label="List view"
              >
                <List className="size-4" />
              </button>
            </div>
          )}
          {isAdmin && (
            <Link href="/deploy">
              <Button actionType="deploy">
                <Rocket className="size-4" />
                Deploy service
              </Button>
            </Link>
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: "mine" as const, label: "My servers", icon: User, count: (ownedData ?? []).length },
              {
                id: "shared" as const,
                label: "Shared with me",
                icon: Share2,
                count: (allData ?? []).filter((s) => s.team_id === userId && s.owner_id !== userId).length,
              },
              {
                id: "others" as const,
                label: "Other users",
                icon: Users,
                count: (allData ?? []).filter((s) => s.owner_id !== userId && s.team_id !== userId).length,
              },
            ] as const
          ).map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              type="button"
              onClick={() => setAdminScope(id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm transition-all duration-200",
                adminScope === id
                  ? "border-vivox-500/40 bg-vivox-500/10 text-foreground"
                  : "border-border bg-surface text-muted hover:border-border-focus hover:text-foreground",
              )}
            >
              <Icon className={cn("size-4", adminScope === id && "text-vivox-500")} />
              {label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-xs font-mono",
                  adminScope === id ? "bg-vivox-500/15 text-vivox-500" : "bg-surface-raised text-subtle",
                )}
              >
                {count}
              </span>
            </button>
          ))}
        </div>
      )}

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
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300",
              )}
            >
              {tag}
            </motion.button>
          ))}
        </div>
      )}

      <LiveStatsStrip services={filteredServices} statusMap={statusMap} />

      {!loading && services.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <SummaryCard label="Running" value={running} index={0} />
          <SummaryCard label="Stopped" value={stopped} index={1} />
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.14, duration: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
          >
            <p className="text-3xl font-semibold tracking-tight text-zinc-100">
              <AnimatedNumber value={ramUsedMb} /> MB
            </p>
            <p className="mt-1 text-xs uppercase tracking-wider text-zinc-500">RAM used</p>
          </motion.div>
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
        <div className="flex flex-col items-center gap-5 rounded-2xl border border-dashed border-border py-20 text-center">
          <div className="grid size-16 place-items-center rounded-2xl bg-surface-raised">
            <Server className="size-8 text-muted" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-foreground">No servers here</h2>
            <p className="mt-1 text-sm text-muted">
              {isAdmin && adminScope === "mine"
                ? "Deploy your first server to get started."
                : isAdmin && adminScope === "shared"
                  ? "No servers have been shared with you yet."
                  : isAdmin && adminScope === "others"
                    ? "No other users' servers to show."
                    : "Your servers will appear here once they've been set up. Contact support to get started."}
            </p>
          </div>
          {isAdmin && adminScope === "mine" && (
            <Link href="/deploy">
              <Button size="lg" actionType="deploy">
                <Rocket className="size-4" /> Deploy a server
              </Button>
            </Link>
          )}
        </div>
      ) : view === "list" ? (
        <div className="flex flex-col gap-2">
          {filteredServices.map((service) => (
            <ServiceRow
              key={service.id}
              service={service}
              selectionMode={selectionMode}
              selected={selected.has(service.id)}
              onToggle={() => toggleSelect(service.id)}
              onLongPress={() => enterSelection(service.id)}
            />
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
              <ServiceCard
                service={service}
                selectionMode={selectionMode}
                selected={selected.has(service.id)}
                onToggle={() => toggleSelect(service.id)}
                onLongPress={() => enterSelection(service.id)}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
          >
            <div className="flex items-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900/95 px-4 py-3 shadow-2xl backdrop-blur-md">
              <span className="mr-1 text-sm text-zinc-400">
                {selected.size} service{selected.size > 1 ? "s" : ""} selected
              </span>
              <div className="mx-2 h-4 w-px bg-zinc-700" />
              <Button size="sm" variant="secondary" onClick={selectAll}>
                Select all
              </Button>
              <Button
                size="sm"
                variant="ghost"
                actionType="start"
                loading={bulkLoading === "start"}
                onClick={() => void bulkAction("start")}
              >
                <Play className="size-3.5" /> Start
              </Button>
              <Button
                size="sm"
                variant="ghost"
                actionType="stop"
                loading={bulkLoading === "stop"}
                onClick={() => void bulkAction("stop")}
              >
                <Square className="size-3.5" /> Stop
              </Button>
              <Button
                size="sm"
                variant="ghost"
                actionType="restart"
                loading={bulkLoading === "restart"}
                onClick={() => void bulkAction("restart")}
              >
                <RotateCcw className="size-3.5" /> Restart
              </Button>
              <div className="mx-2 h-4 w-px bg-zinc-700" />
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                <X className="size-3.5" /> Cancel
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
