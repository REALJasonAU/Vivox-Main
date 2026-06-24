"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Code2,
  ExternalLink,
  FilePlus,
  FolderPlus,
  FolderTree,
  Home,
  List,
  Save,
  Search,
  Star,
  Upload,
  X,
} from "lucide-react";
import { filesApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { toast } from "@/hooks/useToast";
import type { FileEntry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { fileRelToAbsolute } from "@/lib/service-routes";
import { FileTable } from "@/components/file-manager/file-table";
import { FileTree } from "@/components/file-manager/file-tree";
import { MonacoPane } from "@/components/file-manager/monaco-pane";
import {
  type EditorTab,
  type FavoriteItem,
  type ViewMode,
  SERVER_ROOT,
  decodeContent,
  fileName,
  filterEntries,
  isTextContent,
  joinPath,
  loadFavorites,
  openInLocalIDE,
  parentPath,
  readFileAsText,
  relativePath,
  saveFavorites,
  sortEntries,
} from "@/components/file-manager/utils";

function ModePill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-vivox-500/15 text-vivox-400 ring-1 ring-vivox-400/40"
          : "text-muted hover:bg-surface-raised hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Breadcrumbs({
  currentPath,
  onNavigate,
}: {
  currentPath: string;
  onNavigate: (path: string) => void;
}) {
  const segments = currentPath.slice(SERVER_ROOT.length).split("/").filter(Boolean);
  return (
    <nav className="flex flex-wrap items-center justify-end gap-1 text-xs">
      <button
        type="button"
        className="text-muted transition-colors hover:text-foreground"
        onClick={() => onNavigate(SERVER_ROOT)}
      >
        server
      </button>
      {segments.map((seg, i) => {
        const path = `${SERVER_ROOT}/${segments.slice(0, i + 1).join("/")}`;
        return (
          <span key={path} className="flex items-center gap-1">
            <span className="text-subtle">/</span>
            <button
              type="button"
              className={cn(
                "transition-colors hover:text-foreground",
                i === segments.length - 1 ? "text-foreground" : "text-muted",
              )}
              onClick={() => onNavigate(path)}
            >
              {seg}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

export function FileManager({
  serviceId,
  initialDirRel,
  initialSelectedFile,
  onPathChange,
}: {
  serviceId: string;
  initialDirRel?: string;
  initialSelectedFile?: string;
  onPathChange?: (absolutePath: string) => void;
}) {
  const initialPath = initialDirRel
    ? fileRelToAbsolute(initialDirRel)
    : initialSelectedFile
      ? parentPath(initialSelectedFile)
      : SERVER_ROOT;

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [expandedTree, setExpandedTree] = useState<Set<string>>(() => new Set([SERVER_ROOT]));
  const [fullEditorPath, setFullEditorPath] = useState<string | null>(null);
  const [fullEditorTab, setFullEditorTab] = useState<EditorTab | null>(null);
  const [vscodeTabs, setVscodeTabs] = useState<EditorTab[]>([]);
  const [activeVscodeTab, setActiveVscodeTab] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const { data, loading, error, refetch } = useApi<FileEntry[]>(
    () => filesApi.list(serviceId, currentPath),
    [serviceId, currentPath],
  );

  const entries = useMemo(
    () => filterEntries(sortEntries(data ?? []), searchQuery),
    [data, searchQuery],
  );

  useEffect(() => {
    setFavorites(loadFavorites(serviceId));
  }, [serviceId]);

  const isFavorite = useCallback(
    (absPath: string) => favorites.some((f) => f.path === absPath),
    [favorites],
  );

  const toggleFavorite = useCallback((absPath: string, isDir: boolean) => {
    setFavorites((prev) => {
      const exists = prev.some((f) => f.path === absPath);
      const next = exists
        ? prev.filter((f) => f.path !== absPath)
        : [...prev, { path: absPath, isDir }];
      saveFavorites(serviceId, next);
      return next;
    });
  }, [serviceId]);

  const goToPath = useCallback(
    (path: string) => {
      setCurrentPath(path);
      setSelected(new Set());
      setSearchQuery("");
      onPathChange?.(path);
    },
    [onPathChange],
  );

  const loadTabContent = useCallback(
    async (path: string): Promise<EditorTab> => {
      try {
        const res = await filesApi.read(serviceId, path);
        const text = decodeContent(res);
        const binary = !isTextContent(text);
        return {
          path,
          content: binary ? "" : text,
          savedContent: binary ? "" : text,
          loading: false,
          binary,
        };
      } catch (e) {
        toast(e instanceof Error ? e.message : "Failed to read file", "error");
        return { path, content: "", savedContent: "", loading: false, binary: true };
      }
    },
    [serviceId],
  );

  const openFullEditor = useCallback(
    async (path: string) => {
      setFullEditorPath(path);
      setFullEditorTab({ path, content: "", savedContent: "", loading: true, binary: false });
      onPathChange?.(path);
      setFullEditorTab(await loadTabContent(path));
    },
    [loadTabContent, onPathChange],
  );

  const openVscodeTab = useCallback(
    async (path: string) => {
      setVscodeTabs((prev) => {
        if (prev.some((t) => t.path === path)) return prev;
        return [...prev, { path, content: "", savedContent: "", loading: true, binary: false }];
      });
      setActiveVscodeTab(path);
      onPathChange?.(path);
      const tab = await loadTabContent(path);
      setVscodeTabs((prev) => prev.map((t) => (t.path === path ? tab : t)));
    },
    [loadTabContent, onPathChange],
  );

  const handleFileClick = useCallback(
    (path: string) => {
      if (viewMode === "vscode") void openVscodeTab(path);
      else void openFullEditor(path);
    },
    [openFullEditor, openVscodeTab, viewMode],
  );

  const loadFileInternal = useCallback(
    async (path: string) => {
      if (viewMode === "vscode") await openVscodeTab(path);
      else await openFullEditor(path);
    },
    [openFullEditor, openVscodeTab, viewMode],
  );

  useEffect(() => {
    const dir = initialDirRel
      ? fileRelToAbsolute(initialDirRel)
      : initialSelectedFile
        ? parentPath(initialSelectedFile)
        : SERVER_ROOT;
    setCurrentPath(dir);
    if (initialSelectedFile) void loadFileInternal(initialSelectedFile);
    else {
      setFullEditorPath(null);
      setFullEditorTab(null);
    }
  }, [initialDirRel, initialSelectedFile, loadFileInternal]);

  const navigateUp = () => {
    if (currentPath === SERVER_ROOT) return;
    goToPath(parentPath(currentPath));
  };

  const toggleSelect = (fullPath: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === entries.length) setSelected(new Set());
    else setSelected(new Set(entries.map((e) => joinPath(currentPath, e.name))));
  };

  const onSaveFull = async () => {
    if (!fullEditorTab || fullEditorTab.binary) return;
    setSaving(true);
    try {
      await filesApi.write(serviceId, fullEditorTab.path, fullEditorTab.content);
      setFullEditorTab((t) => (t ? { ...t, savedContent: t.content } : t));
      toast("Saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const onSaveVscode = async () => {
    const tab = vscodeTabs.find((t) => t.path === activeVscodeTab);
    if (!tab || tab.binary) return;
    setSaving(true);
    try {
      await filesApi.write(serviceId, tab.path, tab.content);
      setVscodeTabs((prev) =>
        prev.map((t) => (t.path === tab.path ? { ...t, savedContent: t.content } : t)),
      );
      toast("Saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const closeFullEditor = () => {
    setFullEditorPath(null);
    setFullEditorTab(null);
    onPathChange?.(currentPath);
  };

  const closeVscodeTab = (path: string) => {
    setVscodeTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activeVscodeTab === path) setActiveVscodeTab(next[next.length - 1]?.path ?? null);
      return next;
    });
  };

  const onNewFolder = async () => {
    const name = window.prompt("New folder name");
    if (!name?.trim()) return;
    try {
      await filesApi.mkdir(serviceId, joinPath(currentPath, name.trim()));
      toast("Folder created", "success");
      void refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to create folder", "error");
    }
  };

  const onNewFile = async () => {
    const name = window.prompt("New file name");
    if (!name?.trim()) return;
    const path = joinPath(currentPath, name.trim());
    try {
      await filesApi.write(serviceId, path, "");
      toast("File created", "success");
      void refetch();
      void handleFileClick(path);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to create file", "error");
    }
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const text = await readFileAsText(file);
      await filesApi.write(serviceId, joinPath(currentPath, file.name), text);
      toast(`Uploaded ${file.name}`, "success");
      void refetch();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
    }
  };

  const onOpenIDE = () => {
    const target = fullEditorPath ?? activeVscodeTab ?? currentPath;
    openInLocalIDE(serviceId, target);
    toast("Path copied — open in VS Code if extension is installed", "info");
  };

  const toggleTreeExpand = (path: string) => {
    setExpandedTree((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openFavorite = (fav: FavoriteItem) => {
    if (fav.isDir) goToPath(fav.path);
    else {
      goToPath(parentPath(fav.path));
      void handleFileClick(fav.path);
    }
  };

  const activeVscode = vscodeTabs.find((t) => t.path === activeVscodeTab);
  const fullDirty = fullEditorTab && fullEditorTab.content !== fullEditorTab.savedContent;
  const vscodeDirty = activeVscode && activeVscode.content !== activeVscode.savedContent;

  if (fullEditorPath && fullEditorTab && viewMode !== "vscode") {
    return (
      <div className="flex h-[min(720px,calc(100vh-12rem))] flex-col overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm text-foreground">{relativePath(fullEditorPath)}</p>
            <p className="text-xs text-muted">Full editor</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onOpenIDE}>
              <ExternalLink className="size-3.5" /> Open in IDE
            </Button>
            {!fullEditorTab.binary && (
              <Button
                variant="secondary"
                size="sm"
                actionType="save"
                disabled={saving || !fullDirty}
                onClick={() => void onSaveFull()}
              >
                <Save className="size-3.5" /> Save
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={closeFullEditor}>
              <X className="size-3.5" /> Close
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {fullEditorTab.loading ? (
            <Skeleton className="m-4 h-full min-h-[200px]" />
          ) : fullEditorTab.binary ? (
            <p className="p-6 text-sm text-muted">Binary file — preview not available</p>
          ) : (
            <MonacoPane
              path={fullEditorPath}
              content={fullEditorTab.content}
              onChange={(v) => setFullEditorTab((t) => (t ? { ...t, content: v } : t))}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[min(720px,calc(100vh-12rem))] flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">File Manager</h2>
          <p className="text-xs text-muted">Browse and edit server files</p>
        </div>
        <Breadcrumbs currentPath={currentPath} onNavigate={goToPath} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="icon" className="size-8" onClick={navigateUp} title="Back">
          <ArrowLeft className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={() => goToPath(SERVER_ROOT)} title="Home">
          <Home className="size-4" />
        </Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <div className="flex items-center gap-1 rounded-lg border border-border bg-background/40 p-0.5">
          <ModePill active={viewMode === "list"} onClick={() => setViewMode("list")} icon={<List className="size-3.5" />} label="List" />
          <ModePill active={viewMode === "tree"} onClick={() => setViewMode("tree")} icon={<FolderTree className="size-3.5" />} label="Tree" />
          <ModePill active={viewMode === "vscode"} onClick={() => setViewMode("vscode")} icon={<Code2 className="size-3.5" />} label="VS Code" />
        </div>
        <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <Button variant="outline" size="sm" onClick={onOpenIDE}>
          <ExternalLink className="size-3.5" />
          <span className="hidden sm:inline">Open in Local VS Code</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void onNewFolder()}>
          <FolderPlus className="size-3.5" /> New Folder
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void onNewFile()}>
          <FilePlus className="size-3.5" /> New File
        </Button>
        <input ref={uploadRef} type="file" className="hidden" onChange={(e) => void onUpload(e)} />
        <Button variant="ghost" size="sm" actionType="upload" onClick={() => uploadRef.current?.click()}>
          <Upload className="size-3.5" /> Upload
        </Button>
        <div className="relative ml-auto min-w-[140px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            placeholder="Search files…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-full rounded-lg border border-border bg-background/50 pl-8 pr-3 text-xs text-foreground outline-none transition-colors focus:border-border-focus focus:ring-1 focus:ring-border-focus"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {viewMode !== "vscode" && (
          <aside className="hidden w-44 shrink-0 flex-col border-r border-border bg-surface-raised/30 md:flex">
            <div className="border-b border-border px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Quick Access</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {favorites.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-subtle">Star files or folders to pin them here.</p>
              ) : (
                favorites.map((fav) => (
                  <button
                    key={fav.path}
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-surface-raised"
                    onClick={() => openFavorite(fav)}
                  >
                    <Star className="size-3 shrink-0 fill-vivox-400 text-vivox-400" />
                    <span className="truncate">{fileName(fav.path)}</span>
                  </button>
                ))
              )}
            </div>
          </aside>
        )}

        {viewMode === "vscode" ? (
          <div className="flex min-w-0 flex-1">
            <aside className="w-52 shrink-0 overflow-y-auto border-r border-border bg-surface-raised/20 p-2">
              <FileTree
                serviceId={serviceId}
                path={SERVER_ROOT}
                depth={0}
                selectedPath={activeVscodeTab}
                expanded={expandedTree}
                onToggleExpand={toggleTreeExpand}
                onSelectFile={(p) => void openVscodeTab(p)}
              />
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
              {vscodeTabs.length > 0 && (
                <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border bg-background/30 px-1 py-1">
                  {vscodeTabs.map((tab) => {
                    const dirty = tab.content !== tab.savedContent;
                    const active = tab.path === activeVscodeTab;
                    return (
                      <button
                        key={tab.path}
                        type="button"
                        className={cn(
                          "group inline-flex max-w-[180px] items-center gap-1 rounded-md px-2 py-1 text-xs",
                          active ? "bg-surface-raised text-foreground" : "text-muted hover:bg-surface-raised/60 hover:text-foreground",
                        )}
                        onClick={() => {
                          setActiveVscodeTab(tab.path);
                          onPathChange?.(tab.path);
                        }}
                      >
                        <span className="truncate">{fileName(tab.path)}</span>
                        {dirty && <span className="text-vivox-400">•</span>}
                        <span
                          role="button"
                          tabIndex={0}
                          className="rounded p-0.5 opacity-0 hover:bg-border group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeVscodeTab(tab.path);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              closeVscodeTab(tab.path);
                            }
                          }}
                        >
                          <X className="size-3" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 border-b border-border px-3 py-1.5">
                {activeVscode && !activeVscode.binary && (
                  <Button variant="secondary" size="sm" actionType="save" disabled={saving || !vscodeDirty} onClick={() => void onSaveVscode()}>
                    <Save className="size-3.5" /> Save
                  </Button>
                )}
              </div>
              <div className="flex-1 overflow-hidden">
                {!activeVscode ? (
                  <p className="p-6 text-sm text-muted">Select a file from the tree to edit</p>
                ) : activeVscode.loading ? (
                  <Skeleton className="m-4 h-full min-h-[200px]" />
                ) : activeVscode.binary ? (
                  <p className="p-6 text-sm text-muted">Binary file — preview not available</p>
                ) : (
                  <MonacoPane
                    path={activeVscode.path}
                    content={activeVscode.content}
                    onChange={(v) =>
                      setVscodeTabs((prev) => prev.map((t) => (t.path === activeVscode.path ? { ...t, content: v } : t)))
                    }
                  />
                )}
              </div>
            </div>
          </div>
        ) : viewMode === "tree" ? (
          <div className="flex min-w-0 flex-1">
            <aside className="w-52 shrink-0 overflow-y-auto border-r border-border bg-surface-raised/20 p-2">
              <FileTree
                serviceId={serviceId}
                path={SERVER_ROOT}
                depth={0}
                selectedPath={null}
                expanded={expandedTree}
                onToggleExpand={toggleTreeExpand}
                onSelectFile={(p) => void handleFileClick(p)}
              />
            </aside>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {error && (
                <div className="p-3">
                  <ErrorBanner message={error} />
                </div>
              )}
              <FileTable
                currentPath={currentPath}
                entries={entries}
                loading={loading}
                selected={selected}
                isFavorite={isFavorite}
                onToggleFavorite={toggleFavorite}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onNavigateDir={goToPath}
                onOpenFile={(p) => void handleFileClick(p)}
              />
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {error && (
              <div className="p-3">
                <ErrorBanner message={error} />
              </div>
            )}
            <FileTable
              currentPath={currentPath}
              entries={entries}
              loading={loading}
              selected={selected}
              isFavorite={isFavorite}
              onToggleFavorite={toggleFavorite}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onNavigateDir={goToPath}
              onOpenFile={(p) => void handleFileClick(p)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
