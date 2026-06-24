"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell } from "lucide-react";
import { servicesApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useTopic } from "@/hooks/useWebSocket";
import { pushNotif } from "@/lib/notifications";
import type { AlertPayload, AlertRule, Service } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";

export function AlertsSection({ service }: { service: Service }) {
  const { data: rules, refetch } = useApi(() => servicesApi.alertRules(service.id), [service.id]);
  const [creating, setCreating] = useState(false);
  const [metric, setMetric] = useState<"cpu" | "memory">("cpu");
  const [threshold, setThreshold] = useState(80);
  const [operator, setOperator] = useState<"gt" | "lt">("gt");
  const [saving, setSaving] = useState(false);

  useTopic<AlertPayload>(`service:${service.id}:alert`, (payload) => {
    if (!payload?.metric) return;
    pushNotif({
      serviceId: service.id,
      serviceName: service.name,
      kind: "alert",
      meta: {
        metric: payload.metric,
        value: payload.value,
        threshold: payload.threshold,
        operator: payload.operator,
      },
    });
  });

  const createRule = async () => {
    setSaving(true);
    try {
      await servicesApi.createAlertRule(service.id, { metric, operator, threshold });
      void refetch();
      setCreating(false);
      toast("Alert rule created", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to create rule", "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleRule = async (rule: AlertRule, enabled: boolean) => {
    try {
      await servicesApi.toggleAlertRule(service.id, rule.id, enabled);
      void refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to update rule", "error");
    }
  };

  const deleteRule = async (id: string) => {
    try {
      await servicesApi.deleteAlertRule(service.id, id);
      void refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to delete rule", "error");
    }
  };

  const ruleList = rules ?? [];

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Bell className="size-4 text-muted" /> Resource Alerts
        </h3>
        <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
          + Add rule
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {ruleList.map((rule) => (
          <motion.div
            key={rule.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 flex items-center gap-3 overflow-hidden rounded-lg border border-border px-3 py-2 text-sm"
          >
            <span className={cn("size-2 rounded-full", rule.enabled ? "bg-vivox-500" : "bg-subtle")} />
            <span className="flex-1 text-foreground">
              {rule.metric === "cpu" ? "CPU" : "Memory"}{" "}
              {rule.operator === "gt" ? ">" : "<"} {rule.threshold}
              {rule.metric === "cpu" ? "%" : " MB"}
            </span>
            <button
              type="button"
              onClick={() => void toggleRule(rule, !rule.enabled)}
              className="text-xs text-muted hover:text-foreground"
            >
              {rule.enabled ? "Pause" : "Enable"}
            </button>
            <button
              type="button"
              onClick={() => void deleteRule(rule.id)}
              className="text-xs text-red-500/70 hover:text-red-400"
            >
              Delete
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      {ruleList.length === 0 && !creating && (
        <p className="mt-3 text-sm text-muted">No alert rules configured.</p>
      )}

      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 flex flex-wrap items-end gap-2 overflow-hidden rounded-lg border border-border-focus bg-background/50 p-3"
          >
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as "cpu" | "memory")}
              className="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-foreground"
            >
              <option value="cpu">CPU</option>
              <option value="memory">Memory</option>
            </select>
            <select
              value={operator}
              onChange={(e) => setOperator(e.target.value as "gt" | "lt")}
              className="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-foreground"
            >
              <option value="gt">&gt; above</option>
              <option value="lt">&lt; below</option>
            </select>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              min={1}
              max={metric === "cpu" ? 100 : 99999}
              className="h-9 w-24 rounded-lg border border-border bg-background/50 px-3 font-mono text-sm text-foreground"
            />
            <span className="text-xs text-muted">{metric === "cpu" ? "%" : "MB"}</span>
            <Button size="sm" onClick={() => void createRule()} actionType="save" loading={saving}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
