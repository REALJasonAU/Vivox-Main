"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Globe, X, Download } from "lucide-react";
import { servicesApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useTopic } from "@/hooks/useWebSocket";
import type { Service, ServiceDomain, ServiceStatus, StatusPayload } from "@/lib/types";
import { STATUS_META, isTransient } from "@/lib/status";
import { portsForDisplay } from "@/lib/ports";
import { PortDisplayList } from "@/components/port-display-list";
import { Console } from "@/components/Console";
import { StartupTab } from "@/components/env-tab";
import { FileManager } from "@/components/FileManager";
import { ScheduleTab } from "@/components/schedule-tab";
import { LogsFeed } from "@/components/logs-feed";
import { MetricsChart } from "@/components/metrics-chart";
import { HealthIndicator } from "@/components/health-indicator";
import { MinecraftFrameworkPicker } from "@/components/minecraft-switcher";
import { PluginManager } from "@/components/plugin-manager";
import { RustPluginManager } from "@/components/rust-plugin-manager";
import { ServerCfgEditor } from "@/components/server-cfg-editor";
import { ServerPropertiesEditor } from "@/components/server-properties-editor";
import { BackupsTab } from "@/components/backups-tab";
import { ServiceControls } from "@/components/service-controls";
import { useCommandPalette } from "@/components/command-palette-provider";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Skeleton } from "@/components/ui/states";
import { cn, formatRelativeTime } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import {
  buildGameServiceTabs,
  isMinecraftGame,
  isRustGame,
  pluginTabLabel,
  showMcPluginTab,
  showRustPluginTab,
} from "@/lib/game-service";
import {
  formatCpuLimit,
  formatMemoryLimit,
  formatStorageLimit,
} from "@/lib/allocations";
import {
  absoluteToFileRel,
  buildServicePath,
  fileRelToAbsolute,
  parseServiceRoute,
} from "@/lib/service-routes";

