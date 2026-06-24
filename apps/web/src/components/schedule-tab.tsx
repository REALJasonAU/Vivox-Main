"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { scheduleApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { toast } from "@/hooks/useToast";
import type { ScheduledTask } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/states";
import { cn, formatRelativeTime } from "@/lib/utils";

const STATUS_STYLES: Record<ScheduledTask["status"], string> = {
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  paused: "border-zinc-700 bg-zinc-800 text-zinc-400",
  running: "border-amber-500/40 bg-amber-500/10 text-amber-400 animate-pulse",
  failed: "border-red-500/40 bg-red-500/10 text-red-400",
};

function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*")
    return "Every hour at :00";
  if (min === "0" && hour === "0" && dom === "*" && mon === "*" && dow === "*")
    return "Daily at midnight";
  if (min.startsWith("*/")) return `Every ${min.slice(2)} minutes`;
  return expr;
}

export function ScheduleTab({ serviceId }: { serviceId: string }) {
  const { data, loading, error, refetch } = useApi(
    () => scheduleApi.list(serviceId),
    [serviceId],
  );
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [cronExpr, setCronExpr] = useState("0 * * * *");
  const [action, setAction] = useState("restart");
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const tasks = data ?? [];

  const create = async () => {
    setSubmitting(true);
    try {
      await scheduleApi.create(serviceId, {
        name: name.trim(),
        cron_expr: cronExpr.trim(),
        action,
        status: enabled ? "active" : "paused",
      });
      toast("Scheduled task created", "success");
      setShowForm(false);
      setName("");
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">Cron-based automation for this service.</p>
        <Button size="sm" onClick={() => setShowForm((s) => !s)}>
          <Plus className="size-3.5" /> New task
        </Button>
      </div>

      {showForm && (
        <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Task name"
            className="h-10 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 text-sm text-zinc-100 outline-none focus:border-zinc-700"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Action
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className="h-10 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 text-sm text-zinc-100"
              >
                <option value="restart">restart</option>
                <option value="stop">stop</option>
                <option value="start">start</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Cron expression
              <input
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                className="h-10 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 font-mono text-sm text-zinc-100"
              />
            </label>
          </div>
          <p className="text-xs text-zinc-500">{describeCron(cronExpr)}</p>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-vivox-500"
            />
            Enabled
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={submitting} disabled={name.trim().length < 2} onClick={create}>
              Create
            </Button>
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-6" />}
          title="No scheduled tasks"
          description="Create a cron task to restart, stop, or start this service on a schedule."
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
              className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-100">{task.name}</span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs capitalize",
                      STATUS_STYLES[task.status],
                    )}
                  >
                    {task.status}
                  </span>
                  <span className="font-mono text-xs text-zinc-500">{task.cron_expr}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
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
