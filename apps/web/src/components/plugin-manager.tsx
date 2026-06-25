"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Package,
  Download,
  Trash2,
  RefreshCcw,
  ExternalLink,
  CheckCircle2,
  Loader2,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { servicesApi } from "@/lib/api";
import type { Service, ServicePlugin, PluginResult } from "@/lib/types";

type Source = "all" | "modrinth" | "spigot" | "curseforge";

const SOURCE_META: Record<Source, { label: string; color: string }> = {
  all: { label: "All Sources", color: "text-muted border-border" },
  modrinth: { label: "Modrinth", color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/8" },
  spigot: { label: "SpigotMC", color: "text-amber-400 border-amber-500/30 bg-amber-500/8" },
  curseforge: { label: "CurseForge", color: "text-orange-400 border-orange-500/30 bg-orange-500/8" },
};

const SOURCE_BADGE: Record<string, string> = {
  modrinth: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  spigot: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  curseforge: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  manual: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",
};

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

interface Props {
  service: Service;
}

export function PluginManager({ service }: Props) {
  const fw = service.config?.environment?.FRAMEWORK ?? "Paper";
  const mcVer = service.config?.environment?.MC_VERSION ?? "1.21.4";
  const isModFramework = ["Fabric", "Forge", "NeoForge", "Quilt"].includes(fw);
  const label = isModFramework ? "Mods" : "Plugins";

  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Source>("all");
  const [showInstalled, setShowInstalled] = useState(false);
  const [page, setPage] = useState(0);

  const [searchResults, setSearchResults] = useState<PluginResult[]>([]);
  const [installed, setInstalled] = useState<ServicePlugin[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingInstalled, setLoadingInstalled] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyPlugins, setBusy] = useState<Record<string, string>>({});

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadInstalled = useCallback(async () => {
    setLoadingInstalled(true);
    try {
      const data = await servicesApi.listPlugins(service.id);
      setInstalled(data ?? []);
    } finally {
      setLoadingInstalled(false);
    }
  }, [service.id]);

  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  const doSearch = useCallback(
    async (q: string, src: Source, pg: number) => {
      setSearching(true);
      try {
        const data = await servicesApi.searchPlugins(service.id, {
          q,
          source: src,
          mc_version: mcVer,
          framework: fw,
          page: pg,
        });
        setSearchResults(data.results ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    [service.id, mcVer, fw],
  );

  useEffect(() => {
    if (showInstalled) return;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => void doSearch(query, source, page), 400);
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, [query, source, page, showInstalled, doSearch]);

  const getInstalled = (result: PluginResult) =>
    installed.find((p) => p.external_id === result.id && p.source === result.source);

  const setBusyFor = (key: string, state: string | null) =>
    setBusy((prev) => {
      const n = { ...prev };
      if (state) n[key] = state;
      else delete n[key];
      return n;
    });

  const handleInstall = async (r: PluginResult) => {
    if (!r.download_url) {
      window.open(r.page_url, "_blank");
      return;
    }
    setBusyFor(r.id, "install");
    try {
      await servicesApi.installPlugin(service.id, {
        source: r.source,
        external_id: r.id,
        name: r.name,
        version: r.version,
        version_id: r.version_id,
        download_url: r.download_url,
        jar_filename: r.jar_filename,
        auto_update: true,
      });
      toast(`${r.name} installed`, "success");
      void loadInstalled();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Install failed", "error");
    } finally {
      setBusyFor(r.id, null);
    }
  };

  const handleUninstall = async (p: ServicePlugin) => {
    setBusyFor(p.id, "uninstall");
    try {
      await servicesApi.uninstallPlugin(service.id, p.id);
      toast(`${p.name} removed`, "success");
      setInstalled((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Uninstall failed", "error");
    } finally {
      setBusyFor(p.id, null);
    }
  };

  const handleUpdate = async (p: ServicePlugin, r: PluginResult) => {
    if (!r.download_url) {
      window.open(r.page_url, "_blank");
      return;
    }
    setBusyFor(p.id, "update");
    try {
      await servicesApi.updatePlugin(service.id, p.id, {
        source: r.source,
        external_id: r.id,
        name: r.name,
        version: r.version,
        version_id: r.version_id,
        download_url: r.download_url,
        jar_filename: r.jar_filename,
        auto_update: p.auto_update,
      });
      toast(`${p.name} updated to ${r.version}`, "success");
      void loadInstalled();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Update failed", "error");
    } finally {
      setBusyFor(p.id, null);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const data = await servicesApi.scanPlugins(service.id);
      setInstalled(data ?? []);
      toast("Directory scanned — manually installed files detected", "success");
    } catch {
      toast("Scan failed", "error");
    } finally {
      setScanning(false);
    }
  };

  const displayResults = showInstalled ? [] : searchResults;
  const displayInstalled = showInstalled
    ? installed
        .filter(
          (p) => query === "" || p.name.toLowerCase().includes(query.toLowerCase()),
        )
        .filter((p) => source === "all" || p.source === source)
    : installed;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-subtle focus:border-vivox-500/50 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowInstalled((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors",
              showInstalled
                ? "border-vivox-500/40 bg-vivox-500/15 text-vivox-400"
                : "border-border bg-background text-muted hover:text-foreground",
            )}
          >
            <CheckCircle2 className="size-3.5" />
            Installed
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[10px]",
                showInstalled ? "bg-vivox-500/20 text-vivox-300" : "bg-surface text-subtle",
              )}
            >
              {installed.length}
            </span>
          </button>
          <Button
            size="sm"
            variant="ghost"
            loading={scanning}
            title="Scan server directory for manually installed files"
            onClick={() => void handleScan()}
          >
            <SlidersHorizontal className="size-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          {(["all", "modrinth", "spigot", "curseforge"] as Source[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSource(s);
                setPage(0);
              }}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                source === s
                  ? SOURCE_META[s].color + " border-current"
                  : "border-border text-subtle hover:text-muted",
              )}
            >
              {SOURCE_META[s].label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-subtle">
            {mcVer} · {fw}
          </span>
        </div>
      </div>

      <AnimatePresence>
        {showInstalled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2">
              {loadingInstalled ? (
                <div className="flex flex-col gap-2 py-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-14 animate-pulse rounded-xl border border-border bg-surface-raised/60" />
                  ))}
                </div>
              ) : displayInstalled.length === 0 ? (
                <div className="rounded-xl border border-border bg-surface py-10 text-center text-sm text-muted">
                  No {label.toLowerCase()} installed yet.
                  <p className="mt-1 text-xs text-subtle">
                    Use the search below or upload files via the Files tab.
                  </p>
                </div>
              ) : (
                displayInstalled.map((p) => (
                  <InstalledRow
                    key={p.id}
                    plugin={p}
                    busy={busyPlugins[p.id]}
                    onUninstall={() => void handleUninstall(p)}
                  />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!showInstalled && (
        <>
          {searching ? (
            <div className="flex flex-col gap-2 py-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl border border-border bg-surface-raised/50" />
              ))}
            </div>
          ) : displayResults.length === 0 && query !== "" ? (
            <div className="rounded-xl border border-border bg-surface py-10 text-center text-sm text-muted">
              No results found for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {displayResults.map((r) => {
                const inst = getInstalled(r);
                return (
                  <PluginCard
                    key={`${r.source}-${r.id}`}
                    result={r}
                    installed={inst}
                    busy={busyPlugins[inst?.id ?? r.id]}
                    onInstall={() => void handleInstall(r)}
                    onUninstall={inst ? () => void handleUninstall(inst) : undefined}
                    onUpdate={
                      inst && inst.version_id !== r.version_id
                        ? () => void handleUpdate(inst, r)
                        : undefined
                    }
                  />
                );
              })}
            </div>
          )}

          {!searching && displayResults.length > 0 && (
            <div className="flex justify-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronUp className="size-3.5" /> Prev
              </Button>
              <span className="flex items-center px-2 text-xs text-muted">Page {page + 1}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={displayResults.length < 20}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronDown className="size-3.5" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PluginCard({
  result,
  installed,
  busy,
  onInstall,
  onUninstall,
  onUpdate,
}: {
  result: PluginResult;
  installed?: ServicePlugin;
  busy?: string;
  onInstall: () => void;
  onUninstall?: () => void;
  onUpdate?: () => void;
}) {
  const isInstalled = !!installed;
  const hasUpdate = !!onUpdate;

  return (
    <motion.div layout className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-start gap-3 p-3">
        <div className="size-10 shrink-0 overflow-hidden rounded-lg border border-border bg-background">
          {result.icon_url ? (
            <img src={result.icon_url} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Package className="size-5 text-muted" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{result.name}</span>
            <span
              className={cn(
                "rounded-full border px-1.5 py-px text-[9px] font-medium",
                SOURCE_BADGE[result.source],
              )}
            >
              {result.source}
            </span>
            {isInstalled && installed && (
              <span className="rounded-full border border-vivox-500/30 bg-vivox-500/10 px-1.5 py-px text-[9px] font-medium text-vivox-400">
                installed {installed.version}
              </span>
            )}
            {hasUpdate && (
              <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-px text-[9px] font-medium text-blue-400">
                update → {result.version}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{result.description}</p>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-subtle">
            <span>{formatDownloads(result.downloads)} downloads</span>
            <span>v{result.version}</span>
            {!result.download_url && (
              <span className="text-amber-400">manual install only</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={result.page_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-border p-1.5 text-muted transition-colors hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>

          {hasUpdate && (
            <Button
              size="sm"
              variant="secondary"
              actionType="restart"
              loading={busy === "update"}
              disabled={!!busy}
              onClick={onUpdate}
              title={`Update to ${result.version}`}
            >
              <RefreshCcw className="size-3.5" />
            </Button>
          )}

          {isInstalled ? (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === "uninstall"}
              disabled={!!busy}
              className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={onUninstall}
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              loading={busy === "install"}
              disabled={!!busy}
              onClick={onInstall}
              title={
                result.download_url
                  ? `Install ${result.name}`
                  : "Visit page to install manually"
              }
            >
              {result.download_url ? (
                <>
                  <Download className="size-3.5" /> Install
                </>
              ) : (
                <>
                  <ExternalLink className="size-3.5" /> Visit
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function InstalledRow({
  plugin,
  busy,
  onUninstall,
}: {
  plugin: ServicePlugin;
  busy?: string;
  onUninstall: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
        <Package className="size-4 text-muted" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{plugin.name}</span>
          <span
            className={cn(
              "rounded-full border px-1.5 py-px text-[9px] font-medium",
              SOURCE_BADGE[plugin.source],
            )}
          >
            {plugin.source}
          </span>
        </div>
        <p className="text-[10px] text-subtle">
          {plugin.jar_filename} · v{plugin.version}
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        loading={busy === "uninstall"}
        disabled={!!busy}
        className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
        onClick={onUninstall}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
