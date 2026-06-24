"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Upload } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { filesApi } from "@/lib/api";
import { toast } from "@/hooks/useToast";
import type { FileEntry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Skeleton } from "@/components/ui/states";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";
import { SERVER_ROOT, joinServerPath, pathSegments } from "./shared";

export function ListView({
  serviceId,
  currentPath,
  selectedFile,
  onNavigate,
  onSelectFile,
}: {
  serviceId: string;
  currentPath: string;
  selectedFile: string | null;
  onNavigate: (path: string) => void;
  onSelectFile: (path: string) => void;
}) {
  const [draggingFile, setDraggingFile] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const { data, loading, error, refetch } = useApi<FileEntry[]>(
    () => filesApi.list(serviceId, currentPath),
    [serviceId, currentPath],
  );

  const entries = data ?? [];
  const segments = pathSegments(currentPath);

  const navigateTo = (index: number) => {
    if (index < 0) {
      onNavigate(SERVER_ROOT);
      return;
    }
    onNavigate(`${SERVER_ROOT}/${segments.slice(0, index + 1).join("/")}`);
  };

  const onUpload = () => {
    toast("Upload coming in next sprint", "info");
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col border-b border-border lg:border-b-0 lg:border-r">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2 text-xs">
        <button type="button" className="text-muted hover:text-foreground" onClick={() => navigateTo(-1)}>
          server
        </button>
        {segments.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <button
              type="button"
              className="text-muted hover:text-foreground"
              onClick={() => navigateTo(i)}
            >
              {seg}
            </button>
            <span className="text-subtle">/</span>
          </span>
        ))}
        <div className="ml-auto">
          <input ref={uploadRef} type="file" className="hidden" onChange={onUpload} />
          <Button variant="ghost" size="sm" actionType="upload" onClick={() => uploadRef.current?.click()}>
            <Upload className="size-3.5" /> Upload
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">Directory is empty</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {currentPath !== SERVER_ROOT && (
                <tr
                  className="cursor-pointer border-b border-border/50 hover:bg-surface-raised/50"
                  onClick={() => {
                    const parent =
                      segments.length <= 1
                        ? SERVER_ROOT
                        : `${SERVER_ROOT}/${segments.slice(0, -1).join("/")}`;
                    onNavigate(parent);
                  }}
                >
                  <td className="px-3 py-2 text-muted">📁 ..</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                </tr>
              )}
              {entries.map((entry) => {
                const fullPath = joinServerPath(currentPath, entry.name);
                return (
                  <motion.tr
                    key={entry.name}
                    draggable={!entry.is_dir}
                    onDragStart={() => !entry.is_dir && setDraggingFile(entry.name)}
                    onDragEnd={() => {
                      setDraggingFile(null);
                      setDropTarget(null);
                    }}
                    animate={
                      draggingFile === entry.name
                        ? {
                            scale: 1.04,
                            rotate: 1.5,
                            boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                          }
                        : dropTarget === entry.name && entry.is_dir
                          ? {
                              borderColor: "rgba(229,24,27,0.7)",
                              backgroundColor: "rgba(229,24,27,0.08)",
                            }
                          : { scale: 1, rotate: 0, boxShadow: "none" }
                    }
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                    onDragOver={
                      entry.is_dir
                        ? (e) => {
                            e.preventDefault();
                            setDropTarget(entry.name);
                          }
                        : undefined
                    }
                    onDragLeave={entry.is_dir ? () => setDropTarget(null) : undefined}
                    className={cn(
                      "cursor-pointer border-b border-border/50 hover:bg-surface-raised/50",
                      selectedFile === fullPath && "bg-vivox-500/10",
                      entry.is_dir && dropTarget === entry.name && "border-dashed",
                    )}
                    onClick={() => {
                      if (entry.is_dir) {
                        onNavigate(fullPath);
                      } else {
                        void onSelectFile(fullPath);
                      }
                    }}
                  >
                    <td className="px-3 py-2 font-mono text-foreground">
                      {entry.is_dir ? "📁" : "📄"} {entry.name}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">
                      {entry.is_dir ? "—" : formatBytes(entry.size)}
                    </td>
                    <td className="hidden px-3 py-2 text-xs text-muted sm:table-cell">
                      {entry.modified
                        ? formatRelativeTime(new Date(Number(entry.modified) * 1000))
                        : "—"}
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="border-t border-border px-3 py-1.5">
        <Button variant="ghost" size="sm" onClick={() => void refetch()}>
          Refresh
        </Button>
      </div>
    </div>
  );
}
