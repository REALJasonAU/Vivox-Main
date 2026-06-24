export function parseEnvFile(text: string): { key: string; value: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const idx = line.indexOf("=");
      const key = line.slice(0, idx).trim();
      const raw = line.slice(idx + 1).trim();
      const value = raw.replace(/^["']|["']$/g, "");
      return { key, value };
    });
}

export function mergeEnvRows(
  existing: { key: string; value: string }[],
  imported: { key: string; value: string }[],
): { key: string; value: string }[] {
  const map = new Map(existing.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));
  for (const row of imported) {
    if (row.key.trim()) map.set(row.key.trim(), row.value);
  }
  const merged = Array.from(map.entries()).map(([key, value]) => ({ key, value }));
  return merged.length > 0 ? merged : [{ key: "", value: "" }];
}