export function ServiceDetailPage({
  serviceId,
  segments,
}: {
  serviceId: string;
  segments?: string[];
}) {
  const router = useRouter();
  const { setContextServiceId } = useCommandPalette();
  const { data, loading, error, refetch } = useApi<Service>(
    () => servicesApi.get(serviceId),
    [serviceId],
  );

  const [service, setService] = useState<Service | null>(null);

  const tabs = useMemo(
    () =>
      service
        ? buildGameServiceTabs(service)
        : ["Overview", "Console", "Files", "Schedule", "Backups", "Startup", "Logs", "Settings"],
    [service],
  );

  const [tab, setTab] = useState<string>(() => {
    const route = parseServiceRoute(segments, tabs);
    return route.tab;
  });
  const [fileDirRel, setFileDirRel] = useState<string | undefined>(() => {
    const route = parseServiceRoute(segments, tabs);
    if (route.tab !== "Files" || !route.fileRelPath) return undefined;
    if (route.selectedFileRel) {
      const parts = route.selectedFileRel.split("/");
      parts.pop();
      return parts.join("/");
    }
    return route.fileRelPath;
  });
  const [selectedFileAbs, setSelectedFileAbs] = useState<string | undefined>(() => {
    const route = parseServiceRoute(segments, tabs);
    return route.selectedFileRel ? fileRelToAbsolute(route.selectedFileRel) : undefined;
  });

  const pluginTab = service ? pluginTabLabel(service) : null;

  useEffect(() => {
    if (data) setService(data);
  }, [data]);

  useEffect(() => {
    if (!service) return;
    const parsed = parseServiceRoute(segments, tabs);
    if (!tabs.includes(parsed.tab)) {
      router.replace(buildServicePath(serviceId, "Overview"));
    }
  }, [service, segments, tabs, serviceId, router]);

  useEffect(() => {
    setContextServiceId(serviceId);
    return () => setContextServiceId(null);
  }, [serviceId, setContextServiceId]);

  useTopic<StatusPayload>(`service:${serviceId}:status`, (payload) => {
    if (payload?.status) {
      setService((prev) => (prev ? { ...prev, status: payload.status } : prev));
    }
  });

  const navigateTab = useCallback(
    (nextTab: string) => {
      const path = buildServicePath(serviceId, nextTab);
      window.history.pushState(null, "", path);
      setTab(nextTab);
      if (nextTab !== "Files") {
        setFileDirRel(undefined);
        setSelectedFileAbs(undefined);
      }
    },
    [serviceId],
  );

  const navigateFiles = useCallback(
    (absPath: string) => {
      const rel = absoluteToFileRel(absPath);
      const isFile = rel.split("/").pop()?.includes(".") ?? false;
      const dirRel = isFile ? rel.split("/").slice(0, -1).join("/") : rel;
      const nextPath = buildServicePath(serviceId, "Files", {
        selectedFileRel: isFile ? rel : undefined,
        fileDirRel: dirRel,
      });
      window.history.pushState(null, "", nextPath);
      setTab("Files");
      setFileDirRel(dirRel);
      setSelectedFileAbs(isFile ? absPath : undefined);
    },
    [serviceId],
  );

  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname;
      const match = path.match(/^\/services\/[^/]+\/(.*)/);
      const segs = match?.[1] ? match[1].split("/").filter(Boolean) : [];
      const route = parseServiceRoute(segs.length ? segs : undefined, tabs);
      setTab(route.tab);
      if (route.tab === "Files") {
        if (route.selectedFileRel) {
          const parts = route.selectedFileRel.split("/");
          parts.pop();
          setFileDirRel(parts.join("/"));
          setSelectedFileAbs(fileRelToAbsolute(route.selectedFileRel));
        } else {
          setFileDirRel(route.fileRelPath);
          setSelectedFileAbs(undefined);
        }
      } else {
        setFileDirRel(undefined);
        setSelectedFileAbs(undefined);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [tabs]);

  if (loading && !service) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error && !service) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <ErrorBanner message={`Could not load server (${error}).`} />
      </div>
    );
  }

  if (!service) return null;

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{service.name}</h1>
            <StatusBadge status={service.status} />
          </div>
          <p className="mt-1 text-sm text-muted">{STATUS_META[service.status].description}</p>
        </div>
        <ServiceControls service={service} onChanged={setService} />
      </div>

      <TabBar tabs={tabs} tab={tab} onChange={navigateTab} />

      <div className="relative">
        <div
          className={cn(
            "transition-opacity duration-150",
            tab === "Overview" ? "opacity-100" : "hidden opacity-0",
          )}
        >
          <OverviewTab service={service} />
        </div>
        <div className={tab === "Console" ? undefined : "hidden"}>
          <Console serviceId={service.id} active={tab === "Console"} initialStatus={service.status} />
        </div>
        <div className={tab === "Files" ? undefined : "hidden"}>
          <FileManager
            serviceId={service.id}
            initialDirRel={fileDirRel}
            initialSelectedFile={selectedFileAbs}
            onPathChange={navigateFiles}
          />
        </div>
        {isRustGame(service) && (
          <div className={tab === "CFG Editor" ? undefined : "hidden"}>
            <ServerCfgEditor service={service} />
          </div>
        )}
        {isMinecraftGame(service) && (
          <div className={tab === "Properties" ? undefined : "hidden"}>
            <ServerPropertiesEditor service={service} />
          </div>
        )}
        {showRustPluginTab(service) && pluginTab && (
          <div className={tab === pluginTab ? undefined : "hidden"}>
            <RustPluginManager service={service} />
          </div>
        )}
        {showMcPluginTab(service) && pluginTab && (
          <div className={tab === pluginTab ? undefined : "hidden"}>
            <PluginManager service={service} />
          </div>
        )}
        <div className={tab === "Schedule" ? undefined : "hidden"}>
          <ScheduleTab serviceId={service.id} />
        </div>
        <div className={tab === "Backups" ? undefined : "hidden"}>
          <BackupsTab serviceId={service.id} />
        </div>
        <div className={tab === "Startup" ? undefined : "hidden"}>
          <StartupTab service={service} onChanged={setService} />
        </div>
        <div className={tab === "Logs" ? undefined : "hidden"}>
          <LogsFeed serviceId={service.id} />
        </div>
        <div className={tab === "Settings" ? undefined : "hidden"}>
          <SettingsTab
            service={service}
            onChanged={setService}
            onSwitched={() => void refetch()}
            showDomains={!isMinecraftGame(service) && !isRustGame(service)}
          />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard"
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted transition-all duration-200 hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Back to servers
    </Link>
  );
}

function TabBar({
  tabs,
  tab,
  onChange,
}: {
  tabs: string[];
  tab: string;
  onChange: (t: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={cn(
            "relative px-4 py-2.5 text-sm transition-all duration-200",
            tab === t ? "text-foreground" : "text-muted hover:text-foreground",
          )}
        >
          {t}
          {tab === t && (
            <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-vivox-500" />
          )}
        </button>
      ))}
    </div>
  );
}

function OverviewTab({ service }: { service: Service }) {
  const portItems = portsForDisplay(service.config);

  return (
    <div className="flex flex-col gap-4">
      <HealthIndicator serviceId={service.id} />
      <NodeOfflineBanner nodeId={service.node_id ?? null} />
      <MetricsChart
        serviceId={service.id}
        memoryLimitMb={service.resource_limits.memory_mb}
        diskLimitGb={service.resource_limits.disk_gb}
        initialStatus={service.status}
      />
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-3">
        <Fact label="Memory limit" value={formatMemoryLimit(service.resource_limits.memory_mb)} />
        <Fact label="CPU limit" value={formatCpuLimit(service.resource_limits.cpu_shares)} />
        <Fact
          label="Storage limit"
          value={formatStorageLimit(service.resource_limits.disk_gb)}
        />
      </div>
      {portItems.length > 0 && <PortsOverview ports={portItems} />}
    </div>
  );
}

