"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, RefreshCw, Save } from "lucide-react";
import { servicesApi, templatesApi } from "@/lib/api";
import { toast } from "@/hooks/useToast";
import type { ApiConfigurableField, ApiTemplate, Service } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildStartupRows,
  templateIdForService,
} from "@/lib/game-service";
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
  const [masked, setMasked] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const templateId = useMemo(() => templateIdForService(service), [service]);

  useEffect(() => {
    void templatesApi.list().then((templates) => {
      const id = templateId ?? (service.type === "game" ? "minecraft" : null);
      const match = id ? templates.find((t) => t.id === id) : undefined;
      setTemplate(match ?? null);
      setFieldDefs(match?.configurable ?? []);
    });
  }, [templateId, service.type]);

  useEffect(() => {
    setRows(buildStartupRows(service, template, HIDDEN_KEYS));
  }, [service, template]);

  useEffect(() => {
    const cmd = template?.startup_cmd?.trim();
    if (!cmd || service.config.startup_cmd?.trim()) return;
    void servicesApi
      .updateConfig(service.id, { startup_cmd: cmd })
      .then((updated) => {
        if (updated) onChanged(updated);
      })
      .catch(() => {
        /* non-fatal — user can redeploy */
      });
  }, [template, service.id, service.config.startup_cmd, onChanged]);

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
      onChanged(updated);
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

  const startupCmdPreview = service.config.startup_cmd?.trim() || template?.startup_cmd?.trim();

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Startup parameters</h2>
        <p className="mt-1 text-xs text-muted">
          Environment variables passed to the container. Keys are defined by the game template.
        </p>
      </div>

      {startupCmdPreview && (
        <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
            Startup command (from template)
          </p>
          <p className="mt-1 max-h-24 overflow-y-auto font-mono text-[11px] leading-relaxed text-muted">
            {startupCmdPreview}
          </p>
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
          const isRcon = row.key === "RCON_PASS";

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
