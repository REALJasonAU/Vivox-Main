"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  Save,
  Search,
  Loader2,
  RefreshCcw,
  Eye,
  EyeOff,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { filesApi, ApiError } from "@/lib/api";
import type { Service } from "@/lib/types";
import {
  parseServerProperties,
  serialiseServerProperties,
  type PropertyEntry,
} from "@/lib/mc-server-properties";

const PROPERTIES_PATH = "/mnt/server/server.properties";

const inputClass =
  "rounded-lg border border-border bg-background/50 px-3 font-mono text-sm text-foreground outline-none transition-all duration-200 focus:border-border-focus focus:ring-1 focus:ring-border-focus";

const BOOL_KEYS = new Set([
  "online-mode",
  "pvp",
  "allow-flight",
  "white-list",
  "enable-command-block",
  "spawn-monsters",
  "spawn-animals",
  "spawn-npcs",
  "snooper-enabled",
  "hardcore",
  "enable-rcon",
  "enforce-whitelist",
  "prevent-proxy-connections",
  "sync-chunk-writes",
  "enable-status",
  "hide-online-players",
]);

interface Props {
  service: Service;
}

export function ServerPropertiesEditor({ service }: Props) {
  const [entries, setEntries] = useState<PropertyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [rawMode, setRawMode] = useState(false);
  const [rawContent, setRawContent] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { content } = await filesApi.read(service.id, PROPERTIES_PATH);
      let decoded: string;
      try {
        decoded = atob(content);
      } catch {
        decoded = content;
      }
      setEntries(parseServerProperties(decoded));
      setRawContent(decoded);
      setDirty(false);
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 503
          ? "Could not load server.properties — start the server or check Files tab"
          : e instanceof Error && e.message.toLowerCase().includes("not running")
            ? "Could not load server.properties — start the server or check Files tab"
            : "Could not load server.properties — start the server or check Files tab";
      toast(msg, "error");
    } finally {
      setLoading(false);
    }
  }, [service.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.key.toLowerCase().includes(q) ||
        e.value.toLowerCase().includes(q) ||
        e.comment?.toLowerCase().includes(q),
    );
  }, [entries, search]);

  const updateValue = (key: string, value: string) => {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, value } : e)));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const content = rawMode ? rawContent : serialiseServerProperties(entries);
      await filesApi.write(service.id, PROPERTIES_PATH, content);
      setRawContent(content);
      if (rawMode) setEntries(parseServerProperties(content));
      setDirty(false);
      toast("server.properties saved — restart to apply", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileText className="size-4 text-vivox-400" />
              Server Properties
            </h2>
            <p className="mt-1 text-xs text-muted">
              Edit <span className="font-mono text-foreground">{PROPERTIES_PATH}</span> — restart
              the server after saving for changes to take effect.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-px text-[10px] text-amber-400">
                unsaved
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                if (rawMode) {
                  setEntries(parseServerProperties(rawContent));
                  setRawMode(false);
                } else {
                  setRawContent(serialiseServerProperties(entries));
                  setRawMode(true);
                }
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                rawMode
                  ? "border-vivox-500/40 bg-vivox-500/15 text-vivox-400"
                  : "border-border bg-background text-muted hover:text-foreground",
              )}
            >
              {rawMode ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              {rawMode ? "Visual" : "Raw"}
            </button>
            <Button size="sm" variant="ghost" onClick={() => void load()} title="Reload">
              <RefreshCcw className="size-3.5" />
            </Button>
            <Button size="sm" actionType="save" onClick={() => void handleSave()} loading={saving}>
              <Save className="size-3.5" /> Save
            </Button>
          </div>
        </div>
      </div>

      {!rawMode && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter properties…"
            className={cn(inputClass, "h-9 w-full pl-9")}
          />
        </div>
      )}

      {rawMode ? (
        <textarea
          value={rawContent}
          onChange={(e) => {
            setRawContent(e.target.value);
            setDirty(true);
          }}
          rows={24}
          spellCheck={false}
          className={cn(inputClass, "min-h-[420px] w-full resize-y font-mono text-xs leading-relaxed")}
        />
      ) : (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No matching properties.</p>
          ) : (
            filtered.map((entry) => (
              <PropertyRow
                key={entry.key}
                entry={entry}
                onChange={(v) => updateValue(entry.key, v)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PropertyRow({
  entry,
  onChange,
}: {
  entry: PropertyEntry;
  onChange: (value: string) => void;
}) {
  const isBool = BOOL_KEYS.has(entry.key) || entry.value === "true" || entry.value === "false";

  return (
    <div className="grid gap-2 rounded-lg border border-border/60 bg-background/30 px-3 py-2.5 sm:grid-cols-[minmax(140px,1fr)_2fr] sm:items-center">
      <div className="min-w-0">
        <p className="font-mono text-xs font-medium text-foreground">{entry.key}</p>
        {entry.comment && <p className="mt-0.5 text-[10px] text-subtle">{entry.comment}</p>}
      </div>
      {isBool ? (
        <button
          type="button"
          onClick={() => onChange(entry.value === "true" ? "false" : "true")}
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors sm:max-w-xs",
            entry.value === "true"
              ? "border-vivox-500/40 bg-vivox-500/15 text-vivox-400"
              : "border-border bg-background text-muted hover:text-foreground",
          )}
        >
          {entry.value === "true" ? (
            <ToggleRight className="size-4" />
          ) : (
            <ToggleLeft className="size-4" />
          )}
          {entry.value === "true" ? "true" : "false"}
        </button>
      ) : (
        <input
          value={entry.value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputClass, "h-9 w-full")}
        />
      )}
    </div>
  );
}
