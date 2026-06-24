"use client";

import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";

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
}: {
  serviceId: string;
  path: string;
  depth: number;
  selectedPath: string | null;
  expanded: Set<string>;
  onToggleExpand: (path: string) => void;
  onSelectFile: (path: string) => void;
}) {
  const isExpanded = path === SERVER_ROOT || expanded.has(path);
  const { data, loading } = useDirectoryListing(serviceId, isExpanded ? path : null);
  const name = path === SERVER_ROOT ? "server" : fileName(path);
  const entries = sortEntries(data ?? []);
  const childDepth = path === SERVER_ROOT ? depth : depth + 1;

  return (
    <div>
      {path !== SERVER_ROOT && (
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs hover:bg-surface-raised",
            selectedPath === path && "bg-vivox-500/10 text-vivox-400",
          )}
          style={{ paddingLeft: depth * 12 + 8 }}
          onClick={() => onToggleExpand(path)}
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
        <div>
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
                  />
                );
              }
              return (
                <button
                  key={full}
                  type="button"
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
