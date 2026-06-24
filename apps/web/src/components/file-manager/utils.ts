import type { FileEntry } from "@/lib/types";

export const SERVER_ROOT = "/mnt/server";

export type ViewMode = "list" | "tree" | "vscode";

export interface EditorTab {
  path: string;
  content: string;
  savedContent: string;
  loading: boolean;
  binary: boolean;
}

export interface FavoriteItem {
  path: string;
  isDir: boolean;
}

export function favoritesKey(serviceId: string) {
  return `vivox-fm-favorites-${serviceId}`;
}

export function loadFavorites(serviceId: string): FavoriteItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(favoritesKey(serviceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): FavoriteItem | null => {
        if (typeof item === "string") return { path: item, isDir: !item.includes(".") };
        if (item && typeof item === "object" && "path" in item) {
          const rec = item as { path?: unknown; isDir?: unknown };
          if (typeof rec.path === "string") {
            return { path: rec.path, isDir: Boolean(rec.isDir) };
          }
        }
        return null;
      })
      .filter((item): item is FavoriteItem => item !== null);
  } catch {
    return [];
  }
}

export function saveFavorites(serviceId: string, items: FavoriteItem[]) {
  localStorage.setItem(favoritesKey(serviceId), JSON.stringify(items));
}

export function getLanguage(filename: string): string {
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
    case "rs":
      return "rust";
    case "cfg":
      return "ini";
    default:
      return "plaintext";
  }
}

export function decodeContent(data: { content: string; encoding?: string }): string {
  if (data.encoding === "base64") {
    try {
      return atob(data.content);
    } catch {
      return "";
    }
  }
  return data.content;
}

export function isTextContent(text: string): boolean {
  if (!text) return true;
  return !text.includes("\0");
}

export function pathSegments(absPath: string): string[] {
  return absPath.slice(SERVER_ROOT.length).split("/").filter(Boolean);
}

export function joinPath(base: string, name: string): string {
  return `${base.replace(/\/$/, "")}/${name}`;
}

export function parentPath(absPath: string): string {
  const segs = pathSegments(absPath);
  if (segs.length <= 1) return SERVER_ROOT;
  return `${SERVER_ROOT}/${segs.slice(0, -1).join("/")}`;
}

export function fileName(absPath: string): string {
  const segs = pathSegments(absPath);
  return segs[segs.length - 1] ?? "server";
}

export function relativePath(absPath: string): string {
  const rel = absPath.slice(SERVER_ROOT.length);
  return rel.startsWith("/") ? rel.slice(1) : rel;
}

export function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function filterEntries(entries: FileEntry[], query: string): FileEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => e.name.toLowerCase().includes(q));
}

export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

export function openInLocalIDE(serviceId: string, absPath: string) {
  const rel = relativePath(absPath);
  const url = `vscode://vivox-files/open?service=${encodeURIComponent(serviceId)}&path=${encodeURIComponent(rel)}`;
  window.location.href = url;
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(rel);
  }
}
