"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileCode2,
  Save,
  Search,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Eye,
  EyeOff,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { servicesApi } from "@/lib/api";
import type { Service, RustConvar } from "@/lib/types";
import { VANILLA_CONVARS } from "@/lib/rust-vanilla-convars";
import {
  parseCfg,
  serialiseCfg,
  isModified,
  defaultValueStr,
  groupConvarsByCategory,
  prettyCategoryName,
  type CfgEntry,
} from "@/lib/rust-cfg-parser";

interface Props {
  service: Service;
}

export function ServerCfgEditor({ service }: Props) {
  const [cfgPath, setCfgPath] = useState<string>("");
  const [entries, setEntries] = useState<CfgEntry[]>([]);
  const [convars, setConvars] = useState<RustConvar[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const [rawContent, setRawContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["server", "fps", "decay", "env"]),
  );
  const [addingConvar, setAddingConvar] = useState(false);
  const [addQuery, setAddQuery] = useState("");

  const allConvars = useMemo(() => [...VANILLA_CONVARS, ...convars], [convars]);

  const convarMap = useMemo(() => {
    const m: Record<string, RustConvar> = {};
    for (const cv of allConvars) m[cv.Name] = cv;
    return m;
  }, [allConvars]);

  const currentValues = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of entries) {
      if (!e.isComment && !e.isBlank) m[e.key] = e.value;
    }
    return m;
  }, [entries]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, convarsRes] = await Promise.all([
        servicesApi.readServerCfg(service.id),
        servicesApi.getConvars(service.id).catch(() => [] as RustConvar[]),
      ]);
      setCfgPath(cfgRes.path);
      const parsed = parseCfg(cfgRes.content);
      setEntries(parsed);
      setRawContent(cfgRes.content);
      const vanillaNames = new Set(VANILLA_CONVARS.map((v) => v.Name));
      setConvars(
        (convarsRes ?? []).filter(
          (cv) => cv.Serverside && cv.ServerAdmin && !vanillaNames.has(cv.Name),
        ),
      );
      setDirty(false);
    } catch {
      toast("Failed to load server.cfg", "error");
    } finally {
      setLoading(false);
    }
  }, [service.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const switchToRaw = () => {
    setRawContent(serialiseCfg(entries));
    setRawMode(true);
  };

  const switchToVisual = () => {
    setEntries(parseCfg(rawContent));
    setRawMode(false);
  };

  const handleValueChange = (key: string, value: string) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.key === key);
      if (idx === -1) {
        return [
          ...prev,
          { key, value, rawLine: `${key} ${value}`, isComment: false, isBlank: false },
        ];
      }
      return prev.map((e, i) =>
        i === idx ? { ...e, value, rawLine: `${key} ${value}` } : e,
      );
    });
    setDirty(true);
  };

  const handleRemoveKey = (key: string) => {
    setEntries((prev) => prev.filter((e) => e.key !== key));
    setDirty(true);
  };

  const handleAddConvar = (cv: RustConvar) => {
    if (currentValues[cv.Name] !== undefined) {
      toast(`${cv.Name} is already in the config`, "info");
      setAddingConvar(false);
      return;
    }
    const defVal = defaultValueStr(cv) || "";
    setEntries((prev) => [
      ...prev,
      {
        key: cv.Name,
        value: defVal,
        rawLine: `${cv.Name} ${defVal}`,
        isComment: false,
        isBlank: false,
      },
    ]);
    setDirty(true);
    setAddingConvar(false);
    setAddQuery("");
    const cat = cv.Name.split(".")[0];
    setExpandedCategories((prev) => new Set([...prev, cat]));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const content = rawMode ? rawContent : serialiseCfg(entries);
      await servicesApi.writeServerCfg(service.id, cfgPath, content);
      toast("server.cfg saved", "success");
      setDirty(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const grouped = useMemo(() => groupConvarsByCategory(allConvars), [allConvars]);

  const searchLower = search.toLowerCase();
  const activeCategories = useMemo(() => {
    return Object.entries(grouped).filter(([, cvs]) => {
      return cvs.some((cv) => {
        const inCfg = currentValues[cv.Name] !== undefined;
        const matchesSearch =
          !searchLower ||
          cv.Name.toLowerCase().includes(searchLower) ||
          (cv.Help ?? "").toLowerCase().includes(searchLower);
        return inCfg || matchesSearch;
      });
    });
  }, [grouped, currentValues, searchLower]);

  const addableConvars = useMemo(() => {
    const q = addQuery.toLowerCase();
    return allConvars
      .filter(
        (cv) =>
          currentValues[cv.Name] === undefined &&
          (!q ||
            cv.Name.toLowerCase().includes(q) ||
            (cv.Help ?? "").toLowerCase().includes(q)),
      )
      .slice(0, 40);
  }, [allConvars, currentValues, addQuery]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 className="size-4 shrink-0 text-muted" />
          <span className="truncate font-mono text-xs text-muted">{cfgPath}</span>
          {dirty && (
            <span className="ml-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-px text-[10px] text-amber-400">
              unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (rawMode) switchToVisual();
              else switchToRaw();
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
          <Button
            size="sm"
            variant="ghost"
            loading={loading}
            onClick={() => void load()}
            title="Reload from server"
          >
            <RefreshCcw className="size-3.5" />
          </Button>
          <Button size="sm" disabled={!dirty} loading={saving} onClick={() => void handleSave()}>
            <Save className="size-3.5" /> Save
          </Button>
        </div>
      </div>

      {rawMode && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-3 py-2 text-xs text-muted">
            Raw editor — one setting per line:{" "}
            <code className="text-foreground">key value</code>
          </div>
          <textarea
            value={rawContent}
            onChange={(e) => {
              setRawContent(e.target.value);
              setDirty(true);
            }}
            className="h-[500px] w-full resize-none bg-background p-3 font-mono text-xs text-foreground focus:outline-none"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      )}

      {!rawMode && (
        <>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search convars..."
                className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-subtle focus:border-vivox-500/50 focus:outline-none"
              />
            </div>
            <Button size="sm" variant="secondary" onClick={() => setAddingConvar((v) => !v)}>
              <Plus className="size-3.5" /> Add convar
            </Button>
          </div>

          <AnimatePresence>
            {addingConvar && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="rounded-xl border border-border bg-surface p-3">
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
                    <input
                      autoFocus
                      value={addQuery}
                      onChange={(e) => setAddQuery(e.target.value)}
                      placeholder="Search all convars to add..."
                      className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-subtle focus:border-vivox-500/50 focus:outline-none"
                    />
                  </div>
                  <div className="flex max-h-64 flex-col gap-px overflow-y-auto">
                    {addableConvars.length === 0 && (
                      <p className="py-4 text-center text-xs text-muted">No matching convars</p>
                    )}
                    {addableConvars.map((cv) => (
                      <button
                        key={cv.Name}
                        onClick={() => handleAddConvar(cv)}
                        className="flex items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-background"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-xs font-medium text-foreground">{cv.Name}</p>
                          {cv.Help && (
                            <p className="mt-0.5 line-clamp-1 text-[10px] text-muted">{cv.Help}</p>
                          )}
                        </div>
                        <span className="shrink-0 rounded border border-border px-1.5 py-px text-[9px] text-subtle">
                          {defaultValueStr(cv) || "—"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {activeCategories.length === 0 && search && (
            <div className="py-10 text-center text-sm text-muted">
              No convars match &ldquo;{search}&rdquo;.
            </div>
          )}
          {activeCategories.map(([category, cvs]) => {
            const isExpanded = expandedCategories.has(category);
            const inCfgCount = cvs.filter((cv) => currentValues[cv.Name] !== undefined).length;
            const modifiedCount = cvs.filter((cv) => {
              const v = currentValues[cv.Name];
              return v !== undefined && isModified(v, cv);
            }).length;

            const displayCvs = cvs.filter((cv) => {
              const inCfg = currentValues[cv.Name] !== undefined;
              const matches =
                !searchLower ||
                cv.Name.toLowerCase().includes(searchLower) ||
                (cv.Help ?? "").toLowerCase().includes(searchLower);
              return inCfg || (searchLower && matches);
            });

            if (displayCvs.length === 0) return null;

            return (
              <div key={category} className="overflow-hidden rounded-xl border border-border bg-surface">
                <button
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-background/50"
                  onClick={() =>
                    setExpandedCategories((prev) => {
                      const next = new Set(prev);
                      if (next.has(category)) next.delete(category);
                      else next.add(category);
                      return next;
                    })
                  }
                >
                  {isExpanded ? (
                    <ChevronDown className="size-4 shrink-0 text-muted" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted" />
                  )}
                  <span className="text-sm font-medium text-foreground">
                    {prettyCategoryName(category)}
                  </span>
                  <span className="text-[10px] text-subtle">
                    {inCfgCount} / {cvs.length} set
                  </span>
                  {modifiedCount > 0 && (
                    <span className="rounded-full border border-amber-500/25 bg-amber-500/8 px-1.5 py-px text-[9px] text-amber-400">
                      {modifiedCount} modified
                    </span>
                  )}
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-border">
                        {displayCvs.map((cv) => (
                          <ConvarRow
                            key={cv.Name}
                            convar={cv}
                            value={currentValues[cv.Name]}
                            onValueChange={(v) => handleValueChange(cv.Name, v)}
                            onRemove={() => handleRemoveKey(cv.Name)}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {(() => {
            const unknown = entries.filter(
              (e) => !e.isComment && !e.isBlank && !convarMap[e.key],
            );
            if (unknown.length === 0) return null;
            return (
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <AlertCircle className="size-4 text-amber-400" />
                  <span className="text-sm font-medium text-foreground">Unknown / Custom</span>
                  <span className="text-[10px] text-subtle">
                    {unknown.length} entries not in convar list
                  </span>
                </div>
                {unknown.map((e) => (
                  <div
                    key={e.key}
                    className="flex items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0"
                  >
                    <span className="flex-1 font-mono text-xs text-foreground">{e.key}</span>
                    <input
                      value={e.value}
                      onChange={(ev) => handleValueChange(e.key, ev.target.value)}
                      className="w-48 rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:border-vivox-500/50 focus:outline-none"
                    />
                    <button
                      onClick={() => handleRemoveKey(e.key)}
                      className="text-muted transition-colors hover:text-red-400"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

function ConvarRow({
  convar,
  value,
  onValueChange,
  onRemove,
}: {
  convar: RustConvar;
  value: string | undefined;
  onValueChange: (v: string) => void;
  onRemove: () => void;
}) {
  const isSet = value !== undefined;
  const modified = isSet && isModified(value, convar);
  const defVal = defaultValueStr(convar);
  const isBool = convar.Type === "bool";
  const isNumeric =
    convar.Type === "int" ||
    convar.Type === "float" ||
    convar.Type === "System.Int64";

  return (
    <div
      className={cn(
        "flex items-start gap-3 border-t border-border/60 px-4 py-2.5 first:border-t-0 transition-colors",
        modified ? "bg-amber-500/3" : "",
        !isSet ? "opacity-50" : "",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "font-mono text-xs font-medium",
              modified ? "text-amber-300" : "text-foreground",
            )}
          >
            {convar.Name}
          </span>
          {modified && (
            <span className="text-[9px] text-amber-400/70">default: {defVal}</span>
          )}
        </div>
        {convar.Help && (
          <p className="mt-0.5 text-[10px] leading-relaxed text-subtle">{convar.Help}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!isSet ? (
          <button
            onClick={() => onValueChange(defVal)}
            className="rounded border border-dashed border-border px-2 py-1 text-[10px] text-subtle transition-colors hover:border-border/80 hover:text-foreground"
          >
            + add
          </button>
        ) : isBool ? (
          <button
            onClick={() =>
              onValueChange(value === "true" || value === "1" ? "false" : "true")
            }
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors",
              value === "true" || value === "1"
                ? "border-vivox-500/40 bg-vivox-500/15 text-vivox-400"
                : "border-border bg-background text-muted",
            )}
          >
            {value === "true" || value === "1" ? (
              <ToggleRight className="size-4" />
            ) : (
              <ToggleLeft className="size-4" />
            )}
            {value === "true" || value === "1" ? "true" : "false"}
          </button>
        ) : isNumeric ? (
          <input
            type="number"
            value={value}
            step={convar.Type === "float" ? "0.1" : "1"}
            onChange={(e) => onValueChange(e.target.value)}
            className="w-28 rounded border border-border bg-background px-2 py-1 text-right font-mono text-xs text-foreground focus:border-vivox-500/50 focus:outline-none"
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            className="w-48 rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:border-vivox-500/50 focus:outline-none"
          />
        )}

        {isSet && (
          <button
            onClick={onRemove}
            title="Remove from cfg"
            className="text-muted transition-colors hover:text-red-400"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
