"use client";

import { Files, Search, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileTree } from "./file-tree";
import { MonacoPanel } from "./monaco-panel";
import { fileNameFromPath, getLanguage } from "./shared";

export function VsCodeView({
  serviceId,
  currentPath,
  selectedFile,
  openTabs,
  fileContent,
  editedContent,
  loadingFile,
  saving,
  listDirectory,
  onNavigate,
  onSelectFile,
  onCloseTab,
  onSave,
  onChange,
}: {
  serviceId: string;
  currentPath: string;
  selectedFile: string | null;
  openTabs: string[];
  fileContent: string | null;
  editedContent: string;
  loadingFile: boolean;
  saving: boolean;
  listDirectory: (path: string) => Promise<import("@/lib/types").FileEntry[]>;
  onNavigate: (path: string) => void;
  onSelectFile: (path: string) => void;
  onCloseTab: (path: string) => void;
  onSave: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-[#1e1e1e] bg-[#333333] py-3">
        <ActivityIcon icon={Files} active />
        <ActivityIcon icon={Search} />
        <ActivityIcon icon={Settings} />
      </div>

      <div className="flex w-52 shrink-0 flex-col border-r border-[#252526] bg-[#252526] lg:w-60">
        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#bbbbbb]">
          Explorer
        </div>
        <FileTree
          serviceId={serviceId}
          selectedFile={selectedFile}
          currentPath={currentPath}
          listDirectory={listDirectory}
          onSelectFile={(p) => void onSelectFile(p)}
          onSelectDir={onNavigate}
          className="flex-1 text-[#cccccc]"
          compact
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-[#1e1e1e]">
        {openTabs.length > 0 && (
          <div className="flex overflow-x-auto border-b border-[#252526] bg-[#2d2d2d]">
            {openTabs.map((tab) => {
              const active = tab === selectedFile;
              return (
                <div
                  key={tab}
                  className={cn(
                    "group flex max-w-[200px] shrink-0 items-center gap-1 border-r border-[#252526] px-3 py-1.5 text-xs",
                    active ? "bg-[#1e1e1e] text-[#ffffff]" : "bg-[#2d2d2d] text-[#969696] hover:bg-[#1e1e1e]/60",
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 truncate font-mono"
                    onClick={() => void onSelectFile(tab)}
                  >
                    {fileNameFromPath(tab)}
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 opacity-0 hover:bg-[#3c3c3c] group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab);
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <MonacoPanel
          selectedFile={selectedFile}
          fileContent={fileContent}
          editedContent={editedContent}
          editMode
          loadingFile={loadingFile}
          saving={saving}
          onEdit={() => {}}
          onSave={onSave}
          onChange={onChange}
          showToolbar={false}
          autoEdit
          className="flex min-w-0 flex-1 flex-col"
        />

        <div className="flex items-center justify-between border-t border-[#007acc] bg-[#007acc] px-3 py-0.5 text-[11px] text-white">
          <span className="min-w-0 truncate font-mono">
            {selectedFile ?? currentPath}
          </span>
          <span className="shrink-0 uppercase">
            {selectedFile ? getLanguage(selectedFile) : "folder"}
          </span>
        </div>
      </div>
    </div>
  );
}

function ActivityIcon({
  icon: Icon,
  active,
}: {
  icon: typeof Files;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md p-2",
        active ? "text-white" : "text-[#858585] hover:text-[#cccccc]",
      )}
    >
      <Icon className="size-5" />
      {active && <div className="mx-auto mt-0.5 h-0.5 w-5 rounded bg-white" />}
    </div>
  );
}
