"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Save, Upload } from "lucide-react";
import { servicesApi } from "@/lib/api";
import { mergeEnvRows, parseEnvFile } from "@/lib/env-parse";
import { toast } from "@/hooks/useToast";
import type { Service } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const inputClass =
  "rounded-lg border border-border bg-background/50 px-3 font-mono text-sm text-foreground outline-none transition-all duration-200 focus:border-border-focus focus:ring-1 focus:ring-border-focus";

export function EnvTab({
  service,
  onChanged,
  defaultStartupCmd = "Image entrypoint (automatic)",
}: {
  service: Service;
  onChanged: (s: Service) => void;
  /** Template / image default startup command for comparison. */
  defaultStartupCmd?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initial = Object.entries(service.config.environment ?? {}).map(([key, value]) => ({
    key,
    value,
  }));
  const [rows, setRows] = useState(initial.length > 0 ? initial : [{ key: "", value: "" }]);
  const [masked, setMasked] = useState<Set<number>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [cmdOpen, setCmdOpen] = useState(true);
  const [startupCmd, setStartupCmd] = useState(service.config.startup_cmd ?? "");
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    setStartupCmd(service.config.startup_cmd ?? "");
  }, [service.config.startup_cmd]);

  const importParsed = useCallback((parsed: { key: string; value: string }[]) => {
    if (parsed.length === 0) return;
    setRows((prev) => mergeEnvRows(prev, parsed));
    toast(`Imported ${parsed.length} variables`, "success");
  }, []);

  const onFileSelect = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    importParsed(parseEnvFile(text));
  };

  const toggleMask = (index: number) => {
    setMasked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const update = (i: number, field: "key" | "value", val: string) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const env = Object.fromEntries(
      rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]),
    );
    try {
      const updated = await servicesApi.updateEnv(service.id, env);
      const withCmd = await servicesApi.updateConfig(service.id, {
        startup_cmd: startupCmd.trim() || undefined,
      });
      onChanged(withCmd ?? updated);
      toast("Environment saved", "success");
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
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={row.key}
              onChange={(e) => update(i, "key", e.target.value)}
              placeholder="KEY"
              className={cn(inputClass, "h-9 w-1/3 uppercase")}
            />
            <input
              type={masked.has(i) ? "password" : "text"}
              value={row.value}
              onChange={(e) => update(i, "value", e.target.value)}
              placeholder="value"
              className={cn(inputClass, "h-9 flex-1")}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 px-2"
              onClick={() => toggleMask(i)}
              aria-label={masked.has(i) ? "Show value" : "Hide value"}
            >
              {masked.has(i) ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setRows((p) => [...p, { key: "", value: "" }])}>
          + Add variable
        </Button>
        <Button size="sm" actionType="save" onClick={save} loading={saving}>
          <Save className="size-3.5" /> Save
        </Button>
      </div>
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
