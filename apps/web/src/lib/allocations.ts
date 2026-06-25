import type { Backup, ResourceLimits } from "./types";

/** Default on-node backup directory (matches agent `backup.BackupDir`). */
export const DEFAULT_BACKUP_DIR = "/var/lib/vivox/backups";

export type BackupStorageOption = {
  value: string;
  label: string;
  path?: string;
};

export const BACKUP_STORAGE_OPTIONS: BackupStorageOption[] = [
  {
    value: "node_local",
    label: "Node local",
    path: DEFAULT_BACKUP_DIR,
  },
  {
    value: "node_custom",
    label: "Custom path on node",
  },
];

export const DATABASE_TYPE_OPTIONS = [
  { id: "postgres", label: "PostgreSQL" },
  { id: "mysql", label: "MySQL / MariaDB" },
  { id: "redis", label: "Redis" },
  { id: "mongodb", label: "MongoDB" },
] as const;

export function backupStorageLabel(storage: string | undefined): string {
  if (!storage?.trim()) {
    return `Node local (${DEFAULT_BACKUP_DIR})`;
  }
  if (storage === "node_local" || storage === DEFAULT_BACKUP_DIR) {
    return `Node local (${DEFAULT_BACKUP_DIR})`;
  }
  const preset = BACKUP_STORAGE_OPTIONS.find((o) => o.value === storage);
  if (preset) {
    return preset.path ? `${preset.label} (${preset.path})` : preset.label;
  }
  return storage;
}

export function hasBackupAllocation(limits: ResourceLimits): boolean {
  return (limits.max_backups ?? 0) > 0;
}

/** Count backups that consume a slot (pending, running, or success). */
export function activeBackupCount(backups: Backup[] | null | undefined): number {
  if (!backups?.length) return 0;
  return backups.filter((b) => b.status === "pending" || b.status === "running" || b.status === "success")
    .length;
}

/** CPU shares use Docker's weight scale: 1024 shares ≈ one full CPU core. */
export function cpuSharesToPercent(cpuShares: number): number {
  if (!cpuShares || cpuShares <= 0) return 0;
  return Math.round((cpuShares / 1024) * 100);
}

export function formatCpuLimit(cpuShares: number): string {
  if (!cpuShares || cpuShares <= 0) return "—";
  const pct = cpuSharesToPercent(cpuShares);
  const cores = cpuShares / 1024;
  const coreLabel =
    cores === 1 ? "1 core" : Number.isInteger(cores) ? `${cores} cores` : `${cores.toFixed(1)} cores`;
  return `${pct}% (${coreLabel})`;
}

export function formatMemoryLimit(memoryMb: number): string {
  if (!memoryMb || memoryMb <= 0) return "—";
  if (memoryMb >= 1024 && memoryMb % 1024 === 0) {
    return `${memoryMb / 1024} GB (${memoryMb.toLocaleString()} MB)`;
  }
  return `${memoryMb.toLocaleString()} MB`;
}

export function formatStorageLimit(diskGb: number): string {
  if (!diskGb || diskGb <= 0) return "—";
  return `${diskGb} GB`;
}

/** Docker CPU shares → whole-thread count (1024 shares = 1 thread). */
export function cpuSharesToThreads(cpuShares: number): number {
  if (!cpuShares || cpuShares <= 0) return 1;
  return Math.max(1, Math.round(cpuShares / 1024));
}

export function threadsToCpuShares(threads: number): number {
  return Math.max(1, threads) * 1024;
}
