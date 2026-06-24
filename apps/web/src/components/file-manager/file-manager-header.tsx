"use client";

import { ExternalLink, FolderCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ViewMode } from "./shared";

const MODES: { id: ViewMode; label: string }[] = [
  { id: "list", label: "List" },
  { id: "tree", label: "Tree" },
  { id: "vscode", label: "VS Code" },
];

export function FileManagerHeader({
  viewMode,
  onViewModeChange,
  onOpenLocalVsCode,
  onOpenLocalIde,
}: {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onOpenLocalVsCode: () => void;
  onOpenLocalIde: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border px-1 pb-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-base font-semibold text-foreground">File Manager</h2>
        <p className="text-xs text-muted">Browse, edit, and sync server files</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-background/50 p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onViewModeChange(m.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                viewMode === m.id
                  ? "bg-vivox-500/15 text-foreground shadow-sm"
                  : "text-muted hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={onOpenLocalVsCode}>
          <ExternalLink className="size-3.5" />
          Open in Local VS Code
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenLocalIde}>
          <FolderCode className="size-3.5" />
          Open in Local IDE
        </Button>
      </div>
    </div>
  );
}
