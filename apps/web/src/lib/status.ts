import type { ServiceStatus } from "./types";

export type StatusKind = "transient" | "stable";

export interface StatusMeta {
  label: string;
  kind: StatusKind;
  /** Tailwind text/border/bg color key registered in tailwind.config. */
  color: string;
  /** Dot animation: pulse for transient "live" states. */
  pulse: boolean;
  /** Spinner shown while provisioning. */
  spinner: boolean;
  description: string;
}

/**
 * The service status state machine (plan section 4). Transient states disable
 * control buttons to prevent button-spam races; the server is the source of
 * truth and rejects illegal transitions.
 */
export const STATUS_META: Record<ServiceStatus, StatusMeta> = {
  PROVISIONING: {
    label: "Provisioning",
    kind: "transient",
    color: "provisioning",
    pulse: false,
    spinner: true,
    description: "Pulling image / running install script",
  },
  STARTING: {
    label: "Starting",
    kind: "transient",
    color: "starting",
    pulse: true,
    spinner: false,
    description: "Container spawned, awaiting health check",
  },
  RUNNING: {
    label: "Running",
    kind: "stable",
    color: "running",
    pulse: false,
    spinner: false,
    description: "Healthy",
  },
  STOPPING: {
    label: "Stopping",
    kind: "transient",
    color: "stopping",
    pulse: true,
    spinner: false,
    description: "Graceful shutdown (SIGTERM)",
  },
  STOPPED: {
    label: "Stopped",
    kind: "stable",
    color: "stopped",
    pulse: false,
    spinner: false,
    description: "Clean exit",
  },
  CRASHED: {
    label: "Crashed",
    kind: "stable",
    color: "crashed",
    pulse: false,
    spinner: false,
    description: "Non-zero exit",
  },
};

export function isTransient(status: ServiceStatus): boolean {
  return STATUS_META[status].kind === "transient";
}

export type ServiceAction = "start" | "stop" | "restart";

/**
 * Which controls are enabled for a given status. Transient states disable all
 * controls; the API enforces the same rules server-side.
 */
export function allowedActions(status: ServiceStatus): Record<ServiceAction, boolean> {
  if (isTransient(status)) {
    return { start: false, stop: false, restart: false };
  }
  switch (status) {
    case "RUNNING":
      return { start: false, stop: true, restart: true };
    case "STOPPED":
    case "CRASHED":
      return { start: true, stop: false, restart: false };
    default:
      return { start: false, stop: false, restart: false };
  }
}
