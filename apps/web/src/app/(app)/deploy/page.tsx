"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Gamepad2,
  Container,
  Globe,
  Check,
  ArrowRight,
  ArrowLeft,
  Rocket,
  Info,
  Plus,
  Trash2,
} from "lucide-react";
import { adminApi, nodesApi, servicesApi, templatesApi } from "@/lib/api";
import { DEPLOY_TEMPLATES } from "@/lib/templates";
import type {
  ApiTemplate,
  CreateServiceInput,
  DeployTemplate,
  ServiceType,
} from "@/lib/types";
import type { PortBinding } from "@/lib/ports";
import { useApi } from "@/hooks/useApi";
import { toast } from "@/hooks/useToast";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth-client";
import { UserCombobox } from "@/components/user-combobox";
import { TemplateInfoDialog } from "@/components/template-info-dialog";
import {
  collectUsedHostPorts,
  formatPortBinding,
  isPortAvailable,
  isValidHostIp,
  parsePortBinding,
  portBindingToMapping,
} from "@/lib/ports";

const TYPE_ICON: Record<ServiceType, typeof Container> = {
  game: Gamepad2,
  docker: Container,
  static: Globe,
  database: Container,
};

type Step = 0 | 1 | 2 | 3;
const STEP_LABELS = ["Template", "Configure", "Environment", "Review"];

function allowsPortConfig(type: ServiceType): boolean {
  return type === "docker" || type === "static";
}

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-background/50 px-3 text-sm text-foreground outline-none transition-all duration-200 focus:border-border-focus focus:ring-1 focus:ring-border-focus";

const numInputClass = cn(inputClass, "font-mono");

function apiTemplateToDeployTemplate(t: ApiTemplate): DeployTemplate {
  const type: ServiceType =
    t.type === "game" || t.type === "docker" || t.type === "static" || t.type === "database"
      ? t.type
      : "docker";

  const envFields = (t.configurable ?? [])
    .filter((f) => f.env)
    .map((f) => ({
      key: f.env,
      label: f.label,
      value: f.default,
      description: f.description,
      options: f.options,
    }));

  const staticEnv = Object.entries(t.env ?? {}).map(([key, value]) => ({
    key,
    label: key,
    value,
    required: key === "EULA",
    description: undefined as string | undefined,
    options: undefined as string | undefined,
  }));

  const cpuThreads = t.resources?.cpu_shares
    ? Math.max(1, Math.round(t.resources.cpu_shares / 1024))
    : 1;

  return {
    id: t.id,
    name: t.name,
    type,
    description: t.description,
    defaultImage: t.image,
    defaultPorts: t.ports ?? [],
    defaultStartupCmd: t.startup_cmd,
    defaultMemoryMb: t.resources?.memory_mb ?? 512,
    defaultCpuThreads: cpuThreads,
    defaultDiskGb: t.resources?.disk_gb ?? 5,
    env: [...staticEnv, ...envFields],
  };
}

function initialPortBindings(template: DeployTemplate): PortBinding[] {
  if (template.defaultPorts.length > 0) {
    return template.defaultPorts.map(parsePortBinding);
  }
  return [{ hostIp: "0.0.0.0", host: 8080, container: 80, proto: "tcp" }];
}

