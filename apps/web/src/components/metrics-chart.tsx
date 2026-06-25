"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Cpu, HardDrive, MemoryStick, Network } from "lucide-react";
import { useTopic } from "@/hooks/useWebSocket";
import { servicesApi } from "@/lib/api";
import type { MetricsPayload } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";
import { Skeleton } from "@/components/ui/states";

interface Point {
  t: number;
  cpu: number;
  mem: number;
  memBytes: number;
  diskBytes: number;
  disk: number;
  netRxBytes: number;
  netTxBytes: number;
  netRate: number;
}

type Range = "live" | "15m" | "1h" | "6h" | "24h";
type ChartKey = "cpu" | "mem" | "disk" | "net";

const MAX_POINTS = 60;
const RANGES: Range[] = ["live", "15m", "1h", "6h", "24h"];

function bytesPerSecLabel(bps: number): string {
  if (!bps || bps <= 0) return "0 B/s";
  return `${formatBytes(bps)}/s`;
}

function netRateFromPoints(prev: Point | undefined, t: number, rx: number, tx: number): number {
  if (!prev || t <= prev.t) return 0;
  const dt = (t - prev.t) / 1000;
  if (dt <= 0) return 0;
  const dRx = Math.max(0, rx - prev.netRxBytes);
  const dTx = Math.max(0, tx - prev.netTxBytes);
  return (dRx + dTx) / dt;
}

function mapHistRows(
  rows: { t: number; cpu: number; mem: number; disk?: number; net_rx?: number; net_tx?: number }[],
  memLimitBytes: number,
  diskLimitBytes: number,
): Point[] {
  const out: Point[] = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    const rx = r.net_rx ?? 0;
    const tx = r.net_tx ?? 0;
    const diskBytes = r.disk ?? 0;
    out.push({
      t: r.t,
      cpu: r.cpu,
      memBytes: r.mem,
      mem:
        memLimitBytes > 0
          ? Number(((r.mem / memLimitBytes) * 100).toFixed(1))
          : r.mem,
      diskBytes,
      disk:
        diskLimitBytes > 0
          ? Number(((diskBytes / diskLimitBytes) * 100).toFixed(1))
          : diskBytes,
      netRxBytes: rx,
      netTxBytes: tx,
      netRate: netRateFromPoints(prev, r.t, rx, tx),
    });
  }
  return out;
}

