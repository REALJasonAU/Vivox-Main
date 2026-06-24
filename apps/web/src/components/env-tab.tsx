"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Save, Upload } from "lucide-react";
import { servicesApi, templatesApi } from "@/lib/api";
import { mergeEnvRows, parseEnvFile } from "@/lib/env-parse";
import { toast } from "@/hooks/useToast";
import type { ApiConfigurableField, Service } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const inputClass =
  "rounded-lg border border-border bg-background/50 px-3 font-mono text-sm text-foreground outline-none transition-all duration-200 focus:border-border-focus focus:ring-1 focus:ring-border-focus";

const HIDDEN_KEYS = new Set(["EULA", "eula"]);

function fieldMetaForKey(
  key: string,
  fields: ApiConfigurableField[],
): ApiConfigurableField | undefined {
  return fields.find((f) => f.env === key || f.key === key);
}

export function StartupTab({
  service,
  onChanged,
  defaultStartupCmd = "Image entrypoint (automatic)",
}: {
  service: Service;
  onChanged: (s: Service) => void;
  defaultStartupCmd?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fieldDefs, setFieldDefs] = useState<ApiConfigurableField[]>([]);

  const visibleEnv = useMemo(() => {
    const env = service.config.environment ?? {};
    return Object.entries(env).filter(([key]) => !HIDDEN_KEYS.has(key));
  }, [service.config.environment]);

  const initial = visibleEnv.map(([key, value]) => ({ key, value }));
  const [rows, setRows] = useState(initial.length > 0 ? initial : []);
  const [masked, setMasked] = useState<Set<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [cmdOpen, setCmdOpen] = useState(true);
  const [startupCmd, setStartupCmd] = useState(service.config.startup_cmd ?? "");
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    void templatesApi.list().then((templates) => {
      const game = templates.find((t) => t.type === "game" && t.id === "minecraft");
      if (game?.configurable) setFieldDefs(game.configurable);
    });
  }, []);

  useEffect(() => {
    setRows(visibleEnv.map(([key, value]) => ({ key, value })));
    setStartupCmd(service.config.startup_cmd ?? "");
  }, [visibleEnv, service.config.startup_cmd]);

  const importParsed = useCallback((parsed: { key: string; value: string }[]) => {
    const filtered = parsed.filter((p) => !HIDDEN_KEYS.has(p.key));
    if (filtered.length === 0) return;
    setRows((prev) => mergeEnvRows(prev, filtered));
    toast(`Imported ${filtered.length} variables`, "success");
  }, []);

  const onFileSelect = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    importParsed(parseEnvFile(text));
  };

  const toggleMask = (key: string) => {
    setMasked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateValue = (key: string, val: string) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, value: val } : r)));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const hidden = Object.fromEntries(
      Object.entries(service.config.environment ?? {}).filter(([k]) => HIDDEN_KEYS.has(k)),
    );
    const edited = Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));
    const env = { ...hidden, ...edited };
    try {
      const updated = await servicesApi.updateEnv(service.id, env);
      const withCmd = await servicesApi.updateConfig(service.id, {
        startup_cmd: startupCmd.trim() || undefined,
      });
      onChanged(withCmd ?? updated);
      toast("Startup settings saved", "success");
      setMsg("Restart the service to apply changes.");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Save failed";
      setMsg(m);
      toast(m, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-surface p-4 transition-colors",
        dragOver ? "border-vivox-500/50" : "border-border",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        void onFileSelect(file);
      }}
    >
      <div className="rounded-lg border border-border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-sm text-foreground"
          onClick={() => setCmdOpen((o) => !o)}
        >
          <span>Startup command</span>
          {cmdOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        {cmdOpen && (
          <div className="space-y-2 border-t border-border px-3 pb-3 pt-2">
            <p className="text-xs text-muted">
              Default:{" "}
              <span className="font-mono text-muted">{defaultStartupCmd}</span>
            </p>
            <label className="flex flex-col gap-1 text-xs text-muted">
              This server&apos;s command
              <input
                value={startupCmd}
                onChange={(e) => setStartupCmd(e.target.value)}
                placeholder="Leave empty to use the default"
                className={cn(inputClass, "h-9 w-full")}
              />
            </label>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".env,text/plain"
          className="hidden"
          onChange={(e) => void onFileSelect(e.target.files?.[0])}
        />
        <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
          <Upload className="size-3.5" /> Import .env
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setBulkOpen((o) => !o)}>
          Bulk paste
        </Button>
        {dragOver && <span className="text-xs text-vivox-400">Drop .env file to import</span>}
      </div>

      {bulkOpen && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/50 p-3">
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={"KEY=value\nANOTHER=value"}
            rows={4}
            className={cn(inputClass, "min-h-[80px] w-full resize-y")}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                importParsed(parseEnvFile(bulkText));
                setBulkText("");
                setBulkOpen(false);
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {rows.length === 0 && (
          <p className="text-sm text-muted">No startup variables configured.</p>
        )}
        {rows.map((row) => {
          const meta = fieldMetaForKey(row.key, fieldDefs);
          const label = meta?.label ?? row.key;
          const options = meta?.options?.split(",").map((o) => o.trim()).filter(Boolean);
          const isSelect = meta?.field_type === "select" && options && options.length > 0;
          const isPassword = meta?.field_type === "password";
          const isNumber = meta?.field_type === "number";

          return (
            <div key={row.key} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              <div className="min-w-0 sm:w-1/3">
                <p className="font-mono text-xs font-medium uppercase text-foreground">{label}</p>
                {meta?.description && (
                  <p className="text-[10px] text-subtle">{meta.description}</p>
                )}
              </div>
              {isSelect ? (
                <select
                  value={row.value}
                  onChange={(e) => updateValue(row.key, e.target.value)}
                  className={cn(inputClass, "h-9 flex-1")}
                >
                  {options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={isPassword && masked.has(row.key) ? "password" : isNumber ? "number" : "text"}
                  value={row.value}
                  onChange={(e) => updateValue(row.key, e.target.value)}
                  placeholder="value"
                  className={cn(inputClass, "h-9 flex-1")}
                />
              )}
              {(isPassword || row.key.toLowerCase().includes("pass")) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 px-2"
                  onClick={() => toggleMask(row.key)}
                  aria-label={masked.has(row.key) ? "Show value" : "Hide value"}
                >
                  {masked.has(row.key) ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end">
        <Button size="sm" actionType="save" onClick={save} loading={saving}>
          <Save className="size-3.5" /> Save
        </Button>
      </div>
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}

/** @deprecated Use StartupTab */
export const EnvTab = StartupTab;