export default function DeployPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const forUserId = searchParams.get("for") ?? undefined;
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === "admin";

  useEffect(() => {
    if (session && !isAdmin) {
      router.replace("/dashboard");
    }
  }, [session, isAdmin, router]);

  const { data: apiTemplates, loading: templatesLoading } = useApi(
    () => templatesApi.list(),
    [],
  );
  const { data: nodes } = useApi(() => nodesApi.list(), []);
  const { data: customers } = useApi(() => adminApi.customers(), []);

  const templates = useMemo(() => {
    if (apiTemplates && apiTemplates.length > 0) {
      return apiTemplates.map(apiTemplateToDeployTemplate);
    }
    return DEPLOY_TEMPLATES;
  }, [apiTemplates]);

  const [step, setStep] = useState<Step>(0);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [infoTemplate, setInfoTemplate] = useState<DeployTemplate | null>(null);
  const [name, setName] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [ownerId, setOwnerId] = useState(forUserId ?? "");
  const [image, setImage] = useState("");
  const [env, setEnv] = useState<Record<string, string>>({});
  const [startupCmd, setStartupCmd] = useState("");
  const [memoryMb, setMemoryMb] = useState(2048);
  const [cpuThreads, setCpuThreads] = useState(1);
  const [diskGb, setDiskGb] = useState(10);
  const [portBindings, setPortBindings] = useState<PortBinding[]>([]);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = useMemo(
    () => (templateId ? templates.find((t) => t.id === templateId) : undefined),
    [templateId, templates],
  );

  const { data: nodeServices } = useApi(
    () => (nodeId ? nodesApi.services(nodeId) : Promise.resolve([])),
    [nodeId],
  );

  const usedHostPorts = useMemo(
    () => collectUsedHostPorts(nodeServices ?? []),
    [nodeServices],
  );

  const selectedHostPorts = portBindings.map((b) => b.host);

  const portErrors = useMemo(() => {
    return portBindings.map((b) =>
      isPortAvailable(b.host, usedHostPorts, selectedHostPorts),
    );
  }, [portBindings, usedHostPorts, selectedHostPorts]);

  useEffect(() => {
    if (forUserId) setOwnerId(forUserId);
    else if (session?.user?.id) setOwnerId(session.user.id);
  }, [forUserId, session?.user?.id]);

  useEffect(() => {
    if (!nodeId && nodes && nodes.length > 0) {
      setNodeId(nodes[0].id);
    }
  }, [nodes, nodeId]);

  const selectTemplate = (t: DeployTemplate) => {
    setTemplateId(t.id);
    setImage(t.defaultImage);
    setEnv(Object.fromEntries(t.env.map((e) => [e.key, e.value])));
    setStartupCmd("");
    setMemoryMb(t.defaultMemoryMb ?? 2048);
    setCpuThreads(t.defaultCpuThreads ?? 1);
    setDiskGb(t.defaultDiskGb ?? 10);
    setPortBindings(initialPortBindings(t));
    setStep(1);
  };

  const canConfigure =
    name.trim().length >= 2 &&
    !!nodeId &&
    (template?.type !== "docker" || image.trim().length > 0) &&
    portBindings.length > 0 &&
    portBindings.every(
      (b) => b.host > 0 && b.container > 0 && isValidHostIp(b.hostIp),
    ) &&
    portErrors.every((e) => e === null) &&
    memoryMb > 0 &&
    cpuThreads > 0 &&
    diskGb > 0;

  const deploy = async () => {
    if (!template) return;
    setDeploying(true);
    setError(null);

    const ports = portBindings.map(formatPortBinding);
    const port_mappings = portBindings.map(portBindingToMapping);
    const input: CreateServiceInput = {
      name: name.trim(),
      type: template.type,
      node_id: nodeId,
      config: {
        image: image.trim() || template.defaultImage,
        ports,
        port_mappings,
        environment: env,
        ...(startupCmd.trim() ? { startup_cmd: startupCmd.trim() } : {}),
      },
      resource_limits: {
        cpu_shares: cpuThreads * 1024,
        memory_mb: memoryMb,
        disk_gb: diskGb,
      },
      ...(ownerId ? { owner_id: ownerId } : {}),
    };

    try {
      const service = await servicesApi.create(input);
      toast("Deployment queued!", "success");
      router.push(ownerId && ownerId !== session?.user?.id ? "/admin/users" : `/services/${service.id}`);
    } catch (e) {
      const errorMsg =
        e instanceof Error
          ? `${e.message}. The control plane API may be offline.`
          : "Deploy failed";
      setError(errorMsg);
      toast(errorMsg, "error");
      setDeploying(false);
    }
  };

  const updateBinding = (index: number, patch: Partial<PortBinding>) => {
    setPortBindings((prev) =>
      prev.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    );
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Deploy a server</h1>
      </div>

      {forUserId && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-400">
          Creating service on behalf of a customer
        </div>
      )}

      <Stepper step={step} />

      {error && <ErrorBanner message={error} />}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          {step === 0 &&
            (templatesLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-[120px]" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {templates.map((t) => {
                  const Icon = TYPE_ICON[t.type];
                  return (
                    <div key={t.id} className="relative">
                      <button
                        type="button"
                        onClick={() => selectTemplate(t)}
                        className="group flex w-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-left transition-all duration-200 hover:border-border-focus"
                      >
                        <span className="grid size-9 place-items-center rounded-lg bg-vivox-500/15 text-vivox-400">
                          <Icon className="size-4" />
                        </span>
                        <div>
                          <h3 className="text-sm font-medium text-foreground">{t.name}</h3>
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{t.description}</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        aria-label={`Info about ${t.name}`}
                        onClick={() => setInfoTemplate(t)}
                        className="absolute right-2 top-2 rounded-md p-1.5 text-muted hover:bg-surface-raised hover:text-foreground"
                      >
                        <Info className="size-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}

          {step === 1 && template && (
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Labeled label="Service name">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="my-server"
                    className={inputClass}
                  />
                </Labeled>
                <Labeled label="Node">
                  <select
                    value={nodeId}
                    onChange={(e) => setNodeId(e.target.value)}
                    className={inputClass}
                  >
                    {(nodes ?? []).length === 0 ? (
                      <option value="">No nodes — register one first</option>
                    ) : (
                      (nodes ?? []).map((n) => (
                        <option key={n.id} value={n.id} className="bg-surface">
                          {n.name}
                          {n.online ? " · online" : " · offline"}
                        </option>
                      ))
                    )}
                  </select>
                </Labeled>
              </div>

              <Labeled label="Owner">
                <UserCombobox
                  users={customers ?? []}
                  value={ownerId}
                  onChange={setOwnerId}
                />
              </Labeled>

              {template.type === "docker" && (
                <Labeled label="Docker image">
                  <input
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    placeholder="nginx:latest"
                    className={cn(inputClass, "font-mono")}
                  />
                </Labeled>
              )}

              <Labeled label="Published ports (bind IP, host port, container port)">
                <div className="flex flex-col gap-3">
                  {portBindings.map((b, i) => (
                    <div key={i} className="rounded-lg border border-border bg-background/40 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={b.hostIp}
                          onChange={(e) => updateBinding(i, { hostIp: e.target.value })}
                          className={cn(numInputClass, "w-32 font-mono")}
                          placeholder="0.0.0.0"
                          title="Bind IP (0.0.0.0 = all interfaces)"
                        />
                        <span className="text-subtle">:</span>
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          value={b.host || ""}
                          onChange={(e) => updateBinding(i, { host: Number(e.target.value) })}
                          className={cn(numInputClass, "w-24")}
                          placeholder="Host"
                        />
                        <span className="text-subtle">→</span>
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          value={b.container || ""}
                          onChange={(e) => updateBinding(i, { container: Number(e.target.value) })}
                          className={cn(numInputClass, "w-24")}
                          placeholder="Container"
                        />
                        {allowsPortConfig(template.type) && portBindings.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setPortBindings((p) => p.filter((_, idx) => idx !== i))
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted">Alias (optional)</span>
                        <input
                          value={b.alias ?? ""}
                          onChange={(e) => updateBinding(i, { alias: e.target.value })}
                          className={cn(inputClass, "h-8 max-w-xs font-mono text-xs")}
                          placeholder="e.g. game, web"
                        />
                      </div>
                      {!isValidHostIp(b.hostIp) && (
                        <span className="mt-1 block text-xs text-red-400">Invalid bind IP</span>
                      )}
                      {portErrors[i] && (
                        <span className="mt-1 block text-xs text-red-400">{portErrors[i]}</span>
                      )}
                    </div>
                  ))}
                  {allowsPortConfig(template.type) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      onClick={() =>
                        setPortBindings((p) => [
                          ...p,
                          { hostIp: "0.0.0.0", host: 8081, container: 80, proto: "tcp" },
                        ])
                      }
                    >
                      <Plus className="size-3.5" /> Add port
                    </Button>
                  )}
                  {usedHostPorts.size > 0 && (
                    <p className="text-xs text-muted">
                      In use on node:{" "}
                      {[...usedHostPorts].sort((a, b) => a - b).join(", ")}
                    </p>
                  )}
                </div>
              </Labeled>

              <div className="grid gap-3 sm:grid-cols-3">
                <Labeled label="Memory (MB)">
                  <input
                    type="number"
                    min={128}
                    step={128}
                    value={memoryMb}
                    onChange={(e) => setMemoryMb(Number(e.target.value))}
                    className={numInputClass}
                  />
                </Labeled>
                <Labeled label="CPU threads (1 = 100%)">
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={cpuThreads}
                    onChange={(e) => setCpuThreads(Number(e.target.value))}
                    className={numInputClass}
                  />
                </Labeled>
                <Labeled label="Max storage (GB)">
                  <input
                    type="number"
                    min={1}
                    value={diskGb}
                    onChange={(e) => setDiskGb(Number(e.target.value))}
                    className={numInputClass}
                  />
                </Labeled>
              </div>

              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" size="sm" onClick={() => setStep(0)}>
                  <ArrowLeft className="size-4" /> Back
                </Button>
                <Button size="sm" disabled={!canConfigure} onClick={() => setStep(2)}>
                  Environment <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && template && (
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
              <Labeled label="Startup command">
                <p className="text-xs text-muted">
                  Default:{" "}
                  <span className="font-mono text-muted">
                    {template.defaultStartupCmd || "Image entrypoint (automatic)"}
                  </span>
                </p>
                <input
                  value={startupCmd}
                  onChange={(e) => setStartupCmd(e.target.value)}
                  placeholder="Leave empty to use the default"
                  className={cn(inputClass, "mt-1 font-mono")}
                />
                <p className="text-xs text-subtle">This server&apos;s override (optional)</p>
              </Labeled>

              {template.env.length > 0 ? (
                <Labeled label="Environment variables">
                  <div className="flex flex-col gap-3">
                    {template.env.map((field) => (
                      <div key={field.key} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="w-24 shrink-0 font-mono text-xs uppercase text-muted">
                            {field.key}
                          </span>
                          <input
                            value={env[field.key] ?? ""}
                            onChange={(e) =>
                              setEnv((prev) => ({ ...prev, [field.key]: e.target.value }))
                            }
                            className="h-9 flex-1 rounded-lg border border-border bg-background/50 px-3 font-mono text-sm text-foreground outline-none focus:border-border-focus"
                          />
                        </div>
                        <p className="pl-24 text-xs text-muted">
                          {field.label}
                          {field.description ? ` — ${field.description}` : ""}
                          {field.options ? ` · Options: ${field.options}` : ""}
                          {` · Default: ${field.value}`}
                        </p>
                      </div>
                    ))}
                  </div>
                </Labeled>
              ) : (
                <p className="text-sm text-muted">No environment variables for this template.</p>
              )}

              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                  <ArrowLeft className="size-4" /> Back
                </Button>
                <Button size="sm" onClick={() => setStep(3)}>
                  Review <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 3 && template && (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Review</h3>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border text-sm">
                <ReviewRow label="Template" value={template.name} />
                <ReviewRow label="Name" value={name} />
                <ReviewRow
                  label="Node"
                  value={nodes?.find((n) => n.id === nodeId)?.name ?? nodeId}
                />
                <ReviewRow
                  label="Owner"
                  value={
                    customers?.find((c) => c.id === ownerId)?.email ??
                    (ownerId || "You")
                  }
                />
                <ReviewRow label="Image" value={image || template.defaultImage} />
                <ReviewRow label="Memory" value={`${memoryMb} MB`} />
                <ReviewRow label="CPU" value={`${cpuThreads} thread${cpuThreads === 1 ? "" : "s"}`} />
                <ReviewRow label="Storage" value={`${diskGb} GB`} />
                <ReviewRow
                  label="Ports"
                  value={portBindings
                    .map((b) => {
                      const base = formatPortBinding(b);
                      return b.alias?.trim() ? `${base} (${b.alias.trim()})` : base;
                    })
                    .join(", ")}
                />
                {startupCmd.trim() && (
                  <ReviewRow label="Startup" value={startupCmd} className="col-span-2" />
                )}
              </dl>
              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
                  <ArrowLeft className="size-4" /> Back
                </Button>
                <Button onClick={deploy} loading={deploying} actionType="deploy">
                  <Rocket className="size-4" /> Deploy now
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {infoTemplate && (
        <TemplateInfoDialog template={infoTemplate} onClose={() => setInfoTemplate(null)} />
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-2">
      {STEP_LABELS.map((label, i) => (
        <div key={label} className="flex flex-1 items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full border text-[11px] font-medium",
                i < step && "border-vivox-500 bg-vivox-500 text-white",
                i === step && "border-vivox-500 text-vivox-400",
                i > step && "border-border text-muted",
              )}
            >
              {i < step ? <Check className="size-3" /> : i + 1}
            </span>
            <span className={cn("text-xs", i <= step ? "text-foreground" : "text-muted")}>
              {label}
            </span>
          </div>
          {i < STEP_LABELS.length - 1 && <span className="h-px flex-1 bg-surface-raised" />}
        </div>
      ))}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function ReviewRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("bg-surface p-2.5", className)}>
      <dt className="text-[10px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}
