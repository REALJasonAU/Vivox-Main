"use client";

import { useCallback, useEffect, useState } from "react";
import { filesApi } from "@/lib/api";
import { fileRelToAbsolute } from "@/lib/service-routes";
import { toast } from "@/hooks/useToast";
import type { FileEntry } from "@/lib/types";
import {
  SERVER_ROOT,
  decodeContent,
  isTextContent,
  loadViewMode,
  saveViewMode,
  type ViewMode,
} from "./shared";

export function useFileManager({
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
      ? initialSelectedFile.includes("/")
        ? initialSelectedFile.slice(0, initialSelectedFile.lastIndexOf("/")) || SERVER_ROOT
        : SERVER_ROOT
      : SERVER_ROOT;

  const [viewMode, setViewModeState] = useState<ViewMode>(() => loadViewMode(serviceId));
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [selectedFile, setSelectedFile] = useState<string | null>(initialSelectedFile ?? null);
  const [openTabs, setOpenTabs] = useState<string[]>(
    initialSelectedFile ? [initialSelectedFile] : [],
  );
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setViewModeState(mode);
      saveViewMode(serviceId, mode);
    },
    [serviceId],
  );

  const loadFileInternal = useCallback(async (path: string) => {
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
  }, [serviceId]);

  const loadFile = useCallback(
    async (path: string, opts?: { addTab?: boolean }) => {
      if (opts?.addTab !== false) {
        setOpenTabs((tabs) => (tabs.includes(path) ? tabs : [...tabs, path]));
      }
      await loadFileInternal(path);
      onPathChange?.(path);
    },
    [loadFileInternal, onPathChange],
  );

  const closeTab = useCallback(
    (path: string) => {
      setOpenTabs((tabs) => {
        const next = tabs.filter((t) => t !== path);
        if (selectedFile === path) {
          const fallback = next[next.length - 1] ?? null;
          if (fallback) {
            void loadFileInternal(fallback);
            onPathChange?.(fallback);
          } else {
            setSelectedFile(null);
            setFileContent(null);
            setEditMode(false);
            onPathChange?.(currentPath);
          }
        }
        return next;
      });
    },
    [selectedFile, loadFileInternal, onPathChange, currentPath],
  );

  useEffect(() => {
    const dir = initialDirRel
      ? fileRelToAbsolute(initialDirRel)
      : initialSelectedFile
        ? initialSelectedFile.includes("/")
          ? initialSelectedFile.slice(0, initialSelectedFile.lastIndexOf("/")) || SERVER_ROOT
          : SERVER_ROOT
        : SERVER_ROOT;
    setCurrentPath(dir);
    if (initialSelectedFile) {
      setOpenTabs((tabs) =>
        tabs.includes(initialSelectedFile) ? tabs : [...tabs, initialSelectedFile],
      );
      void loadFileInternal(initialSelectedFile);
    } else {
      setSelectedFile(null);
      setFileContent(null);
    }
  }, [initialDirRel, initialSelectedFile, loadFileInternal]);

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

  const goToPath = useCallback(
    (path: string) => {
      setCurrentPath(path);
      setSelectedFile(null);
      setFileContent(null);
      setEditMode(false);
      onPathChange?.(path);
    },
    [onPathChange],
  );

  const listDirectory = useCallback(
    async (path: string): Promise<FileEntry[]> => {
      try {
        return await filesApi.list(serviceId, path);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Failed to list directory", "error");
        return [];
      }
    },
    [serviceId],
  );

  return {
    viewMode,
    setViewMode,
    currentPath,
    setCurrentPath: goToPath,
    selectedFile,
    openTabs,
    fileContent,
    editedContent,
    setEditedContent,
    editMode,
    setEditMode,
    saving,
    loadingFile,
    loadFile,
    closeTab,
    onSave,
    listDirectory,
  };
}
