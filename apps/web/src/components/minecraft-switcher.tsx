"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gamepad2, AlertTriangle, ChevronRight, RefreshCcw, Package, Cpu, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { useApi } from "@/hooks/useApi";
import { servicesApi } from "@/lib/api";
import {
  activeBackupCount,
  backupStorageLabel,
  hasBackupAllocation,
} from "@/lib/allocations";
import type { Service } from "@/lib/types";
import { isMinecraftGame } from "@/lib/game-service";

type FrameworkCategory = "plugins" | "mods" | "hybrid" | "vanilla";

interface Framework {
  id: string;
  category: FrameworkCategory;
  short: string;
  detail: string;
  minMC?: string;
}

const FRAMEWORKS: Framework[] = [
  {
    id: "Paper",
    category: "plugins",
    short: "High-performance Spigot fork",
    detail:
      "The most widely used server software. Supports all Bukkit/Spigot plugins. Excellent performance, huge ecosystem. Recommended for plugin servers.",
    minMC: "1.8",
  },
  {
    id: "Purpur",
    category: "plugins",
    short: "Paper fork with extra configuration",
    detail:
      "Drops in as a Paper replacement. Every vanilla and Paper behaviour is configurable per-mob, per-item, per-world. Plugin compatible with Paper.",
    minMC: "1.14",
  },
  {
    id: "Vanilla",
    category: "vanilla",
    short: "Official Mojang server — no mods",
    detail:
      "The unmodified Mojang server. No plugins, no mods. Useful for vanilla events, vanilla testing, or SMP servers that want no modifications.",
  },
  {
    id: "Fabric",
    category: "mods",
    short: "Lightweight modern mod loader",
    detail:
      "Fast-updating, lightweight modding platform. Most popular for technical/performance mods. Mods targeting Fabric API are incompatible with Forge/NeoForge.",
    minMC: "1.14",
  },
  {
    id: "Forge",
    category: "mods",
    short: "Classic mod loader — huge modpack ecosystem",
    detail:
      "The original Minecraft modding framework. Best-in-class for large modpacks (FTB, CurseForge). Dominant for 1.20.1 and older. Being superseded by NeoForge on 1.20.2+.",
    minMC: "1.1",
  },
  {
    id: "NeoForge",
    category: "mods",
    short: "Forge successor for 1.20.2+",
    detail:
      "Community fork of Forge with a modernised API. The preferred mod loader for 1.20.2 and newer. Not all Forge mods are compatible without porting.",
    minMC: "1.20.2",
  },
  {
    id: "Quilt",
    category: "mods",
    short: "Fabric fork — compatible with most Fabric mods",
    detail:
      "Built on Fabric's toolchain but with additional hooks and better library support. Compatible with the vast majority of Fabric mods. Smaller ecosystem than Fabric.",
    minMC: "1.18.2",
  },
  {
    id: "Mohist",
    category: "hybrid",
    short: "Forge + Paper hybrid",
    detail:
      "Run Forge mods AND Bukkit/Spigot plugins simultaneously. Useful for modpacks that still need essential plugins (EssentialsX, LuckPerms, etc.). Expect some compatibility issues with cutting-edge mods.",
    minMC: "1.12.2",
  },
  {
    id: "Arclight",
    category: "hybrid",
    short: "Fabric (or Forge) + Paper hybrid",
    detail:
      "Combines Paper's plugin API with Fabric (modern MC) or Forge (older MC). Good for servers that want Fabric performance mods alongside plugins. Less tested than Mohist.",
    minMC: "1.16.5",
  },
];

function getCompatWarning(from: string, to: string): string | null {
  const fromFw = FRAMEWORKS.find((f) => f.id === from);
  const toFw = FRAMEWORKS.find((f) => f.id === to);
  if (!fromFw || !toFw) return null;
  if (fromFw.category === toFw.category) return null;
  if (fromFw.category === "vanilla" || toFw.category === "vanilla") return null;

  if (fromFw.category === "plugins" && toFw.category === "mods") {
    return `Your plugin JARs (in plugins/) will not load on ${to}. They won't be deleted — just ignored. World data is fully compatible.`;
  }
  if (fromFw.category === "mods" && toFw.category === "plugins") {
    return `Your mod JARs (in mods/) will not load on ${to}. Mods that added blocks/items to your world may cause missing-content errors. Back up first.`;
  }
  if (fromFw.category === "plugins" && toFw.category === "hybrid") {
    return `${to} loads plugins AND mods. Your existing plugins folder is compatible. Consider whether you need to re-add your mod JARs.`;
  }
  if (fromFw.category === "mods" && toFw.category === "hybrid") {
    return `${to} loads mods AND plugins. Your existing mods folder carries over. Expect minor incompatibilities — ${to} lags behind pure mod loaders on API coverage.`;
  }
  if (fromFw.category === "hybrid" && toFw.category === "plugins") {
    return `Switching to a plugin-only loader. Mod JARs will be ignored. Mods that placed blocks/entities in the world may cause chunk errors.`;
  }
  if (fromFw.category === "hybrid" && toFw.category === "mods") {
    return `Switching to a mod-only loader. Plugin JARs will be ignored. World data is compatible.`;
  }
  if (fromFw.category === "mods" && toFw.category === "mods") {
    const fabricFamily = ["Fabric", "Quilt"];
    const forgeFamily = ["Forge", "NeoForge"];
    const fromFabric = fabricFamily.includes(from);
    const toFabric = fabricFamily.includes(to);
    if (fromFabric !== toFabric) {
      return `${from} mods are NOT compatible with ${to}. The mods/ folder carries over but none of your current mods will load. Install ${to}-compatible mods after switching.`;
    }
    if (from === "Forge" && to === "NeoForge") {
      return `Many Forge mods work on NeoForge without changes. Some may need the NeoForge port. World data is compatible.`;
    }
    if (from === "NeoForge" && to === "Forge") {
      return `NeoForge-specific APIs are not available in Forge. Some mods may not load. World data is compatible.`;
    }
  }
  return null;
}

