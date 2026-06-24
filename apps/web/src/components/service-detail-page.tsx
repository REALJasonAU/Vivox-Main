"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { ArrowLeft, Save, Globe, X, Download } from "lucide-react";
import { servicesApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useTopic } from "@/hooks/useWebSocket";
import type { Service, ServiceDomain, StatusPayload } from "@/lib/types";
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
import { AlertsSection } from "@/components/alerts-section";
import { MinecraftSwitcher } from "@/components/minecraft-switcher";
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
  absoluteToFileRel,
  buildServicePath,
  fileRelToAbsolute,
  parseServiceRoute,
} from "@/lib/service-routes";

const inputClass =
  "rounded-lg border border-border bg-background/50 px-3 font-mono text-sm text-foreground outline-none transition-all duration-200 focus:border-border-focus focus:ring-1 focus:ring-border-focus";

export function ServiceDetailPage({
  serviceId,
  segments,
}: {
  serviceId: string;
  segments?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
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

  const route = useMemo(() => parseServiceRoute(segments, tabs), [segments, tabs]);
  const tab = route.tab;
  const pluginTab = service ? pluginTabLabel(service) : null;

  const fileDirRel = useMemo(() => {
    if (tab !== "Files" || !route.fileRelPath) return undefined;
    if (route.selectedFileRel) {
      const parts = route.selectedFileRel.split("/");
      parts.pop();
      return parts.join("/");
    }
    return route.fileRelPath;
  }, [tab, route.fileRelPath, route.selectedFileRel]);

  const selectedFileAbs = route.selectedFileRel
    ? fileRelToAbsolute(route.selectedFileRel)
    : undefined;

  const tabIndex = tabs.indexOf(tab);
  const directionRef = useRef(1);
  const direction = directionRef.current;

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

  const navigateTab = (nextTab: string) => {
    const next = tabs.indexOf(nextTab);
    directionRef.current = next >= tabIndex ? 1 : -1;
    router.push(buildServicePath(serviceId, nextTab));
  };

  const navigateFiles = useCallback(
    (absPath: string) => {
      const rel = absoluteToFileRel(absPath);
      const isFile = rel.split("/").pop()?.includes(".") ?? false;
      const nextPath = buildServicePath(serviceId, "Files", {
        selectedFileRel: isFile ? rel : undefined,
        fileDirRel: isFile ? rel.split("/").slice(0, -1).join("/") : rel,
      });
      if (pathname !== nextPath) {
        router.push(nextPath);
      }
    },
    [serviceId, router, pathname],
  );

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
        <ErrorBanner message={`Could not load service (${error}).`} />
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

      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={tab}
          custom={direction}
          initial={{ opacity: 0, x: direction * 14 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction * -10 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
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
          {tab === "Overview" && <OverviewTab service={service} refetch={refetch} />}
          {tab === "Schedule" && <ScheduleTab serviceId={service.id} />}
          {tab === "Backups" && <BackupsTab serviceId={service.id} />}
          {tab === "Startup" && <StartupTab service={service} onChanged={setService} />}
          {tab === "Logs" && <LogsFeed serviceId={service.id} />}
          {tab === "Settings" && (
            <SettingsTab
              service={service}
              onChanged={setService}
              showDomains={!isMinecraftGame(service) && !isRustGame(service)}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard"
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted transition-all duration-200 hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Back to services
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

function OverviewTab({ service, refetch }: { service: Service; refetch: () => void }) {
  const portItems = portsForDisplay(service.config);

  return (
    <div className="flex flex-col gap-4">
      <HealthIndicator serviceId={service.id} />
      <MetricsChart serviceId={service.id} memoryLimitMb={service.resource_limits.memory_mb} />
      <AlertsSection service={service} />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-2">
        <Fact label="Memory limit" value={`${service.resource_limits.memory_mb} MB`} />
        <Fact label="CPU shares" value={String(service.resource_limits.cpu_shares)} />
      </div>
      {portItems.length > 0 && <PortsOverview ports={portItems} />}
      {service.type === "game" && isMinecraftGame(service) && (
        <MinecraftSwitcher service={service} onSwitched={refetch} />
      )}
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
  showDomains = true,
}: {
  service: Service;
  onChanged: (s: Service) => void;
  showDomains?: boolean;
}) {
  const [editingImage, setEditingImage] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [reinstalling, setReinstalling] = useState(false);
  const [imageInput, setImageInput] = useState(service.config.image ?? "");
  const [cmdInput, setCmdInput] = useState(service.config.startup_cmd ?? "");
  const locked = isTransient(service.status);

  useEffect(() => {
    setImageInput(service.config.image ?? "");
    setCmdInput(service.config.startup_cmd ?? "");
  }, [service.config.image, service.config.startup_cmd]);

  const saveConfig = async () => {
    if (!imageInput.trim()) return;
    setSavingConfig(true);
    try {
      const updated = await servicesApi.updateConfig(service.id, {
        image: imageInput.trim(),
        startup_cmd: cmdInput.trim(),
      });
      onChanged(updated);
      toast("Image & startup saved", "success");
      setEditingImage(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save config", "error");
    } finally {
      setSavingConfig(false);
    }
  };

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
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-foreground">Image & startup</h3>
          {!editingImage && (
            <Button variant="ghost" size="sm" onClick={() => setEditingImage(true)} disabled={locked}>
              Edit
            </Button>
          )}
        </div>
        {editingImage ? (
          <>
            <div className="mt-3 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-wider text-muted">Docker image</span>
                <input
                  value={imageInput}
                  onChange={(e) => setImageInput(e.target.value)}
                  className={cn(inputClass, "h-10 w-full font-mono")}
                  placeholder="nginx:latest"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-wider text-muted">
                  Startup command <span className="text-subtle">(optional)</span>
                </span>
                <input
                  value={cmdInput}
                  onChange={(e) => setCmdInput(e.target.value)}
                  className={cn(inputClass, "h-10 w-full font-mono")}
                  placeholder="./server.sh"
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted">Changes apply on next restart.</p>
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                actionType="save"
                onClick={() => void saveConfig()}
                loading={savingConfig}
                disabled={!imageInput.trim()}
              >
                <Save className="size-3.5" /> Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditingImage(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 font-mono text-sm sm:grid-cols-2">
            <LimitField label="Docker image" value={service.config.image || "—"} />
            <LimitField label="Startup cmd" value={service.config.startup_cmd || "default"} />
          </div>
        )}
      </div>

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

function LimitField({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-base text-foreground">{value}</p>
    </div>
  );
}
