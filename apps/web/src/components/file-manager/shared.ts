export const SERVER_ROOT = "/mnt/server";

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
    case "mjs":
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

export type ViewMode = "list" | "tree" | "vscode";

export function viewModeStorageKey(serviceId: string): string {
  return `vivox-file-manager-mode:${serviceId}`;
}

export function loadViewMode(serviceId: string): ViewMode {
  if (typeof window === "undefined") return "list";
  const raw = localStorage.getItem(viewModeStorageKey(serviceId));
  if (raw === "tree" || raw === "vscode" || raw === "list") return raw;
  return "list";
}

export function saveViewMode(serviceId: string, mode: ViewMode): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(viewModeStorageKey(serviceId), mode);
}

export function pathSegments(absPath: string): string[] {
  return absPath.slice(SERVER_ROOT.length).split("/").filter(Boolean);
}

export function parentPath(absPath: string): string {
  const segs = pathSegments(absPath);
  if (segs.length <= 1) return SERVER_ROOT;
  return `${SERVER_ROOT}/${segs.slice(0, -1).join("/")}`;
}

export function joinServerPath(dir: string, name: string): string {
  return `${dir.replace(/\/$/, "")}/${name}`;
}

export function fileNameFromPath(absPath: string): string {
  const segs = pathSegments(absPath);
  return segs[segs.length - 1] ?? absPath;
}
