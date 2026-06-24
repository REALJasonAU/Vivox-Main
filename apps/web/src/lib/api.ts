import type {
  AlertRule,
  ApiKey,
  ApiTemplate,
  AuditEvent,
  Backup,
  CreateServiceInput,
  CreateWebhookInput,
  Customer,
  Deployment,
  FileEntry,
  Node,
  RegisterNodeInput,
  RegisterNodeResponse,
  ResourceLimits,
  ScheduledTask,
  Service,
  ServiceDomain,
  ServiceHealth,
  WebhookConfig,
} from "./types";
import type { ServiceAction } from "./status";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "/api/control";

/**
 * In-memory session token. The Better Auth session is primarily carried by an
 * httpOnly cookie (forwarded via credentials: "include"), but when a bearer
 * token is available we also attach it so the Go API can verify cross-origin
 * requests that cannot rely on third-party cookies.
 */
let authToken: string | null = null;

/**
 * Blocks apiFetch until SessionSync provides a JWT or gives up after retries.
 * Resolving too early with a null token caused requests to hit the Go API with
 * only the opaque session cookie (not a JWT) → 401 → login redirect loop.
 */
let _tokenSyncResolve: (() => void) | undefined;
const _tokenSyncPromise = new Promise<void>((resolve) => {
  _tokenSyncResolve = resolve;
  setTimeout(() => {
    _tokenSyncResolve?.();
    _tokenSyncResolve = undefined;
  }, 12_000);
});

export function setApiToken(token: string | null): void {
  authToken = token;
  if (token) {
    _tokenSyncResolve?.();
    _tokenSyncResolve = undefined;
  }
}

/** Called when SessionSync finishes retrying without obtaining a JWT. */
export function markTokenSyncComplete(): void {
  _tokenSyncResolve?.();
  _tokenSyncResolve = undefined;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Skip JSON parsing (e.g. 204 responses). */
  raw?: boolean;
}

