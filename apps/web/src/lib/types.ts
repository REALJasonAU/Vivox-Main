/**
 * Domain types mirrored from the Go control plane (packages/domain + schema.sql).
 * Kept intentionally close to the API contract so the typed client stays honest.
 */

export type ServiceType = "game" | "docker" | "database" | "static";

export type ServiceStatus =
  | "PROVISIONING"
  | "STARTING"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "CRASHED";

export type DeployStatus = "queued" | "building" | "success" | "failed";

export type NodeStatus = "online" | "offline" | "degraded";

export interface ResourceLimits {
  cpu_shares: number;
  memory_mb: number;
  disk_gb: number;
  max_backups?: number;
  backup_storage?: string;
  database_slots?: number;
  database_types?: string[];
}

export interface ServiceConfig {
  image?: string;
  ports?: string[];
  port_mappings?: PortMapping[];
  environment?: Record<string, string>;
  startup_cmd?: string;
  install_script?: string;
  main_port?: number;
  asset_url?: string;
  health_check?: HealthCheck;
}

export interface PortMapping {
  host_ip?: string;
  host_port: number;
  container_port: number;
  proto?: string;
  alias?: string;
}

export interface HealthCheck {
  path: string;
  port: number;
  interval?: number;
  timeout?: number;
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
}

export interface ServiceHealth {
  available: boolean;
  healthy?: boolean;
  status_code?: number;
  latency_ms?: number;
  error?: string;
  checked_at?: number;
}

export interface HealthPayload {
  timestamp?: number;
  healthy?: boolean;
  status_code?: number;
  latency_ms?: number;
  error?: string;
}

export interface AlertRule {
  id: string;
  service_id: string;
  metric: "cpu" | "memory";
  operator: "gt" | "lt";
  threshold: number;
  enabled: boolean;
  notified_at?: string | null;
  created_at: string;
}

export interface AlertPayload {
  timestamp?: number;
  metric?: string;
  value?: number;
  threshold?: number;
  operator?: string;
}

export interface LogHistoryLine {
  t: number;
  s: string;
  line: string;
}

export interface Backup {
  id: string;
  service_id: string;
  node_id: string | null;
  status: "pending" | "running" | "success" | "failed";
  size_bytes: number | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ServicePlugin {
  id: string;
  service_id: string;
  source: "modrinth" | "curseforge" | "spigot" | "umod" | "codefling" | "manual";
  external_id: string;
  name: string;
  version: string;
  version_id: string;
  jar_filename: string;
  plugin_dir: string;
  auto_update: boolean;
  installed_at: string;
  dependencies: string[];
}

export interface PluginResult {
  id: string;
  source: "modrinth" | "curseforge" | "spigot" | "umod" | "codefling";
  name: string;
  description: string;
  icon_url: string;
  downloads: number;
  version: string;
  version_id: string;
  download_url: string;
  page_url: string;
  jar_filename: string;
  is_paid: boolean;
}

export interface RustConvar {
  Name: string;
  Help: string | null;
  Type: "bool" | "int" | "float" | "string" | "System.Int64" | "UnityEngine.Vector3";
  Saved: boolean;
  ServerAdmin: boolean;
  ServerUser: boolean;
  Clientside: boolean;
  Serverside: boolean;
  DefaultValue: string | number | boolean | null;
}

export interface ServerCfgResponse {
  path: string;
  content: string;
  found: boolean;
}

export interface ServiceDomain {
  id: string;
  service_id: string;
  domain: string;
  status: "pending" | "active" | "error";
  error: string | null;
  created_at: string;
}

export interface WebhookConfig {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  last_fired_at: string | null;
  created_at: string;
}

export interface CreateWebhookInput {
  url: string;
  secret?: string;
  events: string[];
}

export interface NodeCapacity {
  cpu_cores: number;
  ram_mb: number;
  disk_gb: number;
}

export interface Service {
  id: string;
  owner_id: string;
  team_id?: string | null;
  name: string;
  type: ServiceType;
  status: ServiceStatus;
  node_id?: string | null;
  /** Node hostname/IP (from node name) for connect address display. */
  node_host?: string | null;
  resource_limits: ResourceLimits;
  config: ServiceConfig;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface Node {
  id: string;
  name: string;
  region: string;
  status: NodeStatus;
  capacity: NodeCapacity;
  online?: boolean;
  agent_id?: string;
  /** Optional live health fields surfaced by the API. */
  cpu_usage_percent?: number;
  memory_usage_percent?: number;
  memory_used_mb?: number;
  service_count?: number;
  last_seen_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Deployment {
  id: string;
  service_id: string;
  commit_sha?: string | null;
  status: DeployStatus;
  logs_ref?: string | null;
  created_at: string;
}

export interface FileEntry {
  name: string;
  is_dir: boolean;
  size: number;
  modified: string;
  permissions: string;
}

export interface ScheduledTask {
  id: string;
  service_id: string;
  owner_id: string;
  name: string;
  cron_expr: string;
  action: string;
  status: "active" | "paused" | "running" | "failed";
  last_run_at?: string;
  next_run_at?: string;
  last_result?: string;
  created_at: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  role?: "admin" | "user";
  image?: string | null;
}

/* ----- Real-time payload shapes (WSHub envelopes, plan section 7) ----- */

export interface ConsolePayload {
  timestamp: number;
  stream: "stdout" | "stderr";
  text: string;
}

export interface MetricsPayload {
  timestamp: number;
  cpu_usage_percent: number;
  memory_bytes_used: number;
  disk_bytes_used: number;
  network_rx_bytes?: number;
  network_tx_bytes?: number;
}

export interface StatusPayload {
  status: ServiceStatus;
}

/* ----- API templates (GET /templates) ----- */

export interface ApiConfigurableField {
  key: string;
  label: string;
  default: string;
  env: string;
  description?: string;
  options?: string;
  field_type?: "text" | "select" | "password" | "number" | "boolean";
  required?: boolean;
}

export interface ApiTemplateResources {
  memory_mb: number;
  cpu_shares: number;
  disk_gb: number;
}

export interface ApiTemplate {
  id: string;
  name: string;
  description: string;
  type: string;
  image: string;
  ports: string[];
  env?: Record<string, string>;
  configurable: ApiConfigurableField[];
  resources: ApiTemplateResources;
  startup_cmd?: string;
  install_script?: string;
}

/* ----- Deploy templates (plan section 9) ----- */

export interface DeployTemplate {
  id: string;
  name: string;
  type: ServiceType;
  description: string;
  defaultImage: string;
  /** Editable env presented in the wizard (keys are container env var names). */
  env: {
    key: string;
    label: string;
    value: string;
    required?: boolean;
    description?: string;
    options?: string;
    fieldType?: "text" | "select" | "password" | "number" | "boolean";
  }[];
  defaultPorts: string[];
  defaultStartupCmd?: string;
  defaultInstallScript?: string;
  defaultMemoryMb?: number;
  defaultCpuThreads?: number;
  defaultDiskGb?: number;
}

export interface CreateServiceInput {
  name: string;
  type: ServiceType;
  region?: string;
  node_id?: string;
  config: ServiceConfig;
  resource_limits: ResourceLimits;
  owner_id?: string;
}

export interface Customer {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  created_at: string;
  is_suspended: boolean;
  service_count: number;
  running_count: number;
}

export interface AuditEvent {
  id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface RegisterNodeResponse {
  node: Node & { online?: boolean };
  agent_token: string;
}

export interface RegisterNodeInput {
  name: string;
  region?: string;
  capacity?: NodeCapacity;
}
