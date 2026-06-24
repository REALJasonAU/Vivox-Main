"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Download, X } from "lucide-react";
import { API_BASE, filesApi, getApiToken } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import type { LocalSyncManifest } from "@/lib/api";

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildWorkspace(serviceId: string, folderName: string): string {
  return JSON.stringify(
    {
      folders: [{ path: folderName, name: `Vivox Server (${serviceId.slice(0, 8)})` }],
      settings: {
        "files.watcherExclude": { "**/.vivox-sync/**": true },
        "editor.formatOnSave": true,
      },
    },
    null,
    2,
  );
}

export function LocalSyncModal({
  serviceId,
  variant,
  onClose,
}: {
  serviceId: string;
  variant: "vscode" | "ide";
  onClose: () => void;
}) {
  const [manifest, setManifest] = useState<LocalSyncManifest | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const folderName = "vivox-server-files";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const m = await filesApi.localSyncManifest(serviceId);
        if (!cancelled) setManifest(m);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Failed to load sync config", "error");
      }
      const cached = getApiToken();
      if (cached) {
        if (!cancelled) setToken(cached);
        return;
      }
      try {
        const { data } = await authClient.token();
        if (!cancelled) setToken(data?.token ?? null);
      } catch {
        if (!cancelled) setToken(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  const apiBase =
    manifest?.api_base ??
    (typeof window !== "undefined"
      ? `${window.location.origin}${API_BASE}`
      : API_BASE);

  const syncCommand = token
    ? `node vivox-file-sync.mjs --service-id ${serviceId} --token "${token}" --api-base "${apiBase}" --local-dir ./${folderName} --pull`
    : `node vivox-file-sync.mjs --service-id ${serviceId} --token "$VIVOX_TOKEN" --api-base "${apiBase}" --local-dir ./${folderName} --pull`;

  const copyToken = useCallback(async () => {
    if (!token) {
      toast("No session token available — sign in again", "error");
      return;
    }
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast("Token copied", "success");
  }, [token]);

  const downloadScript = () => {
    const url = manifest?.sync_script_url ?? "/vivox-sync/vivox-file-sync.mjs";
    const a = document.createElement("a");
    a.href = url;
    a.download = "vivox-file-sync.mjs";
    a.click();
  };

  const downloadWorkspace = () => {
    downloadBlob(`vivox-${serviceId}.code-workspace`, buildWorkspace(serviceId, folderName), "application/json");
  };

  const title = variant === "vscode" ? "Open in Local VS Code" : "Open in Local IDE";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-muted">
              Sync server files to a local folder and edit in{" "}
              {variant === "vscode" ? "Visual Studio Code" : "your IDE"}. Saves push back to
              Vivox automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted hover:bg-surface-raised"
          >
            <X className="size-5" />
          </button>
        </div>

        <ol className="mt-5 space-y-4 text-sm text-foreground">
          <li className="rounded-lg border border-border bg-background/40 p-3">
            <p className="font-medium">1. Download sync tools</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" actionType="download" onClick={downloadScript}>
                <Download className="size-3.5" /> vivox-file-sync.mjs
              </Button>
              {variant === "vscode" && (
                <Button variant="outline" size="sm" actionType="download" onClick={downloadWorkspace}>
                  <Download className="size-3.5" /> Workspace file
                </Button>
              )}
            </div>
          </li>

          <li className="rounded-lg border border-border bg-background/40 p-3">
            <p className="font-medium">2. Create a local folder and run the sync daemon</p>
            <p className="mt-1 text-xs text-muted">
              Requires Node.js 18+. The daemon watches your local folder and syncs with the panel
              API.
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-[#1e1e1e] p-3 text-xs text-[#d4d4d4]">
              {`mkdir ${folderName}\n${syncCommand}`}
            </pre>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" actionType="copy" onClick={() => void navigator.clipboard.writeText(syncCommand)}>
                <Copy className="size-3.5" /> Copy command
              </Button>
              {token && (
                <Button variant="ghost" size="sm" onClick={() => void copyToken()}>
                  {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                  Copy JWT
                </Button>
              )}
            </div>
          </li>

          <li className="rounded-lg border border-border bg-background/40 p-3">
            <p className="font-medium">
              3. Open the folder in {variant === "vscode" ? "VS Code" : "your IDE"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {variant === "vscode"
                ? "Open the downloaded .code-workspace file, or File → Open Folder → vivox-server-files."
                : "File → Open → select the vivox-server-files folder (IntelliJ, WebStorm, etc.)."}
            </p>
          </li>

          <li className="rounded-lg border border-border bg-background/40 p-3">
            <p className="font-medium">4. Edit and save — changes sync to the server</p>
            <p className="mt-1 text-xs text-muted">
              Local saves upload via{" "}
              <code className="text-vivox-400">POST {manifest?.write_endpoint ?? `/services/${serviceId}/files/write`}</code>
              . The daemon also pulls remote changes every 30s.
            </p>
          </li>
        </ol>

        <div className="mt-5 flex justify-end gap-2">
          {variant === "vscode" && (
            <Button variant="secondary" size="sm" onClick={downloadWorkspace}>
              Download workspace
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
