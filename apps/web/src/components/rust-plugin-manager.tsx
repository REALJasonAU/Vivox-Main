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
  AlertTriangle,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { servicesApi } from "@/lib/api";
import type { Service, ServicePlugin, PluginResult } from "@/lib/types";

type RustSource = "all" | "umod" | "codefling";

const SOURCE_META: Record<RustSource, { label: string; activeClass: string }> = {
  all: { label: "All Sources", activeClass: "text-muted border-border" },
  umod: { label: "uMod", activeClass: "text-blue-400 border-blue-500/30 bg-blue-500/8" },
  codefling: { label: "Codefling", activeClass: "text-vivox-400 border-vivox-500/30 bg-vivox-500/8" },
};

const SOURCE_BADGE: Record<string, string> = {
  umod: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  codefling: "text-vivox-400 bg-vivox-500/10 border-vivox-500/20",
  manual: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",
};

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

interface Props {
  service: Service;
}

export function RustPluginManager({ service }: Props) {
  const fw = service.config?.environment?.FRAMEWORK ?? "Oxide";
  const fwLabel = fw.toLowerCase().startsWith("carbon") ? "Carbon" : "Oxide";

  const [query, setQuery] = useState("");
  const [source, setSource] = useState<RustSource>("all");
  const [showInstalled, setShowInstalled] = useState(false);
  const [page, setPage] = useState(0);

  const [searchResults, setSearchResults] = useState<PluginResult[]>([]);
  const [installed, setInstalled] = useState<ServicePlugin[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingInstalled, setLoadingInstalled] = useState(true);
  const [scanning, setScanning] = useState(false);

  const [busyPlugins, setBusy] = useState<Record<string, string>>({});
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    async (q: string, src: RustSource, pg: number) => {
      setSearching(true);
      try {
        const data = await servicesApi.searchPlugins(service.id, {
          q,
          source: src,
          mc_version: "",
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
    [service.id, fw],
  );

  useEffect(() => {
    if (showInstalled) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void doSearch(query, source, page), 400);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, source, page, showInstalled, doSearch]);

  const getInstalled = (r: PluginResult) =>
    installed.find((p) => p.external_id === r.id && p.source === r.source);

  const setBusyFor = (key: string, val: string | null) =>
    setBusy((prev) => {
      const n = { ...prev };
      if (val) n[key] = val;
      else delete n[key];
      return n;
    });

  const getMissingDeps = (plugin: ServicePlugin): string[] => {
    if (!plugin.dependencies?.length) return [];
    const installedNames = new Set(
      installed.map((p) => p.name.toLowerCase().replace(/\s/g, "")),
    );
    return plugin.dependencies.filter(
      (dep) => !installedNames.has(dep.toLowerCase().replace(/\s/g, "")),
    );
  };

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
      toast(`${p.name} updated to v${r.version}`, "success");
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
      toast("Plugin directory scanned", "success");
    } catch {
      toast("Scan failed", "error");
    } finally {
      setScanning(false);
    }
  };

  const filteredInstalled = installed
    .filter((p) => source === "all" || p.source === source)
    .filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()));

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
              placeholder="Search Rust plugins..."
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-subtle focus:border-vivox-500/50 focus:outline-none"
            />
          </div>
          <button
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
            title="Scan for manually installed plugins"
            onClick={() => void handleScan()}
          >
            <SlidersHorizontal className="size-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          {(["all", "umod", "codefling"] as RustSource[]).map((s) => (
            <button
              key={s}
              onClick={() => {
                setSource(s);
                setPage(0);
              }}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                source === s
                  ? SOURCE_META[s].activeClass + " border-current"
                  : "border-border text-subtle hover:text-muted",
              )}
            >
              {SOURCE_META[s].label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-subtle">{fwLabel}</span>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-border bg-background/40 px-2.5 py-1.5">
          <Info className="mt-0.5 size-3 shrink-0 text-muted" />
          <p className="text-[10px] leading-relaxed text-subtle">
            <span className="font-medium text-vivox-400">uMod</span> plugins install with one click.{" "}
            <span className="font-medium text-vivox-400">Codefling</span> plugins require manual download — use the{" "}
            <span className="text-foreground">Visit</span> button, then upload the <code>.cs</code> file via the{" "}
            <span className="text-foreground">Files</span> tab. The panel will detect and track it automatically.
          </p>
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
                <div className="flex justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted" />
                </div>
              ) : filteredInstalled.length === 0 ? (
                <div className="rounded-xl border border-border bg-surface py-10 text-center text-sm text-muted">
                  No plugins installed.
                  <p className="mt-1 text-xs text-subtle">
                    Install from the search below or upload .cs files via Files tab.
                  </p>
                </div>
              ) : (
                filteredInstalled.map((p) => {
                  const missingDeps = getMissingDeps(p);
                  return (
                    <InstalledPluginRow
                      key={p.id}
                      plugin={p}
                      missingDeps={missingDeps}
                      busy={busyPlugins[p.id]}
                      onUninstall={() => void handleUninstall(p)}
                    />
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!showInstalled && (
        <>
          {searching ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted" />
            </div>
          ) : searchResults.length === 0 && query !== "" ? (
            <div className="rounded-xl border border-border bg-surface py-10 text-center text-sm text-muted">
              No results for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {searchResults.map((r) => {
                const inst = getInstalled(r);
                const hasUpdate = !!inst && inst.version_id !== r.version_id;
                return (
                  <RustPluginCard
                    key={`${r.source}-${r.id}`}
                    result={r}
                    installed={inst}
                    hasUpdate={hasUpdate}
                    busy={busyPlugins[inst?.id ?? r.id]}
                    onInstall={() => void handleInstall(r)}
                    onUninstall={inst ? () => void handleUninstall(inst) : undefined}
                    onUpdate={hasUpdate && inst ? () => void handleUpdate(inst, r) : undefined}
                  />
                );
              })}
            </div>
          )}
          {!searching && searchResults.length > 0 && (
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
                disabled={searchResults.length < 10}
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

function RustPluginCard({
  result,
  installed,
  hasUpdate,
  busy,
  onInstall,
  onUninstall,
  onUpdate,
}: {
  result: PluginResult;
  installed?: ServicePlugin;
  hasUpdate: boolean;
  busy?: string;
  onInstall: () => void;
  onUninstall?: () => void;
  onUpdate?: () => void;
}) {
  const canDirectInstall = result.source === "umod" && !!result.download_url;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
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
            <span className="text-sm font-semibold text-foreground">{result.name}</span>
            <span
              className={cn(
                "rounded-full border px-1.5 py-px text-[9px] font-medium",
                SOURCE_BADGE[result.source],
              )}
            >
              {result.source}
            </span>
            {!!installed && (
              <span className="rounded-full border border-vivox-500/30 bg-vivox-500/10 px-1.5 py-px text-[9px] font-medium text-vivox-400">
                installed v{installed.version}
              </span>
            )}
            {hasUpdate && (
              <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-px text-[9px] font-medium text-blue-400">
                update → v{result.version}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{result.description}</p>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-subtle">
            {result.downloads > 0 && <span>{fmtDownloads(result.downloads)} downloads</span>}
            <span>v{result.version}</span>
            {!canDirectInstall && <span className="text-amber-400/80">manual install only</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={result.page_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-border p-1.5 text-muted transition-colors hover:text-foreground"
            title="View on site"
          >
            <ExternalLink className="size-3.5" />
          </a>
          {hasUpdate && onUpdate && (
            <Button
              size="sm"
              variant="secondary"
              actionType="restart"
              loading={busy === "update"}
              disabled={!!busy}
              onClick={onUpdate}
            >
              <RefreshCcw className="size-3.5" />
            </Button>
          )}
          {!!installed ? (
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
              title={canDirectInstall ? `Install ${result.name}` : "Visit page to download"}
            >
              {canDirectInstall ? (
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
    </div>
  );
}

function InstalledPluginRow({
  plugin,
  missingDeps,
  busy,
  onUninstall,
}: {
  plugin: ServicePlugin;
  missingDeps: string[];
  busy?: string;
  onUninstall: () => void;
}) {
  const [showDeps, setShowDeps] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-3 px-3 py-2.5">
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
            {missingDeps.length > 0 && (
              <button
                onClick={() => setShowDeps((v) => !v)}
                className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-medium text-amber-400 transition-colors hover:bg-amber-500/15"
              >
                <AlertTriangle className="size-2.5" />
                {missingDeps.length} missing dep{missingDeps.length > 1 ? "s" : ""}
              </button>
            )}
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
      <AnimatePresence>
        {showDeps && missingDeps.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-3 py-2.5">
              <p className="mb-1.5 text-[10px] font-medium text-amber-400">Missing dependencies</p>
              <div className="flex flex-wrap gap-1.5">
                {missingDeps.map((dep) => (
                  <span
                    key={dep}
                    className="rounded-full border border-amber-500/25 bg-amber-500/8 px-2 py-0.5 text-[10px] text-amber-300"
                  >
                    {dep}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-subtle">
                Search for these plugins and install them to resolve dependency warnings.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
