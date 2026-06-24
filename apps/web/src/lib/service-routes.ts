const TAB_SLUGS: Record<string, string> = {
  Overview: "overview",
  Console: "console",
  Files: "files",
  "CFG Editor": "cfg-editor",
  Properties: "properties",
  Plugins: "plugins",
  Mods: "mods",
  Schedule: "schedule",
  Backups: "backups",
  Startup: "startup",
  Logs: "logs",
  Settings: "settings",
};

const SLUG_TABS: Record<string, string> = Object.fromEntries(
  Object.entries(TAB_SLUGS).map(([label, slug]) => [slug, label]),
);

export function tabToSlug(tab: string): string {
  return TAB_SLUGS[tab] ?? tab.toLowerCase().replace(/\s+/g, "-");
}

export function slugToTab(slug: string, availableTabs: string[]): string | null {
  const direct = SLUG_TABS[slug];
  if (direct && availableTabs.includes(direct)) return direct;

  if (slug === "plugins" || slug === "mods") {
    const match = availableTabs.find((t) => t === "Plugins" || t === "Mods");
    if (match) return match;
  }

  return null;
}

export function decodeFileSegments(segments: string[]): string {
  return segments.map((s) => decodeURIComponent(s)).join("/");
}

export function encodeFileRelativePath(rel: string): string {
  return rel
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

export function fileRelToAbsolute(rel: string): string {
  const clean = rel.replace(/^\/+/, "");
  return clean ? `/mnt/server/${clean}` : "/mnt/server";
}

export function absoluteToFileRel(abs: string): string {
  const prefix = "/mnt/server";
  if (abs === prefix || abs === `${prefix}/`) return "";
  if (abs.startsWith(`${prefix}/`)) return abs.slice(prefix.length + 1);
  return abs.replace(/^\/+/, "");
}

export function parseServiceRoute(
  segments: string[] | undefined,
  availableTabs: string[],
): { tab: string; fileRelPath?: string; selectedFileRel?: string } {
  if (!segments?.length) {
    return { tab: "Overview" };
  }

  const [head, ...rest] = segments;

  if (head === "files") {
    const rel = rest.length ? decodeFileSegments(rest) : undefined;
    const last = rest[rest.length - 1];
    const looksLikeFile = rel && last && last.includes(".");
    return {
      tab: "Files",
      fileRelPath: rel,
      selectedFileRel: looksLikeFile ? rel : undefined,
    };
  }

  const tab = slugToTab(head, availableTabs);
  return { tab: tab ?? "Overview" };
}

export function buildServicePath(
  serviceId: string,
  tab: string,
  opts?: { fileDirRel?: string; selectedFileRel?: string },
): string {
  const slug = tabToSlug(tab);
  const base = `/services/${serviceId}`;

  if (tab === "Files") {
    const rel = opts?.selectedFileRel ?? opts?.fileDirRel;
    if (rel) {
      return `${base}/files/${encodeFileRelativePath(rel)}`;
    }
    return `${base}/files`;
  }

  return `${base}/${slug}`;
}
