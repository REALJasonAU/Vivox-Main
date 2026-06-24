"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { Pencil, Save, Upload } from "lucide-react";
import { filesApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { toast } from "@/hooks/useToast";
import type { FileEntry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Skeleton } from "@/components/ui/states";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

function getLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "go":
      return "go";
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "py":
      return "python";
    case "yaml":
    case "yml":
      return "yaml";
    case "json":
      return "json";
    case "sh":
      return "shell";
    case "env":
      return "plaintext";
    case "md":
      return "markdown";
    case "sql":
      return "sql";
    case "toml":
      return "toml";
    case "xml":
    case "html":
      return "html";
    case "css":
      return "css";
    default:
      return "plaintext";
  }
}

function decodeContent(data: { content: string; encoding?: string }): string {
  if (data.encoding === "base64") {
    try {
      return atob(data.content);
    } catch {
      return "";
    }
  }
  return data.content;
}

function isTextContent(text: string): boolean {
  if (!text) return true;
  return !text.includes("\0");
}

export function FileManager({ serviceId }: { serviceId: string }) {
  const [currentPath, setCurrentPath] = useState("/");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [draggingFile, setDraggingFile] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const { data, loading, error, refetch } = useApi<FileEntry[]>(
    () => filesApi.list(serviceId, currentPath),
    [serviceId, currentPath],
  );

  const entries = data ?? [];

  const loadFile = useCallback(
    async (path: string) => {
      setSelectedFile(path);
      setEditMode(false);
      setLoadingFile(true);
      setFileContent(null);
      try {
        const res = await filesApi.read(serviceId, path);
        const text = decodeContent(res);
        setFileContent(isTextContent(text) ? text : null);
        setEditedContent(isTextContent(text) ? text : "");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Failed to read file", "error");
        setFileContent(null);
      } finally {
        setLoadingFile(false);
      }
    },
    [serviceId],
  );

  const onSave = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await filesApi.write(serviceId, selectedFile, editedContent);
      setFileContent(editedContent);
      setEditMode(false);
      toast("Saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!editMode && fileContent !== null) {
      setEditedContent(fileContent);
    }
  }, [fileContent, editMode]);

  const segments = currentPath.split("/").filter(Boolean);

  const navigateTo = (index: number) => {
    if (index < 0) {
      setCurrentPath("/");
      return;
    }
    setCurrentPath("/" + segments.slice(0, index + 1).join("/"));
    setSelectedFile(null);
    setFileContent(null);
    setEditMode(false);
  };

  const onUpload = () => {
    toast("Upload coming in next sprint", "info");
  };

  return (
    <div className="flex h-[480px] flex-col gap-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col border-b border-zinc-800 lg:border-b-0 lg:border-r">
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-800 px-3 py-2 text-xs">
          <button type="button" className="text-zinc-400 hover:text-zinc-100" onClick={() => navigateTo(-1)}>
            /
          </button>
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <button
                type="button"
                className="text-zinc-400 hover:text-zinc-100"
                onClick={() => navigateTo(i)}
              >
                {seg}
              </button>
              <span className="text-zinc-600">/</span>
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
            <p className="p-6 text-center text-sm text-zinc-500">Directory is empty</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {currentPath !== "/" && (
                  <tr
                    className="cursor-pointer border-b border-zinc-800/50 hover:bg-zinc-800/50"
                    onClick={() => {
                      const parent = "/" + segments.slice(0, -1).join("/");
                      setCurrentPath(parent === "/" ? "/" : parent.replace(/\/$/, "") || "/");
                      setSelectedFile(null);
                      setFileContent(null);
                      setEditMode(false);
                    }}
                  >
                    <td className="px-3 py-2 text-zinc-400">📁 ..</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                  </tr>
                )}
                {entries.map((entry) => {
                  const fullPath =
                    currentPath === "/"
                      ? `/${entry.name}`
                      : `${currentPath.replace(/\/$/, "")}/${entry.name}`;
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
                        "cursor-pointer border-b border-zinc-800/50 hover:bg-zinc-800/50",
                        selectedFile === fullPath && "bg-vivox-500/10",
                        entry.is_dir && dropTarget === entry.name && "border-dashed",
                      )}
                      onClick={() => {
                        if (entry.is_dir) {
                          setCurrentPath(fullPath);
                          setSelectedFile(null);
                          setFileContent(null);
                          setEditMode(false);
                        } else {
                          void loadFile(fullPath);
                        }
                      }}
                    >
                      <td className="px-3 py-2 font-mono text-zinc-100">
                        {entry.is_dir ? "📁" : "📄"} {entry.name}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-500">
                        {entry.is_dir ? "—" : formatBytes(entry.size)}
                      </td>
                      <td className="hidden px-3 py-2 text-xs text-zinc-500 sm:table-cell">
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
        <div className="border-t border-zinc-800 px-3 py-1.5">
          <Button variant="ghost" size="sm" onClick={() => void refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-xs text-zinc-500">
          <span className="min-w-0 flex-1 truncate font-mono">
            {selectedFile ? selectedFile : "Select a file to preview"}
          </span>
          {fileContent !== null && selectedFile && (
            <>
              {!editMode ? (
                <Button variant="ghost" size="sm" onClick={() => setEditMode(true)}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
              ) : (
                <Button variant="ghost" size="sm" actionType="save" disabled={saving} onClick={() => void onSave()}>
                  <Save className="size-3.5" /> Save
                </Button>
              )}
            </>
          )}
        </div>
        <div className="flex flex-1 flex-col overflow-hidden">
          {loadingFile ? (
            <div className="p-3">
              <Skeleton className="h-full min-h-[120px]" />
            </div>
          ) : selectedFile && fileContent === null ? (
            <p className="p-3 text-sm text-zinc-500">Binary file — preview not available</p>
          ) : fileContent !== null && selectedFile ? (
            <MonacoEditor
              height="100%"
              language={getLanguage(selectedFile)}
              value={editedContent}
              theme="vs-dark"
              onChange={(v) => setEditedContent(v ?? "")}
              options={{
                readOnly: !editMode,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                fontFamily: 'var(--font-mono), "JetBrains Mono", monospace',
                automaticLayout: true,
              }}
            />
          ) : (
            <p className="p-3 text-sm text-zinc-500">No file selected</p>
          )}
        </div>
      </div>
    </div>
  );
}
