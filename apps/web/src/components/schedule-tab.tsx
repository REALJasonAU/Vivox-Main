"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, Plus, Trash2, X } from "lucide-react";
import { scheduleApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { toast } from "@/hooks/useToast";
import type { ScheduledTask } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/states";
import { cn, formatRelativeTime } from "@/lib/utils";

const STATUS_STYLES: Record<ScheduledTask["status"], string> = {
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  paused: "border-border-focus bg-surface-raised text-muted",
  running: "border-amber-500/40 bg-amber-500/10 text-amber-400 animate-pulse",
  failed: "border-red-500/40 bg-red-500/10 text-red-400",
};

type SimplePreset = "hourly" | "daily" | "weekly";

function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*")
    return "Every hour at :00";
  if (min === "0" && hour === "0" && dom === "*" && mon === "*" && dow === "*")
    return "Daily at midnight";
  if (min === "0" && hour === "0" && dom === "*" && mon === "*" && dow === "0")
    return "Weekly on Sunday at midnight";
  if (min.startsWith("*/")) return `Every ${min.slice(2)} minutes`;
  if (hour !== "*" && min !== "*") return `At ${hour.padStart(2, "0")}:${min.padStart(2, "0")} UTC`;
  return expr;
}

function buildCronFromSimple(preset: SimplePreset, hour: number, minute: number, dow: number): string {
  if (preset === "hourly") return `${minute} * * * *`;
  if (preset === "daily") return `${minute} ${hour} * * *`;
  return `${minute} ${hour} * * ${dow}`;
}

export function ScheduleTab({ serviceId }: { serviceId: string }) {
  const { data, loading, error, refetch } = useApi(
    () => scheduleApi.list(serviceId),
    [serviceId],
  );
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [action, setAction] = useState("restart");
  const [enabled, setEnabled] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [cronExpr, setCronExpr] = useState("0 * * * *");
  const [preset, setPreset] = useState<SimplePreset>("daily");
  const [hour, setHour] = useState(0);
  const [minute, setMinute] = useState(0);
  const [dow, setDow] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const tasks = data ?? [];

  const previewCron = useMemo(
    () => (advanced ? cronExpr : buildCronFromSimple(preset, hour, minute, dow)),
    [advanced, cronExpr, preset, hour, minute, dow],
  );

  const resetForm = () => {
    setName("");
    setAction("restart");
    setEnabled(true);
    setAdvanced(false);
    setCronExpr("0 * * * *");
    setPreset("daily");
    setHour(0);
    setMinute(0);
    setDow(0);
  };

  const create = async () => {
    setSubmitting(true);
    try {
      await scheduleApi.create(serviceId, {
        name: name.trim(),
        cron_expr: previewCron.trim(),
        action,
        status: enabled ? "active" : "paused",
      });
      toast("Scheduled task created", "success");
      setShowModal(false);
      resetForm();
      void refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to create task", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (taskId: string) => {
    setDeletingId(taskId);
    await new Promise((r) => setTimeout(r, 260));
    try {
      await scheduleApi.remove(serviceId, taskId);
      toast("Task removed", "success");
      void refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to remove task", "error");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <Skeleton className="h-48" />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div className="flex flex-col gap-4">
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">New scheduled task</h2>
                <p className="mt-0.5 text-sm text-muted">Automate restarts, stops, or starts on a schedule.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1.5 text-muted hover:bg-surface-raised hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Task name"
                className="h-10 w-full rounded-lg border border-border bg-background/50 px-3 text-sm text-foreground outline-none focus:border-border-focus"
              />
              <label className="flex flex-col gap-1 text-xs text-muted">
                Action
                <select
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  className="h-10 rounded-lg border border-border bg-background/50 px-3 text-sm text-foreground"
                >
                  <option value="restart">restart</option>
                  <option value="stop">stop</option>
                  <option value="start">start</option>
                </select>
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={advanced}
                  onChange={(e) => setAdvanced(e.target.checked)}
                  className="accent-vivox-500"
                />
                Advanced — raw cron expression
              </label>

              {advanced ? (
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Cron expression
                  <input
                    value={cronExpr}
                    onChange={(e) => setCronExpr(e.target.value)}
                    className="h-10 rounded-lg border border-border bg-background/50 px-3 font-mono text-sm text-foreground"
                  />
                </label>
              ) : (
                <div className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["hourly", "Every hour"],
                        ["daily", "Every day"],
                        ["weekly", "Every week"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setPreset(id)}
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-xs",
                          preset === id
                            ? "border-vivox-500/40 bg-vivox-500/10 text-vivox-400"
                            : "border-border text-muted hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {preset !== "hourly" && (
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1 text-xs text-muted">
                        Hour (UTC)
                        <input
                          type="number"
                          min={0}
                          max={23}
                          value={hour}
                          onChange={(e) => setHour(Number(e.target.value))}
                          className="h-9 rounded-lg border border-border bg-background/50 px-3 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-muted">
                        Minute
                        <input
                          type="number"
                          min={0}
                          max={59}
                          value={minute}
                          onChange={(e) => setMinute(Number(e.target.value))}
                          className="h-9 rounded-lg border border-border bg-background/50 px-3 text-sm"
                        />
                      </label>
                    </div>
                  )}
                  {preset === "weekly" && (
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      Day of week
                      <select
                        value={dow}
                        onChange={(e) => setDow(Number(e.target.value))}
                        className="h-9 rounded-lg border border-border bg-background/50 px-3 text-sm"
                      >
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                          <option key={d} value={i}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {preset === "hourly" && (
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      At minute
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={minute}
                        onChange={(e) => setMinute(Number(e.target.value))}
                        className="h-9 rounded-lg border border-border bg-background/50 px-3 text-sm"
                      />
                    </label>
                  )}
                </div>
              )}

              <p className="text-xs text-muted">
                <span className="font-mono text-foreground">{previewCron}</span>
                {" · "}
                {describeCron(previewCron)}
              </p>

              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="accent-vivox-500"
                />
                Enabled
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <Button variant="ghost" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button loading={submitting} disabled={name.trim().length < 2} onClick={() => void create()}>
                Create task
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Cron-based automation for this server.</p>
        <Button size="sm" onClick={() => setShowModal(true)}>
          <Plus className="size-3.5" /> New task
        </Button>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-6" />}
          title="No scheduled tasks"
          description="Create a cron task to restart, stop, or start this server on a schedule."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <motion.div
              key={task.id}
              animate={
                deletingId === task.id
                  ? { opacity: 0, x: 16, scaleY: 0.6, height: 0 }
                  : { opacity: 1, x: 0, scaleY: 1 }
              }
              transition={{ duration: 0.25, ease: [0.4, 0, 1, 1] }}
              style={{ overflow: "hidden" }}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{task.name}</span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs capitalize",
                      STATUS_STYLES[task.status],
                    )}
                  >
                    {task.status}
                  </span>
                  <span className="font-mono text-xs text-muted">{task.cron_expr}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {task.action}
                  {task.next_run_at && ` · next ${formatRelativeTime(task.next_run_at)}`}
                  {task.last_result && ` · last: ${task.last_result}`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                actionType="delete"
                onClick={() => void remove(task.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
