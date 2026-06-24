"use client";

import { FileTree } from "./file-tree";
import { MonacoPanel } from "./monaco-panel";

export function TreeView({
  serviceId,
  currentPath,
  selectedFile,
  fileContent,
  editedContent,
  editMode,
  loadingFile,
  saving,
  listDirectory,
  onNavigate,
  onSelectFile,
  onEdit,
  onSave,
  onChange,
}: {
  serviceId: string;
  currentPath: string;
  selectedFile: string | null;
  fileContent: string | null;
  editedContent: string;
  editMode: boolean;
  loadingFile: boolean;
  saving: boolean;
  listDirectory: (path: string) => Promise<import("@/lib/types").FileEntry[]>;
  onNavigate: (path: string) => void;
  onSelectFile: (path: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <div className="flex w-56 shrink-0 flex-col border-r border-border bg-surface-raised/30 lg:w-64">
        <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Explorer
        </div>
        <FileTree
          serviceId={serviceId}
          selectedFile={selectedFile}
          currentPath={currentPath}
          listDirectory={listDirectory}
          onSelectFile={(p) => void onSelectFile(p)}
          onSelectDir={onNavigate}
          className="flex-1"
        />
      </div>
      <MonacoPanel
        selectedFile={selectedFile}
        fileContent={fileContent}
        editedContent={editedContent}
        editMode={editMode}
        loadingFile={loadingFile}
        saving={saving}
        onEdit={onEdit}
        onSave={onSave}
        onChange={onChange}
      />
    </>
  );
}