function NodeOfflineBanner({ nodeId }: { nodeId: string | null }) {
  const [online, setOnline] = useState(true);

  useTopic<{ status?: string }>(
    nodeId ? `node:${nodeId}:status` : null,
    (payload) => {
      if (payload?.status) {
        setOnline(payload.status === "online");
      }
    },
  );

  if (!nodeId || online) return null;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      The node agent is offline — metrics and controls may not work until it reconnects.
    </div>
  );
}

function PortsOverview({ ports }: { ports: ReturnType<typeof portsForDisplay> }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-medium text-foreground">Ports</h3>
      <PortDisplayList ports={ports} className="mt-3" />
    </div>
  );
}

function DomainsSection({ service }: { service: Service }) {
  const { data: domains, refetch } = useApi(
    () => servicesApi.listDomains(service.id),
    [service.id],
  );
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addDomain = async () => {
    if (!input.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await servicesApi.addDomain(service.id, input.trim());
      setInput("");
      void refetch();
      toast("Domain added", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setAdding(false);
    }
  };

  const removeDomain = async (domainId: string) => {
    try {
      await servicesApi.removeDomain(service.id, domainId);
      void refetch();
      toast("Domain removed", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Globe className="size-4 text-muted" /> Custom Domains
      </h3>
      <AnimatePresence>
        {(domains ?? []).map((d: ServiceDomain) => (
          <motion.div
            key={d.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 flex items-center gap-3 rounded-lg border border-border px-3 py-2"
          >
            <DomainStatusDot status={d.status} />
            <span className="flex-1 font-mono text-sm text-foreground">{d.domain}</span>
            {d.status === "active" && (
              <a
                href={`https://${d.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-vivox-400 hover:underline"
              >
                Open ↗
              </a>
            )}
            {d.status === "error" && (
              <span className="text-xs text-red-400" title={d.error ?? ""}>
                Error
              </span>
            )}
            <button
              type="button"
              onClick={() => void removeDomain(d.id)}
              className="text-subtle hover:text-red-400"
              aria-label={`Remove ${d.domain}`}
            >
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void addDomain()}
          placeholder="game.example.com"
          className="h-9 flex-1 rounded-lg border border-border bg-background/50 px-3 font-mono text-sm text-foreground outline-none focus:border-vivox-500/50"
        />
        <Button size="sm" onClick={() => void addDomain()} loading={adding} disabled={!input.trim()}>
          Add
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      <p className="mt-2 text-xs text-subtle">
        Point your domain&apos;s A record to your node&apos;s IP, then add it here. SSL is handled automatically.
      </p>
    </div>
  );
}

function DomainStatusDot({ status }: { status: ServiceDomain["status"] }) {
  const colors = {
    pending: "bg-amber-500 animate-pulse",
    active: "bg-emerald-500",
    error: "bg-red-500",
  };
  return <span className={cn("size-2 shrink-0 rounded-full", colors[status])} />;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 truncate font-mono text-sm text-foreground">{value}</p>
    </div>
  );
}

function SettingsTab({
  service,
  onChanged,
  onSwitched,
  showDomains = true,
}: {
  service: Service;
  onChanged: (s: Service) => void;
  onSwitched?: () => void;
  showDomains?: boolean;
}) {
  const [reinstalling, setReinstalling] = useState(false);
  const locked = isTransient(service.status);

  const reinstall = async () => {
    if (!confirm("Reinstall wipes server files and reruns the install script. Continue?")) return;
    setReinstalling(true);
    try {
      await servicesApi.reinstall(service.id);
      onChanged({ ...service, status: "PROVISIONING" });
      toast("Reinstall queued — watch the console for install output", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Reinstall failed", "error");
    } finally {
      setReinstalling(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {showDomains && <DomainsSection service={service} />}
      {isMinecraftGame(service) && onSwitched && (
        <MinecraftFrameworkPicker service={service} onSwitched={onSwitched} />
      )}

      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-medium text-foreground">Reinstall</h3>
        <p className="mt-2 text-xs text-muted">
          Wipe server files and rerun the install script. World data and configs will be lost unless
          you have backups.
        </p>
        <Button
          className="mt-3"
          variant="outline"
          size="sm"
          disabled={locked || reinstalling}
          loading={reinstalling}
          onClick={() => void reinstall()}
        >
          <Download className="size-3.5" /> Reinstall server
        </Button>
      </div>
    </div>
  );
}