"use client";

import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  Rocket,
  Server,
  Settings,
  SunMoon,
  Boxes,
  Search,
  CornerDownLeft,
  Play,
  Square,
  RotateCcw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { servicesApi } from "@/lib/api";
import { toast } from "@/hooks/useToast";
import { STATUS_META } from "@/lib/status";
import type { Service } from "@/lib/types";
import { useCommandPalette } from "./command-palette-provider";
import { useTheme } from "./theme-provider";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const router = useRouter();
  const { toggleTheme } = useTheme();
  const { contextServiceId } = useCommandPalette();
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    servicesApi
      .list()
      .then((data) => {
        if (!cancelled) setServices(data);
      })
      .catch(() => {
        /* API may be offline; palette still offers navigation actions. */
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const run = (action: () => void) => {
    onOpenChange(false);
    requestAnimationFrame(action);
  };

  const runServiceAction = async (
    action: "start" | "stop" | "restart",
    successMessage: string,
  ) => {
    if (!contextServiceId) return;
    onOpenChange(false);
    try {
      if (action === "start") await servicesApi.start(contextServiceId);
      else if (action === "stop") await servicesApi.stop(contextServiceId);
      else await servicesApi.restart(contextServiceId);
      toast(successMessage, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[14vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
            aria-hidden
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="relative w-full max-w-xl"
          >
            <Command label="Command palette" className="glass-raised overflow-hidden rounded-2xl border border-border shadow-2xl">
              <div className="flex items-center gap-3 border-b border-border px-4">
                <Search className="size-4 shrink-0 text-muted" />
                <Command.Input
                  autoFocus
                  placeholder="Search servers or run a command…"
                  className="h-14 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
                />
                <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted sm:block">
                  ESC
                </kbd>
              </div>

              <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-10 text-center text-sm text-muted">
                  No results found.
                </Command.Empty>

                {contextServiceId && (
                  <Command.Group
                    heading="Service actions"
                    className="px-1 py-1 text-[11px] font-medium uppercase tracking-wider text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    <PaletteItem
                      icon={<Play className="size-4" />}
                      label="Start service"
                      onSelect={() => void runServiceAction("start", "Service started")}
                    />
                    <PaletteItem
                      icon={<Square className="size-4" />}
                      label="Stop service"
                      onSelect={() => void runServiceAction("stop", "Service stopped")}
                    />
                    <PaletteItem
                      icon={<RotateCcw className="size-4" />}
                      label="Restart service"
                      onSelect={() => void runServiceAction("restart", "Service restarted")}
                    />
                  </Command.Group>
                )}

                <Command.Group
                  heading="Navigate"
                  className="px-1 py-1 text-[11px] font-medium uppercase tracking-wider text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                >
                  <PaletteItem
                    icon={<LayoutDashboard className="size-4" />}
                    label="My Servers"
                    shortcut="G D"
                    onSelect={() => run(() => router.push("/dashboard"))}
                  />
                  <PaletteItem
                    icon={<LayoutDashboard className="size-4" />}
                    label="Admin · Dashboard"
                    onSelect={() => run(() => router.push("/admin/dashboard"))}
                  />
                  <PaletteItem
                    icon={<Boxes className="size-4" />}
                    label="Admin · Servers"
                    onSelect={() => run(() => router.push("/admin/servers"))}
                  />
                  <PaletteItem
                    icon={<Rocket className="size-4" />}
                    label="Deploy a new service"
                    shortcut="G N"
                    onSelect={() => run(() => router.push("/deploy"))}
                  />
                  <PaletteItem
                    icon={<Server className="size-4" />}
                    label="Admin · Nodes"
                    onSelect={() => run(() => router.push("/admin/nodes"))}
                  />
                  <PaletteItem
                    icon={<Settings className="size-4" />}
                    label="Settings"
                    onSelect={() => run(() => router.push("/settings"))}
                  />
                  <PaletteItem
                    icon={<SunMoon className="size-4" />}
                    label="Toggle theme"
                    onSelect={() => run(toggleTheme)}
                  />
                </Command.Group>

                {services.length > 0 && (
                  <Command.Group
                    heading="Services"
                    className="px-1 py-1 text-[11px] font-medium uppercase tracking-wider text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {services.map((svc) => (
                      <PaletteItem
                        key={svc.id}
                        value={`${svc.name} ${svc.type} ${svc.status} ${(svc.tags ?? []).join(" ")}`}
                        icon={<Boxes className="size-4" />}
                        label={svc.name}
                        meta={
                          <span className="flex flex-col items-end gap-0.5">
                            {(svc.tags ?? []).length > 0 && (
                              <span className="text-[10px] text-muted">
                                {(svc.tags ?? []).slice(0, 3).join(" · ")}
                              </span>
                            )}
                            <span
                              className="flex items-center gap-1.5 text-xs"
                              style={{ color: `rgb(var(--status-${svc.status.toLowerCase()}))` }}
                            >
                              <span className="size-1.5 rounded-full bg-current" />
                              {STATUS_META[svc.status].label}
                            </span>
                          </span>
                        }
                        onSelect={() => run(() => router.push(`/services/${svc.id}`))}
                      />
                    ))}
                  </Command.Group>
                )}
              </Command.List>

              <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[11px] text-muted">
                <span className="flex items-center gap-1.5">
                  <CornerDownLeft className="size-3" /> to select
                </span>
                <span className="font-mono">Vivox</span>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PaletteItem({
  icon,
  label,
  meta,
  shortcut,
  value,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  meta?: ReactNode;
  shortcut?: string;
  value?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value ?? label}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted transition-all duration-200 data-[selected=true]:bg-[#1f1f23] data-[selected=true]:text-foreground"
    >
      <span className="text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {meta}
      {shortcut && (
        <kbd className="font-mono text-[10px] tracking-widest text-muted">{shortcut}</kbd>
      )}
    </Command.Item>
  );
}
