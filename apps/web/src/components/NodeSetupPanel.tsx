"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Copy, X } from "lucide-react";
import type { Node } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";

const GITHUB_RAW_URL =
  "https://raw.githubusercontent.com/your-org/vivox/main";

type SetupTab = "docker" | "systemd" | "env" | "quickinstall";

interface Props {
  node: Node;
  token: string;
  onClose: () => void;
}

function defaultApiHost(): string {
  if (typeof window === "undefined") return "localhost:9090";
  return `${window.location.hostname}:9090`;
}

export function NodeSetupPanel({ node, token, onClose }: Props) {
  const [tab, setTab] = useState<SetupTab>("quickinstall");
  const [apiHost, setApiHost] = useState(defaultApiHost);

  const quickInstallContent = useMemo(() => {
    const panelUrl =
      typeof window !== "undefined"
        ? `${window.location.protocol}//${window.location.hostname}`
        : "https://your-panel-domain";
    return [
      `bash <(curl -fsSL ${GITHUB_RAW_URL}/infra/scripts/install-node.sh) \\`,
      `  --panel-url ${panelUrl} \\`,
      `  --token ${token} \\`,
      `  --node-id ${node.id}`,
    ].join("\n");
  }, [token, node.id]);

  const envContent = useMemo(
    () =>
      [
        `NEXUS_CONTROL_ADDR=${apiHost}`,
        `NEXUS_AGENT_ID=${node.id}`,
        `NEXUS_AGENT_TOKEN=${token}`,
        "NEXUS_AGENT_INSECURE=true",
        "NEXUS_AGENT_HEALTH_ADDR=:8082",
      ].join("\n"),
    [apiHost, node.id, token],
  );

  const dockerContent = useMemo(
    () =>
      [
        "docker run -d --restart unless-stopped \\",
        "  --name nexus-agent \\",
        `  -e NEXUS_CONTROL_ADDR=${apiHost} \\`,
        `  -e NEXUS_AGENT_ID=${node.id} \\`,
        `  -e NEXUS_AGENT_TOKEN=${token} \\`,
        "  -e NEXUS_AGENT_INSECURE=true \\",
        "  -v /var/run/docker.sock:/var/run/docker.sock \\",
        "  ghcr.io/nexus-control/agent:latest",
      ].join("\n"),
    [apiHost, node.id, token],
  );

  const systemdContent = useMemo(
    () =>
      [
        "[Unit]",
        "Description=Vivox Edge Agent",
        "After=network-online.target docker.service",
        "Wants=network-online.target",
        "",
        "[Service]",
        "Type=simple",
        "Restart=always",
        "RestartSec=5",
        "EnvironmentFile=/etc/nexus-agent/env",
        "ExecStart=/usr/local/bin/nexus-agent -config /etc/nexus-agent/nexus-agent.yaml",
        "",
        "[Install]",
        "WantedBy=multi-user.target",
        "",
        "# /etc/nexus-agent/nexus-agent.yaml",
        'addr: "' + apiHost + '"',
        'agent_id: "' + node.id + '"',
        'token: "' + token + '"',
        "insecure: true",
        'health_addr: ":8082"',
      ].join("\n"),
    [apiHost, node.id, token],
  );

  const tabContent: Record<SetupTab, string> = {
    quickinstall: quickInstallContent,
    docker: dockerContent,
    systemd: systemdContent,
    env: envContent,
  };

  const copyTab = async () => {
    try {
      await navigator.clipboard.writeText(tabContent[tab]);
      toast("Copied to clipboard", "success");
    } catch {
      toast("Copy failed", "error");
    }
  };

  const tabs: { id: SetupTab; label: string }[] = [
    { id: "quickinstall", label: "⚡ Quick Install" },
    { id: "docker", label: "Docker" },
    { id: "systemd", label: "Systemd" },
    { id: "env", label: "Env File" },
  ];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">Agent Setup</h2>
              <p className="mt-0.5 text-sm text-zinc-400">
                Node: <span className="font-mono text-zinc-200">{node.name}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="border-b border-amber-500/20 bg-amber-500/10 px-5 py-3">
            <p className="flex items-center gap-2 text-sm text-amber-200">
              <AlertTriangle className="size-4 shrink-0" />
              Token shown once — save it now before closing this panel.
            </p>
          </div>

          <div className="space-y-3 px-5 py-4">
            <label className="flex flex-col gap-1.5 text-xs text-zinc-500">
              Control plane gRPC address
              <input
                value={apiHost}
                onChange={(e) => setApiHost(e.target.value)}
                className="h-9 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 font-mono text-sm text-zinc-100 outline-none focus:border-zinc-700"
                placeholder="your-api-host:9090"
              />
            </label>

            <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950/50 p-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-sm transition-colors",
                    tab === t.id
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <pre className="max-h-64 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
              {tabContent[tab]}
            </pre>
            {tab === "quickinstall" && (
              <p className="text-xs text-zinc-500">
                Run this command on the edge node to install the agent and connect it to this panel.
                Requires: Docker, git. The script installs everything else automatically.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-4">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button actionType="copy" onClick={() => void copyTab()}>
              <Copy className="size-4" />
              Copy
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
