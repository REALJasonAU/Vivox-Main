"use client";

import { File, Folder, Star } from "lucide-react";
import type { FileEntry } from "@/lib/types";
import { Skeleton } from "@/components/ui/states";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";
import { joinPath, pathSegments, SERVER_ROOT } from "@/components/file-manager/utils";

function FileIcon({ entry, className }: { entry: FileEntry; className?: string }) {
  if (entry.is_dir) return <Folder className={cn("size-4 shrink-0 text-vivox-400", className)} />;
  return <File className={cn("size-4 shrink-0 text-muted", className)} />;
}

export function FileTable({
  currentPath,
  entries,
  loading,
  selected,
  isFavorite,
  onToggleFavorite,
  onToggleSelect,
  onToggleSelectAll,
  onNavigateDir,
  onOpenFile,
}: {
  currentPath: string;
  entries: FileEntry[];
  loading: boolean;
  selected: Set<string>;
  isFavorite: (path: string) => boolean;
  onToggleFavorite: (path: string, isDir: boolean) => void;
  onToggleSelect: (path: string) => void;
  onToggleSelectAll: () => void;
  onNavigateDir: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const segments = pathSegments(currentPath);

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 border-b border-border bg-surface text-xs text-muted">
          <tr>
            <th className="w-8 px-3 py-2">
              <input
                type="checkbox"
                className="size-3.5 rounded border-border accent-vivox-500"
                checked={entries.length > 0 && selected.size === entries.length}
                onChange={onToggleSelectAll}
              />
            </th>
            <th className="w-8 px-1 py-2" />
            <th className="px-2 py-2 text-left font-medium">Name</th>
            <th className="hidden w-28 px-3 py-2 text-right font-medium sm:table-cell">Size</th>
            <th className="hidden w-36 px-3 py-2 text-right font-medium md:table-cell">Modified</th>
          </tr>
        </thead>
        <tbody>
          {currentPath !== SERVER_ROOT && (
            <tr
              className="cursor-pointer border-b border-border/50 hover:bg-surface-raised/50"
              onClick={() => {
                const parent =
                  segments.length <= 1
                    ? SERVER_ROOT
                    : `${SERVER_ROOT}/${segments.slice(0, -1).join("/")}`;
                onNavigateDir(parent);
              }}
            >
              <td className="px-3 py-2" />
              <td className="px-1 py-2" />
              <td className="px-2 py-2 text-muted">
                <span className="inline-flex items-center gap-2">
                  <Folder className="size-4 text-vivox-400" /> ..
                </span>
              </td>
              <td className="hidden px-3 py-2 sm:table-cell" />
              <td className="hidden px-3 py-2 md:table-cell" />
            </tr>
          )}
          {entries.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted">
                {currentPath === SERVER_ROOT ? "Directory is empty" : "No matching files"}
              </td>
            </tr>
          ) : (
            entries.map((entry) => {
              const fullPath = joinPath(currentPath, entry.name);
              const fav = isFavorite(fullPath);
              return (
                <tr
                  key={entry.name}
                  className="cursor-pointer border-b border-border/50 hover:bg-surface-raised/50"
                  onClick={() => {
                    if (entry.is_dir) onNavigateDir(fullPath);
                    else onOpenFile(fullPath);
                  }}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="size-3.5 rounded border-border accent-vivox-500"
                      checked={selected.has(fullPath)}
                      onChange={() => onToggleSelect(fullPath)}
                    />
                  </td>
                  <td className="px-1 py-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted transition-colors hover:text-vivox-400"
                      onClick={() => onToggleFavorite(fullPath, entry.is_dir)}
                      title={fav ? "Remove from Quick Access" : "Add to Quick Access"}
                    >
                      <Star className={cn("size-3.5", fav && "fill-vivox-400 text-vivox-400")} />
                    </button>
                  </td>
                  <td className="px-2 py-2 font-mono text-foreground">
                    <span className="inline-flex items-center gap-2">
                      <FileIcon entry={entry} />
                      {entry.name}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2 text-right text-xs text-muted sm:table-cell">
                    {entry.is_dir ? "—" : formatBytes(entry.size)}
                  </td>
                  <td className="hidden px-3 py-2 text-right text-xs text-muted md:table-cell">
                    {entry.modified
                      ? formatRelativeTime(new Date(Number(entry.modified) * 1000))
                      : "—"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
