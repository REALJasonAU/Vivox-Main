/** Parsed Docker port binding (ip:host:container[/proto]). */
export interface PortBinding {
  hostIp: string;
  host: number;
  container: number;
  proto?: string;
  alias?: string;
}

export interface PortMapping {
  host_ip?: string;
  host_port: number;
  container_port: number;
  proto?: string;
  alias?: string;
}

export function parsePortBinding(raw: string): PortBinding {
  const trimmed = raw.trim();
  let proto: string | undefined;
  let base = trimmed;
  const slash = trimmed.lastIndexOf("/");
  if (slash > trimmed.indexOf(":")) {
    proto = trimmed.slice(slash + 1);
    base = trimmed.slice(0, slash);
  }
  const parts = base.split(":");
  if (parts.length >= 3) {
    return {
      hostIp: parts[0],
      host: Number(parts[1]) || 0,
      container: Number(parts[2]) || 0,
      proto: proto || "tcp",
    };
  }
  return {
    hostIp: "0.0.0.0",
    host: Number(parts[0]) || 0,
    container: Number(parts[1]) || 0,
    proto: proto || "tcp",
  };
}

export function formatPortBinding(b: PortBinding): string {
  const ip = (b.hostIp || "0.0.0.0").trim();
  const core = `${ip}:${b.host}:${b.container}`;
  const proto = b.proto || "tcp";
  return `${core}/${proto}`;
}

export function portBindingToMapping(b: PortBinding): PortMapping {
  return {
    host_ip: b.hostIp || "0.0.0.0",
    host_port: b.host,
    container_port: b.container,
    proto: b.proto || "tcp",
    alias: b.alias?.trim() || undefined,
  };
}

export function mappingToPortBinding(m: PortMapping): PortBinding {
  return {
    hostIp: m.host_ip || "0.0.0.0",
    host: m.host_port,
    container: m.container_port,
    proto: m.proto || "tcp",
    alias: m.alias,
  };
}

export function hostPortsFromBindings(bindings: string[]): number[] {
  return bindings.map((p) => parsePortBinding(p).host).filter((h) => h > 0);
}

export function collectUsedHostPorts(
  services: { config: { ports?: string[]; port_mappings?: PortMapping[] } }[],
): Set<number> {
  const used = new Set<number>();
  for (const s of services) {
    const ports =
      s.config.ports && s.config.ports.length > 0
        ? s.config.ports
        : (s.config.port_mappings ?? []).map((m) => formatPortBinding(mappingToPortBinding(m)));
    for (const h of hostPortsFromBindings(ports)) {
      used.add(h);
    }
  }
  return used;
}

export function isPortAvailable(
  hostPort: number,
  used: Set<number>,
  selected: number[],
): string | null {
  if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) {
    return "Port must be between 1 and 65535";
  }
  if (used.has(hostPort)) {
    return "Port already in use on this node";
  }
  if (selected.filter((p) => p === hostPort).length > 1) {
    return "Duplicate port in this deploy";
  }
  return null;
}

export function displayPortsFromConfig(config: {
  ports?: string[];
  port_mappings?: PortMapping[];
}): string[] {
  if (config.ports && config.ports.length > 0) {
    return config.ports;
  }
  return (config.port_mappings ?? []).map((m) => {
    const line = formatPortBinding(mappingToPortBinding(m));
    return m.alias?.trim() ? `${line} (${m.alias.trim()})` : line;
  });
}

export function isValidHostIp(ip: string): boolean {
  const v = ip.trim();
  if (!v || v === "0.0.0.0") return true;
  const ipv4 =
    /^(25[0-5]|2[0-4]\d|[01]?\d?\d)(\.(25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/;
  return ipv4.test(v);
}

export interface PortDisplay {
  label: string;
  copyText: string;
  detail: string;
  isMain: boolean;
}

/** Host-facing bind string: ip:hostPort/proto (e.g. 0.0.0.0:28015/udp). */
export function formatHostPortDisplay(b: PortBinding): string {
  const ip = (b.hostIp || "0.0.0.0").trim();
  const host = b.host > 0 ? b.host : b.container;
  const proto = (b.proto || "tcp").toLowerCase();
  return `${ip}:${host}/${proto}`;
}

/** Human-readable port list with main vs additional allocations. */
export function portsForDisplay(config: {
  ports?: string[];
  port_mappings?: PortMapping[];
  main_port?: number;
}): PortDisplay[] {
  const mappings =
    config.port_mappings && config.port_mappings.length > 0
      ? config.port_mappings
      : (config.ports ?? []).map((p) => portBindingToMapping(parsePortBinding(p.split(" (")[0] ?? p)));

  const mainContainer = config.main_port;
  const out: PortDisplay[] = [];

  for (const m of mappings) {
    const b = mappingToPortBinding(m);
    const isMain =
      m.alias === "main" ||
      (mainContainer != null && mainContainer > 0 && b.container === mainContainer);
    const label = formatHostPortDisplay(b);
    const alias = m.alias?.trim();
    const detail = isMain
      ? "Main port"
      : alias
        ? `Allocation · ${alias}`
        : "Additional port";
    out.push({ label, copyText: label, detail, isMain });
  }

  if (out.length === 0) return out;
  out.sort((a, b) => (a.isMain === b.isMain ? 0 : a.isMain ? -1 : 1));
  return out;
}
