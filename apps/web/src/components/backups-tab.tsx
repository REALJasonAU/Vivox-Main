"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Trash2, X } from "lucide-react";
import { servicesApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { Backup } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { NamePromptModal } from "@/components/ui/name-prompt-modal";
import { Skeleton } from "@/components/ui/states";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { pushNotif } from "@/lib/notifications";

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
  const [showCreate, setShowCreate] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [failureMsg, setFailureMsg] = useState<string | null>(null);
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [dismissedFailed, setDismissedFailed] = useState<Set<string>>(() => new Set());
  const notifiedFailedRef = useRef<Set<string>>(new Set());

  const list = backups ?? [];

  useEffect(() => {
    for (const b of list) {
      if (b.status !== "failed" || notifiedFailedRef.current.has(b.id)) continue;
      notifiedFailedRef.current.add(b.id);
      pushNotif({
        serviceId,
        serviceName: displayNames[b.id] ?? `Backup ${b.id.slice(0, 8)}`,
        kind: "deploy_fail",
      });
    }
  }, [list, serviceId, displayNames]);

  const visibleBackups = useMemo(
    () => list.filter((b) => b.status !== "failed" || !dismissedFailed.has(b.id)),
    [list, dismissedFailed],
  );

  const createBackup = async (name: string) => {
    setConnecting(true);
    try {
      const backup = await servicesApi.createBackup(serviceId);
      setDisplayNames((prev) => ({ ...prev, [backup.id]: name }));
      void refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "We couldn't start the backup. Please try again.";
      setFailureMsg(msg);
    } finally {
      setConnecting(false);
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
      {showCreate && (
        <NamePromptModal
          title="Create backup"
          label="Backup name"
          placeholder="e.g. Before plugin update"
          confirmLabel="Start backup"
          onClose={() => setShowCreate(false)}
          onConfirm={createBackup}
        />
      )}

      {failureMsg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setFailureMsg(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 shrink-0 text-red-400" />
              <div>
                <h3 className="text-sm font-medium text-foreground">Backup couldn&apos;t start</h3>
                <p className="mt-1 text-sm text-muted">{failureMsg}</p>
                <p className="mt-2 text-xs text-subtle">
                  Sorry about that — please check the node is online and try again.
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={() => setFailureMsg(null)}>
                OK
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">Volume backups</h3>
        <Button
          size="sm"
          onClick={() => setShowCreate(true)}
          loading={connecting}
          disabled={connecting}
          actionType="upload"
        >
          Create backup
        </Button>
      </div>

      {connecting && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          <span className="size-2 animate-pulse rounded-full bg-amber-500" />
          Connecting…
        </div>
      )}

      {loading ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="flex flex-col gap-2">
          {visibleBackups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted">
              No backups yet
            </div>
          ) : (
            <AnimatePresence>
              {visibleBackups.map((b) => (
                <motion.div
                  key={b.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                >
                  <BackupStatusDot status={b.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {displayNames[b.id] ?? `Backup ${b.id.slice(0, 8)}`}
                    </p>
                    <p className="text-xs text-muted">
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
                          : "border-border-focus bg-surface-raised text-muted",
                    )}
                  >
                    {b.status}
                  </span>
                  {b.status === "failed" && (
                    <button
                      type="button"
                      onClick={() =>
                        setDismissedFailed((prev) => new Set(prev).add(b.id))
                      }
                      className="rounded p-1 text-muted hover:bg-surface-raised hover:text-foreground"
                      aria-label="Dismiss failed backup"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void deleteBackup(b.id)}
                    className="text-subtle hover:text-red-400"
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
