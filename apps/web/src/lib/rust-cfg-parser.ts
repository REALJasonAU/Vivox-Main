import type { RustConvar } from "./types";

export interface CfgEntry {
  key: string;
  value: string;
  rawLine: string;
  isComment: boolean;
  isBlank: boolean;
}

export function parseCfg(content: string): CfgEntry[] {
  return content.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return { key: "", value: "", rawLine: line, isComment: false, isBlank: true };
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("#")) {
      return { key: trimmed, value: "", rawLine: line, isComment: true, isBlank: false };
    }
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx === -1) {
      return { key: trimmed, value: "", rawLine: line, isComment: false, isBlank: false };
    }
    const key = trimmed.slice(0, spaceIdx);
    const value = trimmed.slice(spaceIdx + 1).trim();
    return { key, value, rawLine: line, isComment: false, isBlank: false };
  });
}

export function serialiseCfg(entries: CfgEntry[]): string {
  return entries
    .map((e) => {
      if (e.isBlank) return "";
      if (e.isComment) return e.key;
      const v = e.value;
      const needsQuotes =
        typeof v === "string" && v.includes(" ") && !v.startsWith('"');
      return `${e.key} ${needsQuotes ? `"${v}"` : v}`;
    })
    .join("\n");
}

export function mergeEditsIntoCfg(
  entries: CfgEntry[],
  edits: Record<string, string>,
  deletedKeys: Set<string>,
): CfgEntry[] {
  const handled = new Set<string>();
  const result: CfgEntry[] = [];

  for (const entry of entries) {
    if (entry.isBlank || entry.isComment) {
      result.push(entry);
      continue;
    }
    if (deletedKeys.has(entry.key)) continue;
    if (entry.key in edits) {
      result.push({
        ...entry,
        value: edits[entry.key],
        rawLine: `${entry.key} ${edits[entry.key]}`,
      });
      handled.add(entry.key);
    } else {
      result.push(entry);
    }
  }

  for (const [key, value] of Object.entries(edits)) {
    if (!handled.has(key)) {
      result.push({
        key,
        value,
        rawLine: `${key} ${value}`,
        isComment: false,
        isBlank: false,
      });
    }
  }

  return result;
}

export function defaultValueStr(convar: RustConvar): string {
  const v = convar.DefaultValue;
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export function isModified(value: string, convar: RustConvar): boolean {
  const def = defaultValueStr(convar);
  if (!def) return false;
  const normValue =
    value.toLowerCase() === "1"
      ? "true"
      : value.toLowerCase() === "0"
        ? "false"
        : value.toLowerCase();
  return normValue !== def.toLowerCase();
}

export function groupConvarsByCategory(
  convars: RustConvar[],
): Record<string, RustConvar[]> {
  const groups: Record<string, RustConvar[]> = {};
  for (const cv of convars) {
    const dotIdx = cv.Name.indexOf(".");
    const category = dotIdx > -1 ? cv.Name.slice(0, dotIdx) : "misc";
    if (!groups[category]) groups[category] = [];
    groups[category].push(cv);
  }
  return groups;
}

export function prettyCategoryName(key: string): string {
  const overrides: Record<string, string> = {
    bradleyapc: "Bradley APC",
    cargoship: "Cargo Ship",
    patrolhelicopterai: "Patrol Helicopter",
    npcvendingmachine: "NPC Vending Machine",
    hackablelockedcrate: "Hackable Crate",
    ioentity: "Electrical",
    hotairballoon: "Hot Air Balloon",
    motorrowboat: "Rowboat",
    basesubmarine: "Submarine",
    ridablehorse: "Horse",
    snowmobile: "Snowmobile",
    playerboat: "Player Boat",
    traincar: "Train",
    treemanager: "Trees",
    relationshipmanager: "Clans / Teams",
    wipetimer: "Wipe Timer",
    fps: "Performance",
    server: "Server",
    decay: "Decay",
    env: "Environment",
    antihack: "Anti-Cheat",
    chat: "Chat",
  };
  if (key in overrides) return overrides[key];
  return (
    key.charAt(0).toUpperCase() +
    key.slice(1).replace(/([a-z])([A-Z])/g, "$1 $2")
  );
}
