"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Cpu, MemoryStick } from "lucide-react";
import { useTopic } from "@/hooks/useWebSocket";
import { servicesApi } from "@/lib/api";
import type { MetricsPayload } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";
import { Skeleton } from "@/components/ui/states";

interface Point {
  t: number;
  cpu: number;
  mem: number;
}

type Range = "live" | "15m" | "1h" | "6h" | "24h";

const MAX_POINTS = 60;
const RANGES: Range[] = ["live", "15m", "1h", "6h", "24h"];

export function MetricsChart({ serviceId }: { serviceId: string }) {
  const [range, setRange] = useState<Range>("live");
  const [livePoints, setLivePoints] = useState<Point[]>([]);
  const [histPoints, setHistPoints] = useState<Point[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  useTopic<MetricsPayload>(`service:${serviceId}:metrics`, (payload) => {
    if (range !== "live") return;
    if (!payload || typeof payload.cpu_usage_percent !== "number") return;
    setLivePoints((prev) => {
      const next = [
        ...prev,
        {
          t: payload.timestamp || Date.now(),
          cpu: Number(payload.cpu_usage_percent.toFixed(1)),
          mem: payload.memory_bytes_used,
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
      .then(setHistPoints)
      .catch(() => setHistPoints([]))
      .finally(() => setHistLoading(false));
  }, [range, serviceId]);

  const points = range === "live" ? livePoints : histPoints;
  const latest = points[points.length - 1];
  const loading = range !== "live" && histLoading;

  return (
    <div className="flex flex-col gap-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-zinc-500">Performance</span>
        <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950/50 p-0.5">
          {RANGES.map((r) => (
            <motion.button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              whileTap={{ scale: 0.95 }}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                range === r
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300",
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
          </div>
        )}
        <Panel
          icon={<Cpu className="size-4" />}
          title="CPU"
          value={latest ? `${latest.cpu}%` : "—"}
        >
          <Chart data={points} dataKey="cpu" color="229 24 27" unit="%" />
        </Panel>
        <Panel
          icon={<MemoryStick className="size-4" />}
          title="Memory"
          value={latest ? formatBytes(latest.mem) : "—"}
        >
          <Chart data={points} dataKey="mem" color="16 185 129" formatBytes />
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
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm uppercase tracking-wider text-zinc-500">
          <span className="text-vivox-400">{icon}</span>
          {title}
        </span>
        <span className="font-mono text-lg font-medium tracking-tight tabular-nums text-zinc-100">
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
  formatBytes: asBytes,
}: {
  data: Point[];
  dataKey: "cpu" | "mem";
  color: string;
  unit?: string;
  formatBytes?: boolean;
}) {
  if (data.length === 0) {
    return (
      <div className="grid h-full place-items-center text-xs text-zinc-500">
        Waiting for metrics…
      </div>
    );
  }

  const gradId = `grad-${dataKey}`;
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
        <YAxis hide domain={dataKey === "cpu" ? [0, 100] : ["auto", "auto"]} />
        <Tooltip
          contentStyle={{
            background: "#18181b",
            border: "1px solid #27272a",
            borderRadius: 8,
            fontSize: 12,
            color: "#f4f4f5",
          }}
          labelFormatter={() => ""}
          formatter={(v: number) => [
            asBytes ? formatBytesValue(v) : `${v}${unit ?? ""}`,
            dataKey === "cpu" ? "CPU" : "Memory",
          ]}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={`rgb(${color})`}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function formatBytesValue(bytes: number): string {
  return formatBytes(bytes);
}