export function MetricsChart({
  serviceId,
  memoryLimitMb,
  diskLimitGb,
}: {
  serviceId: string;
  memoryLimitMb?: number;
  diskLimitGb?: number;
}) {
  const [range, setRange] = useState<Range>("live");
  const [livePoints, setLivePoints] = useState<Point[]>([]);
  const [histPoints, setHistPoints] = useState<Point[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const memLimitBytes = useMemo(
    () => (memoryLimitMb && memoryLimitMb > 0 ? memoryLimitMb * 1024 * 1024 : 0),
    [memoryLimitMb],
  );

  const diskLimitBytes = useMemo(
    () => (diskLimitGb && diskLimitGb > 0 ? diskLimitGb * 1024 * 1024 * 1024 : 0),
    [diskLimitGb],
  );

  const toMemChartValue = (bytes: number) => {
    if (memLimitBytes > 0) {
      return Number(((bytes / memLimitBytes) * 100).toFixed(1));
    }
    return bytes;
  };

  const toDiskChartValue = (bytes: number) => {
    if (diskLimitBytes > 0) {
      return Number(((bytes / diskLimitBytes) * 100).toFixed(1));
    }
    return bytes;
  };

  useTopic<MetricsPayload>(`service:${serviceId}:metrics`, (payload) => {
    if (range !== "live") return;
    if (!payload || typeof payload.cpu_usage_percent !== "number") return;
    const t = payload.timestamp || Date.now();
    const memBytes = payload.memory_bytes_used ?? 0;
    const diskBytes = payload.disk_bytes_used ?? 0;
    const rx = payload.network_rx_bytes ?? 0;
    const tx = payload.network_tx_bytes ?? 0;

    setLivePoints((prev) => {
      const last = prev[prev.length - 1];
      const netRate = netRateFromPoints(last, t, rx, tx);
      const next = [
        ...prev,
        {
          t,
          cpu: Number(payload.cpu_usage_percent.toFixed(1)),
          mem: toMemChartValue(memBytes),
          memBytes,
          diskBytes,
          disk: toDiskChartValue(diskBytes),
          netRxBytes: rx,
          netTxBytes: tx,
          netRate,
        },
      ];
      return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
    });
  });

  useEffect(() => {
    if (range === "live") {
      setHistPoints([]);
      return;
    }
    setHistLoading(true);
    servicesApi
      .metrics(serviceId, range)
      .then((rows) => setHistPoints(mapHistRows(rows, memLimitBytes, diskLimitBytes)))
      .catch(() => setHistPoints([]))
      .finally(() => setHistLoading(false));
  }, [range, serviceId, memLimitBytes, diskLimitBytes]);

  const points = range === "live" ? livePoints : histPoints;
  const latest = points[points.length - 1];
  const loading = range !== "live" && histLoading;
  const memAsPercent = memLimitBytes > 0;
  const diskAsPercent = diskLimitBytes > 0;

  const memDisplay = latest
    ? memAsPercent
      ? `${latest.mem}%`
      : formatBytes(latest.memBytes)
    : "—";

  const diskDisplay = latest
    ? diskAsPercent
      ? `${latest.disk}%`
      : formatBytes(latest.diskBytes)
    : "—";

  const netDisplay = latest ? bytesPerSecLabel(latest.netRate) : "—";

  return (
    <div className="flex flex-col gap-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted">Performance</span>
        <div className="flex gap-1 rounded-lg border border-border bg-background/50 p-0.5">
          {RANGES.map((r) => (
            <motion.button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              whileTap={{ scale: 0.95 }}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                range === r
                  ? "bg-surface-raised text-foreground"
                  : "text-muted hover:text-foreground",
              )}
            >
              {r === "live" ? (
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 animate-status-pulse rounded-full bg-vivox-500" />
                  Live
                </span>
              ) : (
                r
              )}
            </motion.button>
          ))}
        </div>
      </div>

      <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-2">
        {loading && (
          <div className="absolute inset-0 z-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-[196px] rounded-xl" />
            <Skeleton className="h-[196px] rounded-xl" />
            <Skeleton className="h-[196px] rounded-xl" />
            <Skeleton className="h-[196px] rounded-xl" />
          </div>
        )}
        <Panel icon={<Cpu className="size-4" />} title="CPU" value={latest ? `${latest.cpu}%` : "—"}>
          <Chart data={points} dataKey="cpu" color="229 24 27" unit="%" domain={[0, 100]} />
        </Panel>
        <Panel icon={<MemoryStick className="size-4" />} title="Memory" value={memDisplay}>
          <Chart
            data={points}
            dataKey="mem"
            color="16 185 129"
            unit={memAsPercent ? "%" : undefined}
            domain={memAsPercent ? [0, 100] : undefined}
            formatTooltip={(v, point) =>
              memAsPercent
                ? `${v}% (${formatBytes(point.memBytes)})`
                : formatBytes(point.memBytes)
            }
          />
        </Panel>
        <Panel icon={<Network className="size-4" />} title="Network" value={netDisplay}>
          <Chart
            data={points}
            dataKey="net"
            color="56 189 248"
            formatTooltip={(v) => bytesPerSecLabel(v)}
          />
        </Panel>
        <Panel icon={<HardDrive className="size-4" />} title="Storage" value={diskDisplay}>
          <Chart
            data={points}
            dataKey="disk"
            color="168 85 247"
            unit={diskAsPercent ? "%" : undefined}
            domain={diskAsPercent ? [0, 100] : undefined}
            formatTooltip={(v, point) =>
              diskAsPercent
                ? `${v}% (${formatBytes(point.diskBytes)})`
                : formatBytes(point.diskBytes)
            }
          />
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  icon,
  title,
  value,
  children,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm uppercase tracking-wider text-muted">
          <span className="text-vivox-400">{icon}</span>
          {title}
        </span>
        <span className="font-mono text-lg font-medium tracking-tight tabular-nums text-foreground">
          {value}
        </span>
      </div>
      <div className="h-36">{children}</div>
    </div>
  );
}

function Chart({
  data,
  dataKey,
  color,
  unit,
  domain,
  formatTooltip,
}: {
  data: Point[];
  dataKey: ChartKey;
  color: string;
  unit?: string;
  domain?: [number, number];
  formatTooltip?: (value: number, point: Point) => string;
}) {
  if (data.length === 0) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted">
        Waiting for metrics…
      </div>
    );
  }

  const gradId = `grad-${dataKey}`;
  const seriesKey = dataKey === "net" ? "netRate" : dataKey;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`rgb(${color})`} stopOpacity={0.35} />
            <stop offset="100%" stopColor={`rgb(${color})`} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" hide />
        <YAxis
          hide
          domain={domain ?? (dataKey === "cpu" ? [0, 100] : ["auto", "auto"])}
        />
        <Tooltip
          contentStyle={{
            background: "#18181b",
            border: "1px solid #27272a",
            borderRadius: 8,
            fontSize: 12,
            color: "#f4f4f5",
          }}
          labelFormatter={() => ""}
          formatter={(v: number, _name, item) => {
            const point = item.payload as Point;
            if (formatTooltip) {
              const label =
                dataKey === "cpu"
                  ? "CPU"
                  : dataKey === "mem"
                    ? "Memory"
                    : dataKey === "disk"
                      ? "Storage"
                      : "Network";
              return [formatTooltip(v, point), label];
            }
            return [`${v}${unit ?? ""}`, dataKey === "cpu" ? "CPU" : "Memory"];
          }}
        />
        <Area
          type="monotone"
          dataKey={seriesKey}
          stroke={`rgb(${color})`}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
