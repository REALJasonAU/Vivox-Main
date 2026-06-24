"use client";



import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import Link from "next/link";

import { useRouter } from "next/navigation";

import { ArrowLeft, Trash2, Save, Gamepad2, Globe, ArrowRightLeft, X } from "lucide-react";

import { servicesApi } from "@/lib/api";

import { useApi } from "@/hooks/useApi";

import { useTopic } from "@/hooks/useWebSocket";

import type { Deployment, Service, ServiceDomain, StatusPayload } from "@/lib/types";

import { STATUS_META, isTransient } from "@/lib/status";
import { displayPortsFromConfig, parsePortBinding } from "@/lib/ports";

import { Console } from "@/components/Console";

import { ExecTerminal } from "@/components/ExecTerminal";

import { EnvTab } from "@/components/env-tab";

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
import { BackupsTab } from "@/components/backups-tab";

import { ServiceControls } from "@/components/service-controls";
import { useCommandPalette } from "@/components/command-palette-provider";

import { StatusBadge } from "@/components/status-badge";

import { Button } from "@/components/ui/button";

import { ErrorBanner, Skeleton } from "@/components/ui/states";

import { cn, formatRelativeTime } from "@/lib/utils";
import { toast } from "@/hooks/useToast";



const BASE_TABS = [
  "Overview",
  "Console",
  "Terminal",
  "Logs",
] as const;

const TAIL_TABS = [
  "Env",
  "Schedule",
  "Deployments",
  "Backups",
  "Files",
  "Settings",
] as const;

function isRustFramework(fw: string): boolean {
  const fwLower = fw.toLowerCase();
  return ["oxide", "carbon", "carbon-minimal", "vanilla"].includes(fwLower);
}

function isMinecraftFramework(fw: string): boolean {
  return !!fw && !isRustFramework(fw);
}

function showRustPluginTab(service: Service): boolean {
  const fw = service.config?.environment?.FRAMEWORK ?? "";
  return service.type === "game" && isRustFramework(fw) && fw.toLowerCase() !== "vanilla";
}

function showMcPluginTab(service: Service): boolean {
  const fw = service.config?.environment?.FRAMEWORK ?? "";
  return service.type === "game" && isMinecraftFramework(fw) && fw !== "Vanilla";
}

function showRustConfigTab(service: Service): boolean {
  const fw = service.config?.environment?.FRAMEWORK ?? "";
  return service.type === "game" && isRustFramework(fw) && fw.toLowerCase() !== "vanilla";
}

function buildServiceTabs(service: Service): string[] {
  const fw = service.config?.environment?.FRAMEWORK ?? "";
  const showPluginTab = showRustPluginTab(service) || showMcPluginTab(service);
  const pluginTabLabel = isRustFramework(fw)
    ? "Plugins"
    : ["Fabric", "Forge", "NeoForge", "Quilt"].includes(fw)
      ? "Mods"
      : "Plugins";
  return [
    ...BASE_TABS,
    ...(showPluginTab ? [pluginTabLabel] : []),
    ...(showRustConfigTab(service) ? ["Config"] : []),
    ...TAIL_TABS,
  ];
}

function pluginTabLabelFor(service: Service): string | null {
  const fw = service.config?.environment?.FRAMEWORK ?? "";
  if (!showRustPluginTab(service) && !showMcPluginTab(service)) return null;
  return isRustFramework(fw)
    ? "Plugins"
    : ["Fabric", "Forge", "NeoForge", "Quilt"].includes(fw)
      ? "Mods"
      : "Plugins";
}



const inputClass =

  "rounded-lg border border-border bg-background/50 px-3 font-mono text-sm text-foreground outline-none transition-all duration-200 focus:border-border-focus focus:ring-1 focus:ring-border-focus";