/** Session-aware fetch wrapper for the Go control plane REST API. */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  // Wait for SessionSync to complete its first JWT fetch before sending any
  // request. This prevents a race where dashboard useEffects fire before
  // the Bearer token is available, which would result in a 401 loop.
  if (typeof window !== "undefined") {
    await _tokenSyncPromise;
  }

  const { body, raw, headers, ...rest } = options;
  const url = path.startsWith("http")
    ? path
    : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...((headers as Record<string, string>) ?? {}),
  };

  const res = await fetch(url, {
    ...rest,
    headers: finalHeaders,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    setApiToken(null);
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    const message =
      (parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : null) ?? "Unauthorized";
    throw new ApiError(message, 401, parsed);
  }

  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = await res.text().catch(() => null);
    }
    const message =
      (parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : null) ?? `Request failed: ${res.status} ${res.statusText}`;
    throw new ApiError(message, res.status, parsed);
  }

  if (raw || res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

/* --------------------------------- Services -------------------------------- */

export const servicesApi = {
  list: (tag?: string) =>
    apiFetch<Service[]>(tag ? `/services?tag=${encodeURIComponent(tag)}` : "/services"),
  get: (id: string) => apiFetch<Service>(`/services/${id}`),
  create: (input: CreateServiceInput) =>
    apiFetch<Service>("/services", { method: "POST", body: input }),
  remove: (id: string) =>
    apiFetch<void>(`/services/${id}`, { method: "DELETE", raw: true }),
  action: (id: string, action: ServiceAction) =>
    apiFetch<Service>(`/services/${id}/${action}`, { method: "POST" }),
  start: (id: string) => servicesApi.action(id, "start"),
  stop: (id: string) => servicesApi.action(id, "stop"),
  restart: (id: string) => servicesApi.action(id, "restart"),
  deployments: (id: string) =>
    apiFetch<Deployment[]>(`/services/${id}/deployments`),
  updateEnv: (id: string, environment: Record<string, string>) =>
    apiFetch<Service>(`/services/${id}/env`, {
      method: "PATCH",
      body: { environment },
    }),
  updateLimits: (id: string, limits: ResourceLimits) =>
    apiFetch<Service>(`/services/${id}/limits`, { method: "PATCH", body: limits }),
  updateConfig: (
    id: string,
    cfg: { startup_cmd?: string; image?: string; health_check?: import("./types").HealthCheck; clear_health_check?: boolean },
  ) =>
    apiFetch<Service>(`/services/${id}/config`, { method: "PATCH", body: cfg }),
  metrics: (id: string, range: string) =>
    apiFetch<{ t: number; cpu: number; mem: number }[]>(`/services/${id}/metrics?range=${range}`),
  health: (id: string) => apiFetch<ServiceHealth>(`/services/${id}/health`),
  redeploy: (id: string) =>
    apiFetch<{ status: string }>(`/services/${id}/redeploy`, { method: "POST" }),
  logs: (id: string, range: string, q?: string, stream?: string) => {
    const p = new URLSearchParams({ range });
    if (q) p.set("q", q);
    if (stream) p.set("stream", stream);
    return apiFetch<{ lines: { t: number; s: string; line: string }[]; total: number; truncated: boolean }>(
      `/services/${id}/logs?${p}`,
    );
  },
  updateTags: (id: string, tags: string[]) =>
    apiFetch<Service>(`/services/${id}/tags`, { method: "PATCH", body: { tags } }),
  alertRules: (id: string) => apiFetch<AlertRule[]>(`/services/${id}/alerts`),
  createAlertRule: (id: string, body: { metric: string; operator: string; threshold: number }) =>
    apiFetch<AlertRule>(`/services/${id}/alerts`, { method: "POST", body }),
  deleteAlertRule: (id: string, ruleId: string) =>
    apiFetch<void>(`/services/${id}/alerts/${ruleId}`, { method: "DELETE", raw: true }),
  toggleAlertRule: (id: string, ruleId: string, enabled: boolean) =>
    apiFetch<AlertRule>(`/services/${id}/alerts/${ruleId}`, { method: "PATCH", body: { enabled } }),
  listBackups: (id: string) => apiFetch<Backup[]>(`/services/${id}/backups`),
  createBackup: (id: string) =>
    apiFetch<Backup>(`/services/${id}/backups`, { method: "POST" }),
  deleteBackup: (id: string, backupId: string) =>
    apiFetch<void>(`/services/${id}/backups/${backupId}`, { method: "DELETE", raw: true }),
  listDomains: (id: string) => apiFetch<ServiceDomain[]>(`/services/${id}/domains`),
  addDomain: (id: string, domain: string) =>
    apiFetch<ServiceDomain>(`/services/${id}/domains`, { method: "POST", body: { domain } }),
  removeDomain: (id: string, domainId: string) =>
    apiFetch<void>(`/services/${id}/domains/${domainId}`, { method: "DELETE", raw: true }),
  templates: () => apiFetch<ApiTemplate[]>("/templates"),
};

export const webhooksApi = {
  list: () => apiFetch<WebhookConfig[]>("/user/webhooks"),
  create: (body: CreateWebhookInput) =>
    apiFetch<WebhookConfig>("/user/webhooks", { method: "POST", body }),
  toggle: (id: string, enabled: boolean) =>
    apiFetch<WebhookConfig>(`/user/webhooks/${id}`, { method: "PATCH", body: { enabled } }),
  remove: (id: string) => apiFetch<void>(`/user/webhooks/${id}`, { method: "DELETE", raw: true }),
};

export const profileApi = {
  update: (name: string) => apiFetch<{ name: string }>("/user/profile", { method: "PATCH", body: { name } }),
};

export const apiKeysApi = {
  list: () => apiFetch<ApiKey[]>("/user/api-keys"),
  create: (name: string) =>
    apiFetch<{ key: ApiKey; plaintext: string }>("/user/api-keys", {
      method: "POST",
      body: { name },
    }),
  remove: (id: string) => apiFetch(`/user/api-keys/${id}`, { method: "DELETE", raw: true }),
};

export const filesApi = {
  list: (id: string, path: string) =>
    apiFetch<FileEntry[]>(`/services/${id}/files?path=${encodeURIComponent(path)}`),
  read: (id: string, path: string) =>
    apiFetch<{ content: string; encoding?: string }>(
      `/services/${id}/files/read?path=${encodeURIComponent(path)}`,
    ),
  write: (id: string, path: string, content: string) =>
    apiFetch<void>(`/services/${id}/files/write`, {
      method: "POST",
      body: { path, content: btoa(content) },
      raw: true,
    }),
};

export const scheduleApi = {
  list: (serviceId: string) => apiFetch<ScheduledTask[]>(`/services/${serviceId}/schedule`),
  create: (
    serviceId: string,
    body: {
      name: string;
      cron_expr: string;
      action: string;
      status?: string;
    },
  ) =>
    apiFetch<ScheduledTask>(`/services/${serviceId}/schedule`, { method: "POST", body }),
  remove: (serviceId: string, taskId: string) =>
    apiFetch<void>(`/services/${serviceId}/schedule/${taskId}`, { method: "DELETE", raw: true }),
};

/* -------------------------------- Templates -------------------------------- */

export const templatesApi = {
  list: () => apiFetch<ApiTemplate[]>("/templates"),
};

/* ---------------------------------- Nodes ---------------------------------- */

export const nodesApi = {
  list: () => apiFetch<Node[]>("/admin/nodes"),
  get: (id: string) => apiFetch<Node>(`/admin/nodes/${id}`),
  services: (id: string) => apiFetch<Service[]>(`/admin/nodes/${id}/services`),
  rotateToken: (id: string) =>
    apiFetch<RegisterNodeResponse>(`/admin/nodes/${id}/rotate-token`, { method: "POST" }),
  register: (input: RegisterNodeInput) =>
    apiFetch<RegisterNodeResponse>("/admin/nodes", {
      method: "POST",
      body: input,
    }),
};

export const auditApi = {
  list: (params?: {
    actor_id?: string;
    target_type?: string;
    target_id?: string;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.actor_id) q.set("actor_id", params.actor_id);
    if (params?.target_type) q.set("target_type", params.target_type);
    if (params?.target_id) q.set("target_id", params.target_id);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return apiFetch<AuditEvent[]>(`/admin/audit${qs ? `?${qs}` : ""}`);
  },
};

export const adminApi = {
  customers: () => apiFetch<Customer[]>("/admin/customers"),
  services: () => apiFetch<Service[]>("/admin/services"),
  suspendCustomer: (userId: string, reason?: string) =>
    apiFetch<void>(`/admin/customers/${userId}/suspend`, {
      method: "PATCH",
      body: { reason: reason ?? "" },
      raw: true,
    }),
  unsuspendCustomer: (userId: string) =>
    apiFetch<void>(`/admin/customers/${userId}/unsuspend`, {
      method: "PATCH",
      raw: true,
    }),
};
