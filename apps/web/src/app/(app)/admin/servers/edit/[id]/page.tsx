"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Power,
} from "lucide-react";
import { adminApi, servicesApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useSession } from "@/lib/auth-client";
import type { Customer, PortMapping, Service } from "@/lib/types";
import { UserCombobox } from "@/components/user-combobox";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Skeleton } from "@/components/ui/states";
import { StatusBadge } from "@/components/status-badge";
import { toast } from "@/hooks/useToast";
import { isTransient } from "@/lib/status";
import {
  formatPortBinding,
  isValidHostIp,
  mappingToPortBinding,
  parsePortBinding,
  portBindingToMapping,
  type PortBinding,
} from "@/lib/ports";

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-background/50 px-3 font-mono text-sm text-foreground outline-none transition-all duration-200 focus:border-border-focus focus:ring-1 focus:ring-border-focus";

function bindingsFromService(service: Service): PortBinding[] {
  const mappings = service.config.port_mappings;
  if (mappings?.length) {
    return mappings.map((m) => mappingToPortBinding(m));
  }
  return (service.config.ports ?? []).map((p) => parsePortBinding(p));
}

export default function AdminServerEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const { data: service, loading, error, refetch } = useApi<Service>(
    () => servicesApi.get(id),
    [id],
  );
  const { data: users } = useApi<Customer[]>(() => adminApi.customers(), []);

  const [ownerId, setOwnerId] = useState("");
  const [memMB, setMemMB] = useState(0);
  const [cpuShares, setCpuShares] = useState(0);
  const [diskGB, setDiskGB] = useState(0);
  const [bindings, setBindings] = useState<PortBinding[]>([]);
  const [mainPortIndex, setMainPortIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!service) return;
    setOwnerId(service.owner_id);
    setMemMB(service.resource_limits.memory_mb);
    setCpuShares(service.resource_limits.cpu_shares);
    setDiskGB(service.resource_limits.disk_gb);
    const b = bindingsFromService(service);
    setBindings(b.length ? b : [{ hostIp: "0.0.0.0", host: 0, container: 0, proto: "tcp" }]);
    const main = service.config.main_port;
    const idx = main
      ? b.findIndex((x) => x.container === main)
      : b.findIndex((x) => x.alias === "main");
    setMainPortIndex(idx >= 0 ? idx : 0);
  }, [service]);

  const userMap = useMemo(() => {
    const m = new Map<string, Customer>();
    for (const u of users ?? []) m.set(u.id, u);
    return m;
  }, [users]);

  const save = async () => {
    if (!service) return;
    setSaving(true);
    try {
      const port_mappings: PortMapping[] = bindings.map((b, i) => ({
        ...portBindingToMapping(b),
        alias: i === mainPortIndex ? "main" : b.alias?.trim() || undefined,
      }));
      const ports = bindings.map(formatPortBinding);
      const mainBinding = bindings[mainPortIndex];
      await adminApi.updateService(service.id, {
        owner_id: ownerId,
        resource_limits: {
          ...service.resource_limits,
          memory_mb: memMB,
          cpu_shares: cpuShares,
          disk_gb: diskGB,
        },
        ports,
        port_mappings,
        main_port: mainBinding?.container,
      });
      toast("Server updated", "success");
      void refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      toast(success, "success");
      if (key === "delete" || key === "force-delete") {
        router.push("/admin/servers");
        return;
      }
      void refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  };

  if (role !== undefined && role !== "admin") {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <p className="text-sm text-muted">Admin access required.</p>
      </div>
    );
  }

  if (loading && !service) return <Skeleton className="h-64" />;
  if (error && !service) return <ErrorBanner message={`Could not load server (${error})`} />;
  if (!service) return null;

  const locked = isTransient(service.status);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link
        href="/admin/servers"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to servers
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{service.name}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            <StatusBadge status={service.status} />
            <span className="capitalize">{service.type}</span>
          </p>
        </div>
        <Link
          href={`/services/${service.id}/overview`}
          className="inline-flex items-center gap-1 text-sm text-vivox-500 hover:text-vivox-400"
        >
          Open panel <ExternalLink className="size-3.5" />
        </Link>
      </div>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-medium text-foreground">Owner</h2>
        <p className="mt-1 text-xs text-muted">
          Current: {userMap.get(ownerId)?.email ?? ownerId}
        </p>
        <div className="mt-3">
          <UserCombobox users={users ?? []} value={ownerId} onChange={setOwnerId} />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-medium text-foreground">Resource limits</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LimitInput label="Memory (MB)" value={memMB} onChange={setMemMB} />
          <LimitInput label="CPU shares" value={cpuShares} onChange={setCpuShares} />
          <LimitInput label="Disk (GB)" value={diskGB} onChange={setDiskGB} />
        </div>
        <p className="mt-2 text-xs text-muted">Applied on next restart.</p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">Ports</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setBindings((prev) => [
                ...prev,
                { hostIp: "0.0.0.0", host: 0, container: 0, proto: "tcp" },
              ])
            }
          >
            <Plus className="size-3.5" /> Add port
          </Button>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {bindings.map((b, i) => (
            <div
              key={i}
              className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-background/40 p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"
            >
              <input
                value={b.hostIp}
                onChange={(e) =>
                  setBindings((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, hostIp: e.target.value } : x)),
                  )
                }
                placeholder="0.0.0.0"
                className={inputClass}
              />
              <input
                type="number"
                value={b.host || ""}
                onChange={(e) =>
                  setBindings((prev) =>
                    prev.map((x, j) =>
                      j === i ? { ...x, host: Number(e.target.value) } : x,
                    ),
                  )
                }
                placeholder="Host"
                className={inputClass}
              />
              <input
                type="number"
                value={b.container || ""}
                onChange={(e) =>
                  setBindings((prev) =>
                    prev.map((x, j) =>
                      j === i ? { ...x, container: Number(e.target.value) } : x,
                    ),
                  )
                }
                placeholder="Container"
                className={inputClass}
              />
              <select
                value={b.proto || "tcp"}
                onChange={(e) =>
                  setBindings((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, proto: e.target.value } : x)),
                  )
                }
                className={inputClass}
              >
                <option value="tcp">tcp</option>
                <option value="udp">udp</option>
              </select>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input
                    type="radio"
                    name="main-port"
                    checked={mainPortIndex === i}
                    onChange={() => setMainPortIndex(i)}
                  />
                  Main
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={bindings.length <= 1}
                  onClick={() => {
                    setBindings((prev) => prev.filter((_, j) => j !== i));
                    setMainPortIndex((m) => (m >= i && m > 0 ? m - 1 : m));
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        {bindings.some((b) => !isValidHostIp(b.hostIp)) && (
          <p className="mt-2 text-xs text-red-400">Invalid bind IP on one or more ports.</p>
        )}
      </section>

      <div className="flex justify-end">
        <Button
          actionType="save"
          onClick={() => void save()}
          loading={saving}
          disabled={
            locked ||
            memMB <= 0 ||
            cpuShares <= 0 ||
            diskGB <= 0 ||
            bindings.some((b) => !isValidHostIp(b.hostIp))
          }
        >
          <Save className="size-3.5" /> Save changes
        </Button>
      </div>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-xs uppercase tracking-wider text-muted">Admin actions</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={busy === "reinstall"}
            disabled={locked || !!busy}
            onClick={() =>
              runAction("reinstall", () => servicesApi.redeploy(service.id), "Reinstall queued")
            }
          >
            <RefreshCw className="size-3.5" /> Reinstall
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === "force-reinstall"}
            disabled={!!busy}
            onClick={() =>
              runAction(
                "force-reinstall",
                () => servicesApi.reinstall(service.id),
                "Force reinstall queued",
              )
            }
          >
            <RefreshCw className="size-3.5" /> Force reinstall
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === "reset"}
            disabled={locked || !!busy}
            onClick={() =>
              runAction("reset", () => servicesApi.restart(service.id), "Restart sent")
            }
          >
            <RotateCcw className="size-3.5" /> Reset
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === "force-reset"}
            disabled={!!busy}
            onClick={() =>
              runAction("force-reset", async () => {
                await servicesApi.stop(service.id);
                await servicesApi.redeploy(service.id);
              }, "Stop + redeploy queued")
            }
          >
            <Power className="size-3.5" /> Force reset
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={busy === "delete"}
            disabled={locked || !!busy}
            onClick={() => {
              if (!confirm(`Delete "${service.name}"?`)) return;
              void runAction("delete", () => servicesApi.remove(service.id), "Server deleted");
            }}
          >
            <Trash2 className="size-3.5" /> Delete
          </Button>
        </div>
      </section>
    </div>
  );
}

function LimitInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider text-muted">{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={inputClass}
      />
    </label>
  );
}
