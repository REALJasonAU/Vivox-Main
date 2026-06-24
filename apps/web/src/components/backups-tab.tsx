"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { servicesApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { Backup } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/states";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";
import { toast } from "@/hooks/useToast";

function BackupStatusDot({ status }: { status: Backup["status"] }) {
  const colors = {
    pending: "bg-amber-500 animate-pulse",
    running: "bg-amber-500 animate-pulse",
    success: "bg-emerald-500",
    failed: "bg-red-500",
  };
  return <span className={cn("size-2 shrink-0 rounded-full", colors[status])} />;
}

export function BackupsTab({ serviceId }: { serviceId: string }) {
  const { data: backups, loading, refetch } = useApi(
    () => servicesApi.listBackups(serviceId),
    [serviceId],
  );
  const [creating, setCreating] = useState(false);

  const createBackup = async () => {
    setCreating(true);
    try {
      await servicesApi.createBackup(serviceId);
      toast("Backup started — check back in a moment", "info");
      setTimeout(() => void refetch(), 3000);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Backup failed", "error");
    } finally {
      setCreating(false);
    }
  };

  const deleteBackup = async (backupId: string) => {
    try {
      await servicesApi.deleteBackup(serviceId, backupId);
      void refetch();
      toast("Backup deleted", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Delete failed", "error");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-zinc-100">Volume backups</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Snapshots of container data. Stored on the node at /var/lib/vivox/backups.
          </p>
        </div>
        <Button size="sm" onClick={() => void createBackup()} loading={creating} actionType="upload">
          Create backup
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="flex flex-col gap-2">
          {(backups ?? []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 py-10 text-center text-sm text-zinc-500">
              No backups yet
            </div>
          ) : (
            <AnimatePresence>
              {(backups ?? []).map((b) => (
                <motion.div
                  key={b.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
                >
                  <BackupStatusDot status={b.status} />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm text-zinc-100">{b.id.slice(0, 8)}…</p>
                    <p className="text-xs text-zinc-500">
                      {formatRelativeTime(b.created_at)}
                      {b.size_bytes != null && ` · ${formatBytes(b.size_bytes)}`}
                      {b.error && <span className="text-red-400"> · {b.error}</span>}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs capitalize",
                      b.status === "success"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : b.status === "failed"
                          ? "border-red-500/30 bg-red-500/10 text-red-400"
                          : "border-zinc-700 bg-zinc-800 text-zinc-400",
                    )}
                  >
                    {b.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => void deleteBackup(b.id)}
                    className="text-zinc-600 hover:text-red-400"
                    aria-label="Delete backup"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      )}
    </div>
  );
}
