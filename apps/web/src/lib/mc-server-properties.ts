export interface PropertyEntry {
  key: string;
  value: string;
  comment?: string;
}

/** Parse Java server.properties (key=value, # comments). */
export function parseServerProperties(content: string): PropertyEntry[] {
  const entries: PropertyEntry[] = [];
  let pendingComment: string | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      if (trimmed.startsWith("#") && trimmed.length > 1) {
        pendingComment = trimmed.slice(1).trim();
      }
      continue;
    }

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    entries.push({ key, value, comment: pendingComment });
    pendingComment = undefined;
  }

  return entries;
}

export function serialiseServerProperties(entries: PropertyEntry[]): string {
  const lines: string[] = ["#Minecraft server properties", "#Edited via Vivox panel", ""];
  for (const e of entries) {
    if (e.comment) lines.push(`# ${e.comment}`);
    lines.push(`${e.key}=${e.value}`);
  }
  return lines.join("\n") + "\n";
}