const CATEGORY_STYLE: Record<FrameworkCategory, string> = {
  plugins: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
  vanilla: "text-zinc-400 bg-zinc-500/10 border-zinc-500/25",
  mods: "text-blue-400 bg-blue-500/10 border-blue-500/25",
  hybrid: "text-amber-400 bg-amber-500/10 border-amber-500/25",
};

const CATEGORY_LABEL: Record<FrameworkCategory, string> = {
  plugins: "plugins",
  vanilla: "vanilla",
  mods: "mods",
  hybrid: "hybrid",
};

interface Props {
  service: Service;
  onSwitched: () => void;
}

export function MinecraftSwitcher({ service, onSwitched }: Props) {
  const isMc = isMinecraftGame(service);
  const currentFramework = service.config?.environment?.FRAMEWORK ?? "Paper";

  const { data: backups } = useApi(
    () => (isMc ? servicesApi.listBackups(service.id) : Promise.resolve([])),
    [service.id, isMc],
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [wantBackup, setWantBackup] = useState<boolean | null>(null);
  const [acknowledgeDataLoss, setAcknowledgeDataLoss] = useState(false);
  const [busy, setBusy] = useState(false);

  const maxBackups = service.resource_limits.max_backups ?? 0;
  const hasAllocation = hasBackupAllocation(service.resource_limits);
  const backupCount = activeBackupCount(backups);
  const atBackupLimit = hasAllocation && backupCount >= maxBackups;
  const canCreateBackup = hasAllocation && !atBackupLimit;

  const target = selected === currentFramework ? null : selected;
  const warning = target ? getCompatWarning(currentFramework, target) : null;
  const targetFw = FRAMEWORKS.find((f) => f.id === target);

  const needsDataLossAck = showConfirm && wantBackup === false;

  const canConfirmSwitch =
    wantBackup !== null &&
    (wantBackup ? canCreateBackup : acknowledgeDataLoss);

  const openConfirm = () => {
    setShowConfirm(true);
    setWantBackup(hasAllocation ? true : false);
    setAcknowledgeDataLoss(false);
  };

  const handleSwitch = async () => {
    if (!target || !canConfirmSwitch) return;

    if (wantBackup === true) {
      if (!canCreateBackup) {
        toast(
          hasAllocation
            ? `Backup limit reached (${backupCount}/${maxBackups}). Delete an old backup first.`
            : "Backups are not allocated for this server.",
          "error",
        );
        return;
      }
    }

    setBusy(true);
    try {
      if (wantBackup) {
        await servicesApi.createBackup(service.id);
        toast("World backup queued before framework switch", "info");
      }

      const running = ["RUNNING", "STARTING"].includes(service.status);
      if (running) {
        await servicesApi.stop(service.id);
        await new Promise((r) => setTimeout(r, 2500));
      }

      const nextEnv: Record<string, string> = {
        ...(service.config?.environment ?? {}),
        FRAMEWORK: target,
      };
      await servicesApi.updateEnv(service.id, nextEnv);

      await servicesApi.reinstall(service.id);

      toast(`Switching to ${target} — reinstall started`, "success");
      setSelected(null);
      setShowConfirm(false);
      setWantBackup(null);
      setAcknowledgeDataLoss(false);
      onSwitched();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Framework switch failed", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!isMc) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center gap-2">
        <Gamepad2 className="size-4 text-muted" />
        <h3 className="text-sm font-semibold text-foreground">Framework Switcher</h3>
        <span
          className={cn(
            "ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium",
            CATEGORY_STYLE[
              FRAMEWORKS.find((f) => f.id === currentFramework)?.category ?? "vanilla"
            ],
          )}
        >
          {currentFramework}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {FRAMEWORKS.map((fw) => {
          const isCurrent = fw.id === currentFramework;
          const isSelected = selected === fw.id && !isCurrent;
          return (
            <motion.button
              key={fw.id}
              type="button"
              whileTap={{ scale: 0.97 }}
              disabled={isCurrent}
              onClick={() => {
                setSelected(isSelected ? null : fw.id);
                setShowConfirm(false);
                setWantBackup(null);
                setAcknowledgeDataLoss(false);
              }}
              className={cn(
                "rounded-lg border p-3 text-left text-xs transition-colors",
                isCurrent
                  ? "cursor-default border-vivox-500/40 bg-vivox-500/10 text-vivox-400"
                  : isSelected
                    ? "border-vivox-500/60 bg-vivox-500/15 text-foreground shadow-[0_0_0_1px_theme(colors.vivox.500/0.3)]"
                    : "border-border bg-background text-muted hover:border-border/80 hover:text-foreground",
              )}
            >
              <p className="font-semibold">{fw.id}</p>
              <span
                className={cn(
                  "mt-1 inline-block rounded-full border px-1.5 py-px text-[9px]",
                  CATEGORY_STYLE[fw.category],
                )}
              >
                {CATEGORY_LABEL[fw.category]}
              </span>
              {isCurrent && <p className="mt-1 text-[9px] text-vivox-400/70">active</p>}
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {target && targetFw && (
          <motion.div
            key={target}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 overflow-hidden"
          >
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-start gap-2">
                <Package className="mt-0.5 size-3.5 shrink-0 text-muted" />
                <div>
                  <p className="text-xs font-medium text-foreground">{targetFw.id}</p>
                  <p className="mt-0.5 text-xs text-muted">{targetFw.detail}</p>
                  {targetFw.minMC && (
                    <p className="mt-1 text-[10px] text-subtle">Min MC version: {targetFw.minMC}</p>
                  )}
                </div>
              </div>
            </div>

            {warning && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 p-3"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                <p className="text-xs text-amber-300">{warning}</p>
              </motion.div>
            )}

            <div className="mt-2 flex items-start gap-2 rounded-lg border border-border bg-background/50 p-3">
              <Cpu className="mt-0.5 size-3.5 shrink-0 text-muted" />
              <p className="text-xs text-muted">
                World data in <code className="text-foreground">/mnt/server/world/</code> is{" "}
                <span className="text-emerald-400">always preserved</span>. Only the server JAR,
                framework files, and library folders are replaced.
              </p>
            </div>

            {!showConfirm ? (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={openConfirm}
              >
                Switch to {target}
                <ChevronRight className="size-3.5" />
              </Button>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 space-y-3 rounded-lg border border-amber-500/25 bg-amber-500/8 p-3"
              >
                <p className="text-xs text-amber-300">
                  This will{" "}
                  <strong className="text-amber-200">
                    stop the server, wipe framework files, and reinstall with {target}
                  </strong>
                  . The server will come back online after the install finishes.
                </p>

                <div className="rounded-lg border border-border bg-background/60 p-3">
                  <p className="text-xs font-medium text-foreground">
                    Create a backup before switching?
                  </p>
                  {!hasAllocation ? (
                    <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/8 p-2.5">
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-red-400" />
                      <p className="text-xs text-red-300">
                        This server has <strong>no backup allocation</strong> (max backups: 0).
                        If anything goes wrong during the switch, you may{" "}
                        <strong>lose world data permanently</strong>. Consider allocating backups
                        in server settings before switching.
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted">
                      {backupCount}/{maxBackups} backup slots used
                      {service.resource_limits.backup_storage
                        ? ` · stored at ${backupStorageLabel(service.resource_limits.backup_storage)}`
                        : ""}
                    </p>
                  )}

                  <div className="mt-2 flex flex-col gap-2">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                      <input
                        type="radio"
                        name={`backup-${service.id}`}
                        checked={wantBackup === true}
                        disabled={!canCreateBackup}
                        onChange={() => {
                          setWantBackup(true);
                          setAcknowledgeDataLoss(false);
                        }}
                        className="border-border"
                      />
                      <span className={!canCreateBackup ? "opacity-50" : ""}>
                        Yes — create a backup first
                        {!hasAllocation
                          ? " (not available — no allocation)"
                          : atBackupLimit
                            ? " (limit reached)"
                            : ""}
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                      <input
                        type="radio"
                        name={`backup-${service.id}`}
                        checked={wantBackup === false}
                        onChange={() => setWantBackup(false)}
                        className="border-border"
                      />
                      No — proceed without a backup
                    </label>
                  </div>

                  {wantBackup === true && atBackupLimit && (
                    <p className="mt-2 text-xs text-amber-400">
                      Delete an existing backup from the Backups tab or choose to proceed without
                      one.
                    </p>
                  )}
                </div>

                {needsDataLossAck && (
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-red-500/25 bg-red-500/8 p-3 text-xs text-red-300">
                    <input
                      type="checkbox"
                      checked={acknowledgeDataLoss}
                      onChange={(e) => setAcknowledgeDataLoss(e.target.checked)}
                      className="mt-0.5 rounded border-border"
                    />
                    <span>
                      I understand that without a backup I may lose world data permanently if the
                      reinstall fails or mod/plugin incompatibilities corrupt the world.
                    </span>
                  </label>
                )}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    actionType="restart"
                    loading={busy}
                    disabled={!canConfirmSwitch}
                    onClick={() => void handleSwitch()}
                  >
                    <RefreshCcw className="size-3.5" />
                    Confirm — switch to {target}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setShowConfirm(false);
                      setWantBackup(null);
                      setAcknowledgeDataLoss(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
