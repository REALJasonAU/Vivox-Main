"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, RefreshCw, RotateCcw, Save } from "lucide-react";
import { servicesApi } from "@/lib/api";
import { toast } from "@/hooks/useToast";
import type { ApiConfigurableField, ApiTemplate, Service } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildStartupRows,
  defaultForStartupKey,
  templateIdForService,
} from "@/lib/game-service";
import { getTemplatesCached } from "@/lib/templates-cache";
import { generateSecurePassword } from "@/lib/password";

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
}: {
  service: Service;
  onChanged: (s: Service) => void;
}) {
  const [template, setTemplate] = useState<ApiTemplate | null>(null);
  const [fieldDefs, setFieldDefs] = useState<ApiConfigurableField[]>([]);
  const [rows, setRows] = useState<{ key: string; value: string }[]>([]);
  const [startupCmd, setStartupCmd] = useState("");
  const [masked, setMasked] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const syncedRef = useRef<string | null>(null);

  const templateId = useMemo(() => templateIdForService(service), [service]);
  const templateDefaultCmd = template?.startup_cmd?.trim() ?? "";

  useEffect(() => {
    void getTemplatesCached().then((templates) => {
      const id = templateId ?? (service.type === "game" ? "minecraft" : null);
      const match = id ? templates.find((t) => t.id === id) : undefined;
      setTemplate(match ?? null);
      setFieldDefs(match?.configurable ?? []);
    });
  }, [templateId, service.type]);

  useEffect(() => {
    setRows(buildStartupRows(service, template, HIDDEN_KEYS));
    setStartupCmd(service.config.startup_cmd?.trim() || template?.startup_cmd?.trim() || "");
  }, [service, template]);

  useEffect(() => {
    if (!template || syncedRef.current === service.id) return;
    syncedRef.current = service.id;

    const env = service.config.environment ?? {};
    const mergedRows = buildStartupRows(service, template, HIDDEN_KEYS);
    const missing = mergedRows.filter((r) => env[r.key] === undefined);
    const needsCmd = !service.config.startup_cmd?.trim() && !!templateDefaultCmd;

    if (missing.length === 0 && !needsCmd) return;

    const nextEnv = { ...env };
    for (const row of missing) {
      nextEnv[row.key] = row.value;
    }

    void (async () => {
      try {
        let updated = service;
        if (missing.length > 0) {
          updated = await servicesApi.updateEnv(service.id, nextEnv);
        }
        if (needsCmd && templateDefaultCmd) {
          updated = await servicesApi.updateConfig(service.id, { startup_cmd: templateDefaultCmd });
        }
        if (missing.length > 0 || needsCmd) onChanged(updated);
      } catch {
        /* non-fatal — user can save manually */
      }
    })();
  }, [template, service, templateDefaultCmd, onChanged]);

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

  const resetRow = (key: string) => {
    const def = defaultForStartupKey(key, template);
    updateValue(key, def);
  };

  const resetStartupCmd = () => {
    setStartupCmd(templateDefaultCmd);
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const hidden = Object.fromEntries(
      Object.entries(service.config.environment ?? {}).filter(([k]) => HIDDEN_KEYS.has(k)),
    );
    const edited = Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));
    const env = { ...hidden, ...edited };
    try {
      let updated = await servicesApi.updateEnv(service.id, env);
      const cmd = startupCmd.trim();
      const prevCmd = service.config.startup_cmd?.trim() ?? "";
      if (cmd !== prevCmd) {
        updated = await servicesApi.updateConfig(service.id, { startup_cmd: cmd });
      }
      onChanged(updated);
      toast("Startup settings saved", "success");
      setMsg("Restart the server to apply changes.");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Save failed";
      setMsg(m);
      toast(m, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Startup parameters</h2>
      </div>

      <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
            Startup command
          </p>
          {templateDefaultCmd && startupCmd !== templateDefaultCmd && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              title="Reset to template default"
              onClick={resetStartupCmd}
            >
              <RotateCcw className="size-3" /> Reset
            </Button>
          )}
        </div>
        <textarea
          value={startupCmd}
          onChange={(e) => setStartupCmd(e.target.value)}
          rows={3}
          placeholder={templateDefaultCmd || "Default container entrypoint"}
          className={cn(inputClass, "mt-2 w-full resize-y py-2 leading-relaxed")}
        />
        {templateDefaultCmd && (
          <p className="mt-1 text-[10px] text-subtle">Template default available via Reset.</p>
        )}
      </div>

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
          const isRcon = row.key === "RCON_PASS";
          const defaultVal = defaultForStartupKey(row.key, template);
          const canReset = defaultVal !== "" && row.value !== defaultVal;

          return (
            <div key={row.key} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              <div className="min-w-0 sm:w-1/3">
                <p className="font-mono text-xs font-medium uppercase text-foreground">{label}</p>
                <p className="font-mono text-[10px] text-subtle">{row.key}</p>
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
              {canReset && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 px-2"
                  title="Reset to template default"
                  onClick={() => resetRow(row.key)}
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              )}
              {isRcon && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 px-2"
                  title="Generate new RCON password"
                  onClick={() => updateValue(row.key, generateSecurePassword(20))}
                >
                  <RefreshCw className="size-3.5" />
                </Button>
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
