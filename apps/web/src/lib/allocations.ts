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
