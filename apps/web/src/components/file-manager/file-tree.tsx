"use client";

import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import { filesApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { FileEntry } from "@/lib/types";
import { Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import {
  fileName,
  joinPath,
  SERVER_ROOT,
  sortEntries,
} from "@/components/file-manager/utils";

function useDirectoryListing(serviceId: string, path: string | null) {
  return useApi<FileEntry[]>(
    () => (path ? filesApi.list(serviceId, path) : Promise.resolve([])),
    [serviceId, path],
  );
}

export function FileTree({
  serviceId,
  path,
  depth,
  selectedPath,
  expanded,
  onToggleExpand,
  onSelectFile,
  dropTargetPath,
  onDropTarget,
  onUploadToPath,
  onMoveFile,
}: {
  serviceId: string;
  path: string;
  depth: number;
  selectedPath: string | null;
  expanded: Set<string>;
  onToggleExpand: (path: string) => void;
  onSelectFile: (path: string) => void;
  dropTargetPath?: string | null;
  onDropTarget?: (path: string | null) => void;
  onUploadToPath?: (targetPath: string, files: FileList) => void | Promise<void>;
  onMoveFile?: (fromPath: string, toDir: string) => void | Promise<void>;
}) {
  const isExpanded = path === SERVER_ROOT || expanded.has(path);
  const { data, loading } = useDirectoryListing(serviceId, isExpanded ? path : null);
  const name = path === SERVER_ROOT ? "server" : fileName(path);
  const entries = sortEntries(data ?? []);
  const childDepth = path === SERVER_ROOT ? depth : depth + 1;
  const isDropTarget = dropTargetPath === path;

  const handleDrop = (targetDir: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDropTarget?.(null);
    const internal = e.dataTransfer.getData("application/x-vivox-file-path");
    if (internal && onMoveFile) {
      void onMoveFile(internal, targetDir);
      return;
    }
    if (e.dataTransfer.files?.length && onUploadToPath) {
      void onUploadToPath(targetDir, e.dataTransfer.files);
    }
  };

  return (
    <div>
      {path !== SERVER_ROOT && (
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs hover:bg-surface-raised",
            selectedPath === path && "bg-vivox-500/10 text-vivox-400",
            isDropTarget && "bg-vivox-500/10 ring-1 ring-inset ring-vivox-400/40",
          )}
          style={{ paddingLeft: depth * 12 + 8 }}
          onClick={() => onToggleExpand(path)}
          onDragOver={(e) => {
            if (!onUploadToPath && !onMoveFile) return;
            e.preventDefault();
            e.stopPropagation();
            onDropTarget?.(path);
          }}
          onDragLeave={() => onDropTarget?.(null)}
          onDrop={(e) => handleDrop(path, e)}
        >
          {isExpanded ? (
            <ChevronDown className="size-3 shrink-0 text-muted" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted" />
          )}
          <Folder className="size-3.5 shrink-0 text-vivox-400" />
          <span className="truncate">{name}</span>
        </button>
      )}
      {isExpanded && (
        <div
          onDragOver={(e) => {
            if (path === SERVER_ROOT && (onUploadToPath || onMoveFile)) {
              e.preventDefault();
              onDropTarget?.(SERVER_ROOT);
            }
          }}
          onDrop={(e) => {
            if (path === SERVER_ROOT) handleDrop(SERVER_ROOT, e);
          }}
        >
          {loading ? (
            <div style={{ paddingLeft: childDepth * 12 + 8 }} className="py-1">
              <Skeleton className="h-5 w-24" />
            </div>
          ) : (
            entries.map((entry) => {
              const full = joinPath(path, entry.name);
              if (entry.is_dir) {
                return (
                  <FileTree
                    key={full}
                    serviceId={serviceId}
                    path={full}
                    depth={childDepth}
                    selectedPath={selectedPath}
                    expanded={expanded}
                    onToggleExpand={onToggleExpand}
                    onSelectFile={onSelectFile}
                    dropTargetPath={dropTargetPath}
                    onDropTarget={onDropTarget}
                    onUploadToPath={onUploadToPath}
                    onMoveFile={onMoveFile}
                  />
                );
              }
              return (
                <button
                  key={full}
                  type="button"
                  draggable={!!onMoveFile}
                  onDragStart={(e) => {
                    if (!onMoveFile) return;
                    e.dataTransfer.setData("application/x-vivox-file-path", full);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-surface-raised",
                    selectedPath === full && "bg-vivox-500/10 text-vivox-400",
                  )}
                  style={{ paddingLeft: childDepth * 12 + 20 }}
                  onClick={() => onSelectFile(full)}
                >
                  <File className="size-3.5 shrink-0 text-muted" />
                  <span className="truncate">{entry.name}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
