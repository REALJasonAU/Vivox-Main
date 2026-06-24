import type { ResourceLimits } from "@/lib/types";

export const BACKUP_STORAGE_OPTIONS = [
  { value: "node_local", label: "Node local", path: "/var/lib/vivox/backups" },
  { value: "node_custom", label: "Custom path on node" },
] as const;

export const DATABASE_TYPE_OPTIONS = [
  { id: "postgresql", label: "PostgreSQL" },
  { id: "mysql", label: "MySQL" },
  { id: "mariadb", label: "MariaDB" },
  { id: "redis", label: "Redis" },
  { id: "mongodb", label: "MongoDB" },
] as const;

export function hasBackupAllocation(limits: ResourceLimits | undefined): boolean {
  return (limits?.max_backups ?? 0) > 0;
}

export function backupStorageLabel(storage: string | undefined): string {
  if (!storage || storage === "node_local") {
    return BACKUP_STORAGE_OPTIONS[0].path;
  }
  return storage;
}

export function activeBackupCount(
  backups: { status: string }[] | null | undefined,
): number {
  if (!backups) return 0;
  return backups.filter((b) =>
    ["pending", "running", "success"].includes(b.status),
  ).length;
}