export default function ServiceDetailPage({

  params,

}: {

  params: Promise<{ id: string }>;

}) {

  const { id } = use(params);
  const { setContextServiceId } = useCommandPalette();
  const { data, loading, error, refetch } = useApi<Service>(() => servicesApi.get(id), [id]);

  const [service, setService] = useState<Service | null>(null);

  const [tab, setTab] = useState("Overview");
  const tabs = useMemo(
    () => (service ? buildServiceTabs(service) : [...BASE_TABS, ...TAIL_TABS]),
    [service],
  );
  const pluginTab = service ? pluginTabLabelFor(service) : null;
  const tabIndex = tabs.indexOf(tab);
  const prevTabRef = useRef(tabIndex);
  const directionRef = useRef(1);
  const direction = directionRef.current;



  useEffect(() => {

    if (data) setService(data);

  }, [data]);



  useEffect(() => {

    setContextServiceId(id);

    return () => setContextServiceId(null);

  }, [id, setContextServiceId]);



  useTopic<StatusPayload>(`service:${id}:status`, (payload) => {

    if (payload?.status) {

      setService((prev) => (prev ? { ...prev, status: payload.status } : prev));

    }

  });



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

        <div className="flex items-center gap-4">

          <div>

            <div className="flex items-center gap-3">

              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{service.name}</h1>

              <StatusBadge status={service.status} />

            </div>

            <p className="mt-1 text-sm text-muted">

              {STATUS_META[service.status].description}

            </p>

          </div>

        </div>

        <ServiceControls service={service} onChanged={setService} />

      </div>



      <TabBar
        tabs={tabs}
        tab={tab}
        onChange={(t) => {
          const next = tabs.indexOf(t);
          directionRef.current = next >= tabIndex ? 1 : -1;
          prevTabRef.current = tabIndex;
          setTab(t);
        }}
      />

      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={tab}
          custom={direction}
          initial={{ opacity: 0, x: direction * 14 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction * -10 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          {tab === "Overview" && <OverviewTab service={service} refetch={refetch} />}
          {tab === "Console" && <Console serviceId={service.id} />}
          {tab === "Terminal" && <ExecTerminal serviceId={service.id} />}
          {tab === "Logs" && <LogsFeed serviceId={service.id} />}
          {pluginTab && tab === pluginTab && showRustPluginTab(service) && (
            <RustPluginManager service={service} />
          )}
          {pluginTab && tab === pluginTab && showMcPluginTab(service) && (
            <PluginManager service={service} />
          )}
          {tab === "Config" && showRustConfigTab(service) && (
            <ServerCfgEditor service={service} />
          )}
          {tab === "Env" && <EnvTab service={service} onChanged={setService} />}
          {tab === "Schedule" && <ScheduleTab serviceId={service.id} />}
          {tab === "Deployments" && <DeploymentsTab serviceId={service.id} />}
          {tab === "Backups" && <BackupsTab serviceId={service.id} />}
          {tab === "Files" && <FileManager serviceId={service.id} />}
          {tab === "Settings" && <SettingsTab service={service} onChanged={setService} />}
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
  const portLines = displayPortsFromConfig(service.config);

  return (

    <div className="flex flex-col gap-4">

      <HealthIndicator serviceId={service.id} />

      <MetricsChart serviceId={service.id} />

      <AlertsSection service={service} />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-4">

        <Fact label="Type" value={service.type} />

        <Fact label="Region / Node" value={service.node_id ?? "unassigned"} />

        <Fact label="Memory" value={`${service.resource_limits.memory_mb} MB`} />

        <Fact label="CPU shares" value={String(service.resource_limits.cpu_shares)} />

        {service.config.image && <Fact label="Image" value={service.config.image} />}

        {portLines.length > 0 && <Fact label="Ports" value={portLines.join(", ")} />}

      </div>

      {portLines.length > 0 && <PortCards ports={portLines} status={service.status} />}

      {service.type === "game" &&
        service.config?.environment?.FRAMEWORK !== undefined && (
          <MinecraftSwitcher service={service} onSwitched={refetch} />
        )}

      <DomainsSection service={service} />

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
        Point your domain&apos;s A record to your node&apos;s IP, then add it here. SSL is handled
        automatically.
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



function PortCards({ ports, status }: { ports: string[]; status: string }) {
  const isUp = status === "RUNNING";
  const httpPorts = ["80", "443", "3000", "4000", "5000", "8000", "8080", "8443", "8888"];
  const gamePorts = ["25565", "7777", "19132"];

  return (
    <div className="flex flex-wrap gap-2">
      {ports.map((p) => {
        const binding = parsePortBinding(p.split(" (")[0] ?? p);
        const hostPort = String(binding.host);
        const containerPort = String(binding.container);
        const isHttp = httpPorts.includes(hostPort);
        const isGame = gamePorts.includes(hostPort);
        const protocol = (binding.proto ?? "tcp").toUpperCase();
        const aliasMatch = p.match(/ \(([^)]+)\)$/);
        const alias = aliasMatch?.[1];

        return (
          <div
            key={p}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
          >
            {isGame && <Gamepad2 className="size-3.5 text-emerald-400" />}
            {isHttp && <Globe className="size-3.5 text-blue-400" />}
            {!isGame && !isHttp && <ArrowRightLeft className="size-3.5 text-muted" />}
            {binding.hostIp && binding.hostIp !== "0.0.0.0" && (
              <span className="font-mono text-xs text-muted">{binding.hostIp}:</span>
            )}
            <span className="font-mono text-xs text-foreground">{hostPort}</span>
            <span className="text-xs text-subtle">→ {containerPort}</span>
            <span className="text-xs text-subtle">{protocol}</span>
            {alias && <span className="text-xs text-vivox-400">{alias}</span>}
            {isHttp && isUp && (
              <a
                href={`http://${typeof window !== "undefined" ? window.location.hostname : "localhost"}:${hostPort}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 text-xs text-vivox-400 hover:underline"
              >
                Open ↗
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
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

}: {

  service: Service;

  onChanged: (s: Service) => void;

}) {

  const router = useRouter();

  const [deleting, setDeleting] = useState(false);

  const [confirm, setConfirm] = useState(false);

  const [editing, setEditing] = useState(false);

  const [saving, setSaving] = useState(false);

  const [memMB, setMemMB] = useState(service.resource_limits.memory_mb);

  const [cpuShares, setCpuShares] = useState(service.resource_limits.cpu_shares);

  const [diskGB, setDiskGB] = useState(service.resource_limits.disk_gb);
  const [editingImage, setEditingImage] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [imageInput, setImageInput] = useState(service.config.image ?? "");
  const [cmdInput, setCmdInput] = useState(service.config.startup_cmd ?? "");
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const [editingHealth, setEditingHealth] = useState(false);
  const [savingHealth, setSavingHealth] = useState(false);
  const [healthPath, setHealthPath] = useState(service.config.health_check?.path ?? "/health");
  const [healthPort, setHealthPort] = useState(service.config.health_check?.port ?? 8080);
  const [healthInterval, setHealthInterval] = useState(service.config.health_check?.interval ?? 30);
  const [healthTimeout, setHealthTimeout] = useState(service.config.health_check?.timeout ?? 5);
  const [healthEnabled, setHealthEnabled] = useState(Boolean(service.config.health_check?.path));
  const [tags, setTags] = useState<string[]>(service.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const tagsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const locked = isTransient(service.status);

  const canSave = memMB > 0 && cpuShares > 0 && diskGB > 0 && !locked;



  useEffect(() => {

    setMemMB(service.resource_limits.memory_mb);

    setCpuShares(service.resource_limits.cpu_shares);

    setDiskGB(service.resource_limits.disk_gb);
    setImageInput(service.config.image ?? "");
    setCmdInput(service.config.startup_cmd ?? "");
    setHealthPath(service.config.health_check?.path ?? "/health");
    setHealthPort(service.config.health_check?.port ?? 8080);
    setHealthInterval(service.config.health_check?.interval ?? 30);
    setHealthTimeout(service.config.health_check?.timeout ?? 5);
    setHealthEnabled(Boolean(service.config.health_check?.path));
    setTags(service.tags ?? []);
  }, [service.resource_limits, service.config.image, service.config.startup_cmd, service.config.health_check, service.tags]);

  const persistTags = useCallback(
    (next: string[]) => {
      if (tagsSaveTimer.current) clearTimeout(tagsSaveTimer.current);
      tagsSaveTimer.current = setTimeout(async () => {
        try {
          const updated = await servicesApi.updateTags(service.id, next);
          onChanged(updated);
        } catch (e) {
          toast(e instanceof Error ? e.message : "Failed to save tags", "error");
        }
      }, 500);
    },
    [service.id, onChanged],
  );

  const addTag = (raw: string) => {
    const t = raw.toLowerCase().trim().slice(0, 20);
    if (!t || tags.includes(t) || tags.length >= 10) return;
    const next = [...tags, t];
    setTags(next);
    persistTags(next);
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    const next = tags.filter((x) => x !== tag);
    setTags(next);
    persistTags(next);
  };

  const cancelEdit = () => {
    setMemMB(service.resource_limits.memory_mb);
    setCpuShares(service.resource_limits.cpu_shares);
    setDiskGB(service.resource_limits.disk_gb);
    setEditing(false);
  };

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

  const saveHealth = async () => {
    setSavingHealth(true);
    try {
      const updated = await servicesApi.updateConfig(
        service.id,
        healthEnabled
          ? {
              health_check: {
                path: healthPath.trim() || "/health",
                port: healthPort,
                interval: healthInterval,
                timeout: healthTimeout,
              },
            }
          : { clear_health_check: true },
      );
      onChanged(updated);
      toast("Health check saved", "success");
      setEditingHealth(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save health check", "error");
    } finally {
      setSavingHealth(false);
    }
  };

  const saveLimits = async () => {

    if (!canSave) return;

    setSaving(true);

    try {

      const updated = await servicesApi.updateLimits(service.id, {

        memory_mb: memMB,

        cpu_shares: cpuShares,

        disk_gb: diskGB,

      });

      onChanged(updated);

      toast("Resource limits saved", "success");

      setEditing(false);

    } catch (e) {

      toast(e instanceof Error ? e.message : "Failed to save limits", "error");

    } finally {

      setSaving(false);

    }

  };



  const remove = async () => {
    setDeleting(true);
    try {
      await servicesApi.remove(service.id);
      setDeleteSuccess(true);
      await new Promise((r) => setTimeout(r, 400));
      router.push("/dashboard");
    } catch {
      setDeleting(false);
    }
  };

  return (
    <motion.div
      animate={deleteSuccess ? { opacity: 0, scale: 0.96, y: 8 } : {}}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-4"
    >

      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-medium text-foreground">Tags</h3>
        <p className="mt-1 text-xs text-muted">Organize services on the dashboard. Up to 10 tags.</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full border border-border-focus bg-surface-raised px-2.5 py-0.5 text-xs text-foreground"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="text-muted hover:text-foreground"
                aria-label={`Remove tag ${tag}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {tags.length < 10 && (
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
              placeholder="Add tag…"
              className={cn(inputClass, "h-8 w-28 px-2 text-xs")}
            />
          )}
        </div>
      </div>

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
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-foreground">Health check</h3>
          {!editingHealth && (
            <Button variant="ghost" size="sm" onClick={() => setEditingHealth(true)} disabled={locked}>
              Edit
            </Button>
          )}
        </div>
        {editingHealth ? (
          <>
            <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={healthEnabled}
                onChange={(e) => setHealthEnabled(e.target.checked)}
                className="rounded border-border-focus"
              />
              Enable HTTP health checks
            </label>
            {healthEnabled && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs uppercase tracking-wider text-muted">Path</span>
                  <input
                    value={healthPath}
                    onChange={(e) => setHealthPath(e.target.value)}
                    className={cn(inputClass, "h-10 w-full font-mono")}
                    placeholder="/health"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs uppercase tracking-wider text-muted">Port</span>
                  <input
                    type="number"
                    value={healthPort}
                    onChange={(e) => setHealthPort(Number(e.target.value))}
                    className={cn(inputClass, "h-10 w-full font-mono")}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs uppercase tracking-wider text-muted">Interval</span>
                  <select
                    value={healthInterval}
                    onChange={(e) => setHealthInterval(Number(e.target.value))}
                    className={cn(inputClass, "h-10 w-full")}
                  >
                    <option value={30}>30 seconds</option>
                    <option value={60}>60 seconds</option>
                    <option value={120}>120 seconds</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs uppercase tracking-wider text-muted">Timeout</span>
                  <select
                    value={healthTimeout}
                    onChange={(e) => setHealthTimeout(Number(e.target.value))}
                    className={cn(inputClass, "h-10 w-full")}
                  >
                    <option value={5}>5 seconds</option>
                    <option value={10}>10 seconds</option>
                    <option value={30}>30 seconds</option>
                  </select>
                </label>
              </div>
            )}
            <p className="mt-2 text-xs text-muted">Agent polls the container IP on restart.</p>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" actionType="save" onClick={() => void saveHealth()} loading={savingHealth}>
                <Save className="size-3.5" /> Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditingHealth(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-3 font-mono text-sm text-muted">
            {service.config.health_check ? (
              <span>
                {service.config.health_check.path} on port {service.config.health_check.port} every{" "}
                {service.config.health_check.interval ?? 30}s
              </span>
            ) : (
              "Not configured"
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">

        <div className="flex items-center justify-between gap-3">

          <h3 className="text-sm font-medium text-foreground">Resource limits</h3>

          {!editing && (

            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} disabled={locked}>

              Edit limits

            </Button>

          )}

        </div>

        {editing ? (

          <>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">

              <LimitInput label="Memory (MB)" value={memMB} onChange={setMemMB} />

              <LimitInput label="CPU shares" value={cpuShares} onChange={setCpuShares} />

              <LimitInput label="Disk (GB)" value={diskGB} onChange={setDiskGB} />

            </div>

            <div className="mt-4 flex items-center justify-end gap-2">

              <Button variant="ghost" size="sm" onClick={cancelEdit}>

                Cancel

              </Button>

              <Button size="sm" actionType="save" onClick={saveLimits} loading={saving} disabled={!canSave}>

                <Save className="size-3.5" /> Save

              </Button>

            </div>

          </>

        ) : (

          <div className="mt-3 grid grid-cols-3 gap-3 font-mono text-sm">

            <LimitField label="Memory (MB)" value={service.resource_limits.memory_mb} />

            <LimitField label="CPU shares" value={service.resource_limits.cpu_shares} />

            <LimitField label="Disk (GB)" value={service.resource_limits.disk_gb} />

          </div>

        )}

        <p className="mt-2 text-xs text-muted">

          Limit changes apply on the next restart.

          {locked && " Controls are locked while the service is transitioning."}

        </p>

      </div>



      <motion.div
        animate={
          confirm
            ? {
                boxShadow: [
                  "0 0 0 0 rgba(239,68,68,0)",
                  "0 0 0 6px rgba(239,68,68,0.2)",
                  "0 0 0 0 rgba(239,68,68,0)",
                ],
                borderColor: [
                  "rgba(239,68,68,0.3)",
                  "rgba(239,68,68,0.7)",
                  "rgba(239,68,68,0.3)",
                ],
              }
            : {}
        }
        transition={{ duration: 0.8, repeat: confirm ? Infinity : 0 }}
        className="rounded-xl border border-red-500/30 bg-red-500/5 p-5"
      >
        <h3 className="text-sm font-medium text-red-400">Danger zone</h3>
        <p className="mt-1 text-xs text-muted">
          Deleting a service stops its container and removes all configuration.
        </p>
        <motion.div
          className="mt-3"
          animate={confirm ? { x: [0, -5, 5, -4, 4, -2, 2, 0] } : {}}
          transition={{ duration: 0.4, ease: "easeInOut" }}
        >
          {confirm ? (
            <div className="flex items-center gap-2">
              <Button variant="danger" size="sm" actionType="delete" loading={deleting} onClick={remove}>
                <Trash2 className="size-3.5" /> Confirm delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="danger" size="sm" actionType="delete" onClick={() => setConfirm(true)}>
              <Trash2 className="size-3.5" /> Delete service
            </Button>
          )}
        </motion.div>
      </motion.div>

    </motion.div>

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



function LimitInput({

  label,

  value,

  onChange,

}: {

  label: string;

  value: number;

  onChange: (n: number) => void;

}) {

  return (

    <label className="flex flex-col gap-1.5">

      <span className="text-xs uppercase tracking-wider text-muted">{label}</span>

      <input

        type="number"

        min={1}

        value={value}

        onChange={(e) => onChange(Number(e.target.value))}

        className={cn(inputClass, "h-10 w-full")}

      />

    </label>

  );

}



function DeploymentsTab({ serviceId }: { serviceId: string }) {

  const { data, loading, error } = useApi(

    () => servicesApi.deployments(serviceId),

    [serviceId],

  );

  const deployments = data ?? [];



  if (loading) {

    return <Skeleton className="h-32" />;

  }



  if (error) {

    return <ErrorBanner message={`Could not load deployments (${error}).`} />;

  }



  if (deployments.length === 0) {

    return (

      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">

        No deployments yet — deploy a service to see history

      </div>

    );

  }



  return (

    <div className="rounded-xl border border-border bg-surface p-5">

      <ol className="relative flex flex-col gap-0">

        {deployments.map((deployment, index) => (

          <DeploymentRow

            key={deployment.id}

            deployment={deployment}

            isLast={index === deployments.length - 1}

          />

        ))}

      </ol>

    </div>

  );

}



function DeploymentRow({

  deployment,

  isLast,

}: {

  deployment: Deployment;

  isLast: boolean;

}) {

  const statusStyles: Record<

    Deployment["status"],

    { label: string; className: string }

  > = {

    success: {

      label: "Success",

      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",

    },

    failed: {

      label: "Failed",

      className: "border-red-500/40 bg-red-500/10 text-red-400",

    },

    building: {

      label: "Building",

      className: "border-amber-500/40 bg-amber-500/10 text-amber-400 animate-pulse",

    },

    queued: {

      label: "Queued",

      className: "border-border-focus bg-surface-raised text-muted",

    },

  };

  const status = statusStyles[deployment.status];



  return (

    <li className="relative flex gap-4 pb-6 last:pb-0">

      {!isLast && (

        <span

          className="absolute left-[7px] top-4 h-full w-px bg-surface-raised"

          aria-hidden

        />

      )}

      <span

        className="relative z-10 mt-1 size-3.5 shrink-0 rounded-full border-2 border-border-focus bg-surface"

        aria-hidden

      />

      <div className="min-w-0 flex-1">

        <div className="flex flex-wrap items-center gap-2">

          <span

            className={cn(

              "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize",

              status.className,

            )}

          >

            {status.label}

          </span>

          <span className="text-xs text-muted">

            {formatRelativeTime(deployment.created_at)}

          </span>

          {deployment.commit_sha && (

            <span className="font-mono text-xs text-muted">

              {deployment.commit_sha.slice(0, 7)}

            </span>

          )}

        </div>

      </div>

    </li>

  );

}


