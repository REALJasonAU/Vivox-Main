import type { ApiTemplate, Service } from "./types";

/** Rust modding frameworks (not shared with Minecraft). */
const RUST_ONLY_FRAMEWORKS = new Set(["oxide", "carbon", "carbon-minimal"]);

/** Minecraft server software from the minecraft template. */
const MINECRAFT_FRAMEWORKS = new Set([
  "paper",
  "purpur",
  "vanilla",
  "fabric",
  "forge",
  "neoforge",
  "quilt",
  "mohist",
  "arclight",
]);

export function isRustFramework(fw: string): boolean {
  const fwLower = fw.toLowerCase();
  return RUST_ONLY_FRAMEWORKS.has(fwLower);
}

export function isMinecraftFramework(fw: string): boolean {
  return MINECRAFT_FRAMEWORKS.has(fw.toLowerCase());
}

function rustEnvMarkers(env: Record<string, string>): boolean {
  return (
    "RCON_PASS" in env ||
    "RCON_PORT" in env ||
    "QUERY_PORT" in env ||
    "SERVER_IDENTITY" in env ||
    "DOWNLOAD_METHOD" in env
  );
}

function minecraftEnvMarkers(env: Record<string, string>): boolean {
  return "MC_VERSION" in env || "MEMORY" in env || "MOTD" in env || "JVM_FLAGS" in env;
}

function isRustImage(image: string): boolean {
  const img = image.toLowerCase();
  return img.includes("sturdystubs") || img.includes("aioegg");
}

function isMinecraftImage(image: string): boolean {
  const img = image.toLowerCase();
  return (
    img.includes("eclipse-temurin") ||
    img.includes("minecraft") ||
    img.includes("itzg")
  );
}

export function isRustGame(service: Service): boolean {
  if (service.type !== "game") return false;

  const env = service.config?.environment ?? {};
  const image = service.config?.image ?? "";
  const fw = (env.FRAMEWORK ?? "").toLowerCase();

  if (rustEnvMarkers(env)) return true;
  if (isRustImage(image)) return true;
  if (RUST_ONLY_FRAMEWORKS.has(fw)) return true;

  // "Vanilla" exists on both templates — require rust-specific context.
  if (fw === "vanilla" && (rustEnvMarkers(env) || isRustImage(image))) return true;

  return false;
}

export function isMinecraftGame(service: Service): boolean {
  if (service.type !== "game") return false;
  if (isRustGame(service)) return false;

  const env = service.config?.environment ?? {};
  const image = service.config?.image ?? "";
  const fw = (env.FRAMEWORK ?? "").toLowerCase();

  if (minecraftEnvMarkers(env)) return true;
  if (isMinecraftImage(image)) return true;
  if (MINECRAFT_FRAMEWORKS.has(fw)) return true;

  // Legacy deploy wizard fields (pre-API template).
  if ("TYPE" in env && !rustEnvMarkers(env)) return true;

  return false;
}

export function templateIdForService(service: Service): "rust" | "minecraft" | null {
  if (isRustGame(service)) return "rust";
  if (isMinecraftGame(service)) return "minecraft";
  return null;
}

export function showRustPluginTab(service: Service): boolean {
  const fw = service.config?.environment?.FRAMEWORK ?? "";
  return isRustGame(service) && fw.toLowerCase() !== "vanilla";
}

export function showMcPluginTab(service: Service): boolean {
  const fw = service.config?.environment?.FRAMEWORK ?? "";
  return isMinecraftGame(service) && fw !== "Vanilla";
}

export function pluginTabLabel(service: Service): string | null {
  if (!showRustPluginTab(service) && !showMcPluginTab(service)) return null;
  const fw = service.config?.environment?.FRAMEWORK ?? "";
  return isRustGame(service)
    ? "Plugins"
    : ["Fabric", "Forge", "NeoForge", "Quilt"].includes(fw)
      ? "Mods"
      : "Plugins";
}

export function buildGameServiceTabs(service: Service): string[] {
  const rust = isRustGame(service);
  const mc = isMinecraftGame(service);
  const pluginLabel = pluginTabLabel(service);
  const showPlugins = !!pluginLabel;

  if (rust || mc) {
    return [
      "Overview",
      "Console",
      "Files",
      ...(rust ? ["CFG Editor"] : []),
      ...(mc ? ["Properties"] : []),
      ...(showPlugins ? [pluginLabel!] : []),
      "Schedule",
      "Backups",
      "Startup",
      "Logs",
      "Settings",
    ];
  }

  return [
    "Overview",
    "Console",
    "Files",
    "Schedule",
    "Backups",
    "Startup",
    "Logs",
    "Settings",
  ];
}

export function buildStartupRows(
  service: Service,
  template: ApiTemplate | null,
  hiddenKeys: Set<string>,
): { key: string; value: string }[] {
  const env = service.config.environment ?? {};

  if (!template) {
    return Object.entries(env)
      .filter(([key]) => !hiddenKeys.has(key))
      .map(([key, value]) => ({ key, value }));
  }

  const rows: { key: string; value: string }[] = [];
  const seen = new Set<string>();

  for (const field of template.configurable ?? []) {
    const key = field.env;
    if (!key || hiddenKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, value: env[key] ?? field.default ?? "" });
  }

  for (const [key, defaultVal] of Object.entries(template.env ?? {})) {
    if (hiddenKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, value: env[key] ?? defaultVal });
  }

  for (const [key, value] of Object.entries(env)) {
    if (hiddenKeys.has(key) || seen.has(key)) continue;
    rows.push({ key, value });
  }

  return rows;
}

/** Template default for a startup env key (configurable field or tmpl.env). */
export function defaultForStartupKey(
  key: string,
  template: ApiTemplate | null,
): string {
  if (!template) return "";
  const field = template.configurable?.find((f) => f.env === key || f.key === key);
  if (field) return field.default ?? "";
  return template.env?.[key] ?? "";
}
