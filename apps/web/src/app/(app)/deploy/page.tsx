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
} from "lucide-react";
import { servicesApi, templatesApi } from "@/lib/api";
import { DEPLOY_TEMPLATES, REGIONS } from "@/lib/templates";
import type {
  ApiTemplate,
  CreateServiceInput,
  DeployTemplate,
  ServiceType,
} from "@/lib/types";
import { useApi } from "@/hooks/useApi";
import { toast } from "@/hooks/useToast";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth-client";

const TYPE_ICON: Record<ServiceType, typeof Container> = {
  game: Gamepad2,
  docker: Container,
  static: Globe,
  database: Container,
};

type Step = 0 | 1 | 2;
const STEP_LABELS = ["Template", "Configure", "Review"];

const inputClass =
  "h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950/50 px-3.5 text-sm text-zinc-100 outline-none transition-all duration-200 focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700";

function apiTemplateToDeployTemplate(t: ApiTemplate): DeployTemplate {
  const type: ServiceType =
    t.type === "game" || t.type === "docker" || t.type === "static" || t.type === "database"
      ? t.type
      : "docker";

  return {
    id: t.id,
    name: t.name,
    type,
    description: t.description,
    defaultImage: t.image,
    defaultPorts: t.ports ?? [],
    env: (t.configurable ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      value: f.default,
    })),
  };
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

  const templates = useMemo(() => {
    if (apiTemplates && apiTemplates.length > 0) {
      return apiTemplates.map(apiTemplateToDeployTemplate);
    }
    return DEPLOY_TEMPLATES;
  }, [apiTemplates]);

  const [step, setStep] = useState<Step>(0);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [region, setRegion] = useState(REGIONS[0].id);
  const [image, setImage] = useState("");
  const [env, setEnv] = useState<Record<string, string>>({});
  const [memory, setMemory] = useState(2048);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = useMemo(
    () => (templateId ? templates.find((t) => t.id === templateId) : undefined),
    [templateId, templates],
  );

  const selectTemplate = (t: DeployTemplate) => {
    setTemplateId(t.id);
    setImage(t.defaultImage);
    setEnv(Object.fromEntries(t.env.map((e) => [e.key, e.value])));
    setStep(1);
  };

  const canConfigure =
    name.trim().length >= 2 &&
    (template?.type !== "docker" || image.trim().length > 0);

  const deploy = async () => {
    if (!template) return;
    setDeploying(true);
    setError(null);

    const input: CreateServiceInput = {
      name: name.trim(),
      type: template.type,
      region,
      config: {
        image: image.trim() || template.defaultImage,
        ports: template.defaultPorts,
        environment: env,
      },
      resource_limits: { cpu_shares: 1024, memory_mb: memory, disk_gb: 10 },
    };

    try {
      const service = await servicesApi.create({
        ...input,
        ...(forUserId ? { owner_id: forUserId } : {}),
      });
      toast("Deployment queued!", "success");
      router.push(forUserId ? "/admin/customers" : `/services/${service.id}`);
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Deploy a service</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Pick a template, name it, choose a region, and ship.
        </p>
      </div>

      {forUserId && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-sm text-amber-400">
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
          {step === 0 && (
            templatesLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-[140px]" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {templates.map((t) => {
                  const Icon = TYPE_ICON[t.type];
                  return (
                    <button
                      key={t.id}
                      onClick={() => selectTemplate(t)}
                      className="group flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-left transition-all duration-200 hover:border-zinc-700"
                    >
                      <span className="grid size-11 place-items-center rounded-xl bg-vivox-500/15 text-vivox-400">
                        <Icon className="size-5" />
                      </span>
                      <div>
                        <h3 className="font-medium text-zinc-100">{t.name}</h3>
                        <p className="mt-1 text-xs text-zinc-400">{t.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          )}

          {step === 1 && template && (
            <div className="flex flex-col gap-5 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
              <Labeled label="Service name">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-awesome-server"
                  className={inputClass}
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

              <Labeled label="Region">
                <div className="grid grid-cols-2 gap-2">
                  {REGIONS.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRegion(r.id)}
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-sm transition-all duration-200",
                        region === r.id
                          ? "border-vivox-500/50 bg-vivox-500/10 text-zinc-100"
                          : "border-zinc-800 text-zinc-400 hover:border-zinc-700",
                      )}
                    >
                      {r.label}
                      {region === r.id && <Check className="size-4 text-vivox-400" />}
                    </button>
                  ))}
                </div>
              </Labeled>

              <Labeled label={`Memory · ${memory} MB`}>
                <input
                  type="range"
                  min={512}
                  max={8192}
                  step={512}
                  value={memory}
                  onChange={(e) => setMemory(Number(e.target.value))}
                  className="w-full accent-vivox-500"
                />
              </Labeled>

              {template.env.length > 0 && (
                <Labeled label="Environment">
                  <div className="flex flex-col gap-2">
                    {template.env.map((field) => (
                      <div key={field.key} className="flex items-center gap-2">
                        <span className="w-28 shrink-0 font-mono text-xs uppercase tracking-wider text-zinc-500">
                          {field.key}
                        </span>
                        <input
                          value={env[field.key] ?? ""}
                          onChange={(e) =>
                            setEnv((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          className="h-9 flex-1 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 font-mono text-sm text-zinc-100 outline-none transition-all duration-200 focus:border-zinc-700"
                        />
                      </div>
                    ))}
                  </div>
                </Labeled>
              )}

              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" onClick={() => setStep(0)}>
                  <ArrowLeft className="size-4" /> Back
                </Button>
                <Button disabled={!canConfigure} onClick={() => setStep(2)}>
                  Review <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && template && (
            <div className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
              <h3 className="text-sm font-medium uppercase tracking-wider text-zinc-500">Review</h3>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-800">
                <ReviewRow label="Template" value={template.name} />
                <ReviewRow label="Name" value={name} />
                <ReviewRow
                  label="Region"
                  value={REGIONS.find((r) => r.id === region)?.label ?? region}
                />
                <ReviewRow label="Image" value={image || template.defaultImage} />
                <ReviewRow label="Memory" value={`${memory} MB`} />
                <ReviewRow label="Ports" value={template.defaultPorts.join(", ")} />
              </dl>
              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  <ArrowLeft className="size-4" /> Back
                </Button>
                <Button onClick={deploy} loading={deploying} size="lg" actionType="deploy">
                  <Rocket className="size-4" /> Deploy now
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-3">
      {STEP_LABELS.map((label, i) => (
        <div key={label} className="flex flex-1 items-center gap-3">
          <div className="flex items-center gap-2.5">
            <motion.span
              animate={{
                backgroundColor: i < step ? "#e5181b" : "transparent",
                borderColor: i <= step ? "#e5181b" : "#27272a",
                scale: i === step ? [1, 1.08, 1] : 1,
              }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                "grid size-7 place-items-center rounded-full border text-xs font-medium",
                i < step && "text-white",
                i === step && "text-vivox-400",
                i > step && "text-zinc-500",
              )}
            >
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </motion.span>
            <span
              className={cn(
                "text-sm",
                i <= step ? "text-zinc-100" : "text-zinc-500",
              )}
            >
              {label}
            </span>
          </div>
          {i < STEP_LABELS.length - 1 && <span className="h-px flex-1 bg-zinc-800" />}
        </div>
      ))}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900 p-3.5">
      <dt className="text-xs uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className="mt-1 truncate font-mono text-sm text-zinc-100">{value}</dd>
    </div>
  );
}
