"use client";

import dynamic from "next/dynamic";
import { Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/states";
import { getLanguage } from "./shared";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export function MonacoPanel({
  selectedFile,
  fileContent,
  editedContent,
  editMode,
  loadingFile,
  saving,
  onEdit,
  onSave,
  onChange,
  className,
  showToolbar = true,
  autoEdit = false,
}: {
  selectedFile: string | null;
  fileContent: string | null;
  editedContent: string;
  editMode: boolean;
  loadingFile: boolean;
  saving: boolean;
  onEdit: () => void;
  onSave: () => void;
  onChange: (value: string) => void;
  className?: string;
  showToolbar?: boolean;
  autoEdit?: boolean;
}) {
  const effectiveEdit = autoEdit || editMode;

  return (
    <div className={className ?? "flex min-w-0 flex-1 flex-col"}>
      {showToolbar && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted">
          <span className="min-w-0 flex-1 truncate font-mono">
            {selectedFile ? selectedFile : "Select a file to preview"}
          </span>
          {fileContent !== null && selectedFile && !autoEdit && (
            <>
              {!editMode ? (
                <Button variant="ghost" size="sm" onClick={onEdit}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  actionType="save"
                  disabled={saving}
                  onClick={() => void onSave()}
                >
                  <Save className="size-3.5" /> Save
                </Button>
              )}
            </>
          )}
          {fileContent !== null && selectedFile && autoEdit && (
            <Button
              variant="ghost"
              size="sm"
              actionType="save"
              disabled={saving}
              onClick={() => void onSave()}
            >
              <Save className="size-3.5" /> Save
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-1 flex-col overflow-hidden">
        {loadingFile ? (
          <div className="p-3">
            <Skeleton className="h-full min-h-[120px]" />
          </div>
        ) : selectedFile && fileContent === null ? (
          <p className="p-3 text-sm text-muted">Binary file — preview not available</p>
        ) : fileContent !== null && selectedFile ? (
          <MonacoEditor
            height="100%"
            language={getLanguage(selectedFile)}
            value={editedContent}
            theme="vs-dark"
            onChange={(v) => onChange(v ?? "")}
            onMount={(editor, monaco) => {
              if (effectiveEdit) {
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                  onSave();
                });
              }
            }}
            options={{
              readOnly: !effectiveEdit,
              minimap: { enabled: viewModeMinimap(autoEdit) },
              scrollBeyondLastLine: false,
              fontSize: 13,
              fontFamily: 'var(--font-mono), "JetBrains Mono", monospace',
              automaticLayout: true,
              padding: { top: 8 },
            }}
          />
        ) : (
          <p className="p-3 text-sm text-muted">No file selected</p>
        )}
      </div>
    </div>
  );
}

function viewModeMinimap(autoEdit: boolean): boolean {
  return autoEdit;
}
