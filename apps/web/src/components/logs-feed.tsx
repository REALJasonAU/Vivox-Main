"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Download, Pause, Play, RefreshCw, Search, Trash2 } from "lucide-react";
import { useTopic } from "@/hooks/useWebSocket";
import { servicesApi } from "@/lib/api";
import type { ConsolePayload } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/utils";

interface Line {
  id: number;
  ts: number;
  stream: "stdout" | "stderr";
  text: string;
}

type LogMode = "live" | "history";
type HistRange = "1h" | "6h" | "24h";

const MAX_LINES = 1000;
const PAUSE_BUFFER_MAX = 200;

function highlightText(text: string, filter: string) {
  if (!filter) return text;
  const lower = filter.toLowerCase();
  const idx = text.toLowerCase().indexOf(lower);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-yellow-500/30 px-0.5 text-yellow-200">
        {text.slice(idx, idx + filter.length)}
      </mark>
      {text.slice(idx + filter.length)}
    </>
  );
}

export function LogsFeed({ serviceId }: { serviceId: string }) {
  const [mode, setMode] = useState<LogMode>("live");
  const [histRange, setHistRange] = useState<HistRange>("1h");
  const [histStream, setHistStream] = useState<"all" | "stdout" | "stderr">("all");
  const [histSearch, setHistSearch] = useState("");
  const [histLines, setHistLines] = useState<Line[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histTruncated, setHistTruncated] = useState(false);
  const [histTotal, setHistTotal] = useState(0);

  const [liveLines, setLiveLines] = useState<Line[]>([]);
  const [filter, setFilter] = useState("");
  const [showStdout, setShowStdout] = useState(true);
  const [showStderr, setShowStderr] = useState(true);
  const [paused, setPaused] = useState(false);
  const counter = useRef(0);
  const histCounter = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pauseBuffer = useRef<Line[]>([]);

  useTopic<ConsolePayload>(`service:${serviceId}:console`, (payload) => {
    if (mode !== "live") return;
    if (!payload || typeof payload.text !== "string") return;
    const line: Line = {
      id: counter.current++,
      ts: payload.timestamp || Date.now() / 1000,
      stream: (payload.stream as "stdout" | "stderr") ?? "stdout",
      text: payload.text.replace(/\n$/, ""),
    };

    if (paused) {
      pauseBuffer.current = [...pauseBuffer.current, line].slice(-PAUSE_BUFFER_MAX);
      return;
    }

    setLiveLines((prev) => {
      const next = [...prev, line];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  });

  const fetchHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const data = await servicesApi.logs(
        serviceId,
        histRange,
        histSearch || undefined,
        histStream !== "all" ? histStream : undefined,
      );
      histCounter.current = 0;
      setHistLines(
        data.lines.map((l) => ({
          id: histCounter.current++,
          ts: l.t,
          stream: (l.s as "stdout" | "stderr") || "stdout",
          text: l.line,
        })),
      );
      setHistTruncated(data.truncated);
      setHistTotal(data.total);
    } catch {
      setHistLines([]);
    } finally {
      setHistLoading(false);
    }
  }, [serviceId, histRange, histStream, histSearch]);

  useEffect(() => {
    if (mode === "history") void fetchHistory();
  }, [mode, histRange, histStream, fetchHistory]);

  const flushPauseBuffer = () => {
    if (pauseBuffer.current.length === 0) return;
    setLiveLines((prev) => {
      const next = [...prev, ...pauseBuffer.current];
      pauseBuffer.current = [];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  };

  const togglePause = () => {
    setPaused((p) => {
      if (p) flushPauseBuffer();
      return !p;
    });
  };

  const activeFilter = mode === "history" ? histSearch : filter;
  const stdoutOn = mode === "history" ? histStream === "all" || histStream === "stdout" : showStdout;
  const stderrOn = mode === "history" ? histStream === "all" || histStream === "stderr" : showStderr;

  const sourceLines = mode === "live" ? liveLines : histLines;

  const visibleLines = useMemo(() => {
    const q = activeFilter.trim().toLowerCase();
    return sourceLines.filter((line) => {
      if (line.stream === "stdout" && !stdoutOn) return false;
      if (line.stream === "stderr" && !stderrOn) return false;
      if (mode === "live" && q && !line.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sourceLines, activeFilter, stdoutOn, stderrOn, mode]);

  useEffect(() => {
    if (mode === "live" && !paused) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [visibleLines, paused, mode]);

  const download = () => {
    const body = sourceLines
      .map((l) => `${new Date(l.ts * 1000).toISOString()} ${l.stream}: ${l.text}`)
      .join("\n");
    const blob = new Blob([body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `service-${serviceId}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const nearLimit = mode === "live" && liveLines.length >= MAX_LINES * 0.9;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-background/50 p-0.5">
          <motion.button
            type="button"
            onClick={() => setMode("live")}
            whileTap={{ scale: 0.95 }}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium",
              mode === "live" ? "bg-surface-raised text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-1.5">
              {mode === "live" && (
                <span className="size-1.5 animate-status-pulse rounded-full bg-vivox-500" />
              )}
              Live
            </span>
          </motion.button>
          <motion.button
            type="button"
            onClick={() => setMode("history")}
            whileTap={{ scale: 0.95 }}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium",
              mode === "history" ? "bg-surface-raised text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            History
          </motion.button>
        </div>

        {mode === "history" && (
          <>
            <div className="flex gap-1 rounded-lg border border-border bg-background/50 p-0.5">
              {(["1h", "6h", "24h"] as HistRange[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setHistRange(r)}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs",
                    histRange === r ? "bg-surface-raised text-foreground" : "text-muted",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => void fetchHistory()} loading={histLoading}>
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
          </>
        )}

        <div className="relative min-w-[140px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            value={mode === "history" ? histSearch : filter}
            onChange={(e) => (mode === "history" ? setHistSearch(e.target.value) : setFilter(e.target.value))}
            onKeyDown={(e) => {
              if (mode === "history" && e.key === "Enter") void fetchHistory();
            }}
            placeholder="Search…"
            className="h-9 w-full rounded-lg border border-border bg-background/50 pl-8 pr-3 text-sm text-foreground outline-none focus:border-border-focus"
          />
        </div>

        <Button
          variant={stdoutOn ? "secondary" : "ghost"}
          size="sm"
          onClick={() => {
            if (mode === "history") {
              setHistStream((s) => (s === "stderr" ? "all" : s === "all" ? "stdout" : "stderr"));
            } else setShowStdout((v) => !v);
          }}
        >
          stdout
        </Button>
        <Button
          variant={stderrOn ? "secondary" : "ghost"}
          size="sm"
          onClick={() => {
            if (mode === "history") {
              setHistStream((s) => (s === "stdout" ? "all" : s === "all" ? "stderr" : "stdout"));
            } else setShowStderr((v) => !v);
          }}
        >
          stderr
        </Button>
        <Button variant="ghost" size="sm" actionType="download" onClick={download} disabled={sourceLines.length === 0}>
          <Download className="size-3.5" /> Download
        </Button>
        {mode === "live" && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setLiveLines([])}>
              <Trash2 className="size-3.5" /> Clear
            </Button>
            <Button variant="ghost" size="sm" onClick={togglePause}>
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {paused ? "Resume" : "Pause"}
            </Button>
          </>
        )}
        <span
          className={cn(
            "ml-auto text-xs font-mono",
            nearLimit || histTruncated ? "text-amber-400" : "text-muted",
          )}
        >
          {mode === "history"
            ? `${visibleLines.length}${histTruncated ? " / ~truncated" : ""} lines`
            : `${liveLines.length}${nearLimit ? ` / ${MAX_LINES}` : " lines"}`}
        </span>
      </div>

      {mode === "history" && histTruncated && (
        <p className="text-xs text-amber-400/90">
          Showing newest 2,000 lines. Narrow the time range or add a search filter.
        </p>
      )}

      <div className="relative max-h-[520px] overflow-y-auto rounded-xl border border-border bg-surface p-4 font-mono text-xs leading-relaxed">
        {histLoading && mode === "history" && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-surface/80">
            <Skeleton className="h-8 w-32" />
          </div>
        )}
        {visibleLines.length === 0 ? (
          <p className="py-8 text-center text-muted">
            {sourceLines.length === 0
              ? mode === "live"
                ? "Waiting for log output…"
                : "No log lines in this range"
              : "No lines match the current filter"}
          </p>
        ) : (
          visibleLines.map((line) => (
            <div key={line.id} className="flex gap-3 hover:bg-[#1c1c20]">
              <span className="shrink-0 text-subtle">
                {new Date(line.ts * 1000).toLocaleTimeString()}
              </span>
              <span
                className={cn(
                  "whitespace-pre-wrap break-all",
                  line.stream === "stderr" ? "text-red-400" : "text-muted",
                )}
              >
                {highlightText(line.text, activeFilter.trim())}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
