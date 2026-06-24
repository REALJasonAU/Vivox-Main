"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import {
  Terminal as TerminalIcon,
  Trash2,
  Copy,
  Search,
  WrapText,
  ArrowDownToLine,
  Radio,
  ChevronRight,
} from "lucide-react";
import { useTopic } from "@/hooks/useWebSocket";
import { toast } from "@/hooks/useToast";
import { servicesApi } from "@/lib/api";
import type { ConsolePayload, ServiceStatus, StatusPayload } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  serviceId: string;
  /** When false, live streaming pauses (history is kept in the terminal buffer). */
  active?: boolean;
  /** Initial status before WS status topic delivers an update. */
  initialStatus?: ServiceStatus;
  className?: string;
}

const HISTORY_LINES = 100;

const toolbarBtn = {
  whileTap: { scale: 0.96 },
  transition: { duration: 0.12 },
};

export function Console({ serviceId, active = true, initialStatus = "STOPPED", className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const historyLoaded = useRef(false);
  const followRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [lineCount, setLineCount] = useState(0);
  const [command, setCommand] = useState("");
  const [commandFlash, setCommandFlash] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>(initialStatus);
  const inputRef = useRef<HTMLInputElement>(null);

  const isRunning = serviceStatus === "RUNNING";
  const canSend = isRunning && active;

  useEffect(() => {
    setServiceStatus(initialStatus);
  }, [initialStatus]);

  useTopic<StatusPayload>(`service:${serviceId}:status`, (payload) => {
    if (payload?.status) setServiceStatus(payload.status);
  });

  const scrollToBottom = useCallback((smooth = false) => {
    const term = termRef.current;
    if (!term) return;
    if (smooth) {
      requestAnimationFrame(() => term.scrollToBottom());
    } else {
      term.scrollToBottom();
    }
    followRef.current = true;
    setFollow(true);
  }, []);

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        convertEol: true,
        cursorBlink: false,
        disableStdin: true,
        fontFamily: 'var(--font-mono), "JetBrains Mono", ui-monospace, monospace',
        fontSize: 13,
        lineHeight: 1.45,
        scrollback: 10000,
        allowProposedApi: true,
        theme: {
          background: "#00000000",
          foreground: "#e4e4e7",
          cursor: "#e5181b",
          cursorAccent: "#0a0a0c",
          selectionBackground: "#e5181b40",
          black: "#18181b",
          red: "#f87171",
          green: "#34d399",
          yellow: "#fbbf24",
          blue: "#818cf8",
          magenta: "#a78bfa",
          cyan: "#38bdf8",
          white: "#f4f4f5",
          brightBlack: "#71717a",
          brightGreen: "#4ade80",
          brightRed: "#fca5a5",
          brightMagenta: "#c4b5fd",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      try {
        fit.fit();
      } catch {
        /* container not measured yet */
      }

      term.onScroll(() => {
        const buffer = term.buffer.active;
        const atBottom = buffer.viewportY >= buffer.baseY + buffer.length - term.rows;
        if (!atBottom && followRef.current) {
          followRef.current = false;
          setFollow(false);
        }
      });

      termRef.current = term;
      fitRef.current = fit;
      setReady(true);

      resizeObserver = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* ignore */
        }
      });
      resizeObserver.observe(containerRef.current);
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      historyLoaded.current = false;
    };
  }, [serviceId]);

  useEffect(() => {
    if (!ready || historyLoaded.current) return;
    historyLoaded.current = true;
    const term = termRef.current;
    if (!term) return;

    void (async () => {
      try {
        const data = await servicesApi.logs(serviceId, "1h");
        const lines = data.lines.slice(-HISTORY_LINES);
        if (lines.length === 0) {
          term.writeln(
            "\x1b[2m── Vivox console · waiting for output ──\x1b[0m",
          );
          return;
        }
        term.writeln(
          `\x1b[2m── Last ${lines.length} log lines ──\x1b[0m`,
        );
        for (const line of lines) {
          const text = line.line;
          const colored =
            line.s === "stderr" ? `\x1b[31m${text}\x1b[0m` : text;
          term.writeln(colored);
        }
        term.writeln("\x1b[2m── Live stream ──\x1b[0m");
        setLineCount(lines.length);
        scrollToBottom();
      } catch {
        term.writeln(
          "\x1b[2m── Vivox console · connect logs when the service is running ──\x1b[0m",
        );
      }
    })();
  }, [ready, serviceId, scrollToBottom]);

  useEffect(() => {
    if (!searchOpen || !ready) return;
    let cancelled = false;
    (async () => {
      const { SearchAddon } = await import("@xterm/addon-search");
      if (cancelled || !termRef.current) return;
      const addon = new SearchAddon();
      termRef.current.loadAddon(addon);
      searchRef.current = addon;
    })();
    return () => {
      cancelled = true;
    };
  }, [searchOpen, ready]);

  useTopic<ConsolePayload>(
    ready && active ? `service:${serviceId}:console` : null,
    (payload) => {
      const term = termRef.current;
      if (!term || !payload) return;
      const text = typeof payload === "string" ? payload : payload.text;
      if (typeof text !== "string") return;
      const colored =
        payload && payload.stream === "stderr" ? `\x1b[31m${text}\x1b[0m` : text;
      term.write(colored);
      setLineCount((n) => n + (text.split("\n").length - 1 || 1));
      if (followRef.current) {
        scrollToBottom(true);
      }
    },
  );

  const clearConsole = () => {
    termRef.current?.clear();
    setLineCount(0);
  };

  const copyAll = async () => {
    const term = termRef.current;
    if (!term) return;
    term.selectAll();
    const selection = term.getSelection();
    if (selection) {
      try {
        await navigator.clipboard.writeText(selection);
      } catch {
        document.execCommand("copy");
      }
    }
    term.clearSelection();
  };

  const findNext = () => {
    if (searchQuery && searchRef.current) {
      searchRef.current.findNext(searchQuery, { caseSensitive: false });
    }
  };

  const findPrevious = () => {
    if (searchQuery && searchRef.current) {
      searchRef.current.findPrevious(searchQuery, { caseSensitive: false });
    }
  };

  const sendCommand = () => {
    const trimmed = command.trim();
    if (!trimmed) return;

    if (!isRunning) {
      toast("Start the server to send commands", "info");
      return;
    }

    if (!active) {
      toast("Switch to the Console tab to send commands", "info");
      return;
    }

    const term = termRef.current;
    if (term) {
      term.writeln(`\x1b[2m\x1b[38;5;245m>> ${trimmed}\x1b[0m`);
      scrollToBottom(true);
    }

    setCommand("");
    setCommandFlash(true);
    setTimeout(() => setCommandFlash(false), 320);

    toast(
      "Console output is read-only — direct command input is not supported yet. Use RCON or in-game console for game commands.",
      "info",
    );
  };

  return (
    <div
      className={cn(
        "relative flex min-h-[60vh] flex-col overflow-hidden rounded-xl border border-border bg-surface",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-raised/30 px-3 py-2">
        <TerminalIcon className="size-3.5 shrink-0 text-muted" />
        <span className="font-mono text-xs font-medium text-foreground">Console</span>

        <AnimatePresence mode="wait">
          {active ? (
            <motion.span
              key="live"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400"
            >
              <Radio className="size-2.5 animate-pulse" />
              Live
            </motion.span>
          ) : (
            <motion.span
              key="paused"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-[10px] text-subtle"
            >
              Paused
            </motion.span>
          )}
        </AnimatePresence>

        <span className="text-[10px] text-subtle">· {lineCount.toLocaleString()} lines</span>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <motion.div {...toolbarBtn}>
            <Button variant="ghost" size="sm" onClick={clearConsole}>
              <Trash2 className="size-3.5" /> Clear
            </Button>
          </motion.div>
          <motion.div {...toolbarBtn}>
            <Button variant="ghost" size="sm" onClick={() => void copyAll()}>
              <Copy className="size-3.5" /> Copy
            </Button>
          </motion.div>
          <motion.div {...toolbarBtn}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchOpen((o) => !o)}
              className={searchOpen ? "text-vivox-400" : undefined}
            >
              <Search className="size-3.5" /> Find
            </Button>
          </motion.div>
          <motion.div {...toolbarBtn}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWrap((w) => !w)}
              className={wrap ? "text-vivox-400" : undefined}
            >
              <WrapText className="size-3.5" /> Wrap
            </Button>
          </motion.div>
          <motion.div {...toolbarBtn}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => scrollToBottom()}
              className={follow ? "text-vivox-400" : undefined}
            >
              <ArrowDownToLine className="size-3.5" />
              {follow ? "Following" : "Follow"}
            </Button>
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {searchOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-b border-border"
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") findNext();
                  if (e.key === "Escape") setSearchOpen(false);
                }}
                placeholder="Search output…"
                className="h-8 flex-1 rounded-lg border border-border bg-background/50 px-2 font-mono text-xs text-foreground outline-none transition-all duration-200 focus:border-border-focus focus:ring-1 focus:ring-border-focus"
              />
              <Button variant="ghost" size="sm" onClick={findPrevious}>
                Prev
              </Button>
              <Button variant="ghost" size="sm" onClick={findNext}>
                Next
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative min-h-0 flex-1 bg-[#08080a]">
        <div
          ref={containerRef}
          data-wrap={wrap}
          className={cn(
            "h-full w-full px-2 py-2",
            wrap ? "overflow-x-hidden" : "overflow-x-auto",
          )}
          role="log"
          aria-label="Service console output"
        />

        <AnimatePresence>
          {!follow && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              onClick={() => scrollToBottom()}
              className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-lg border border-vivox-500/40 bg-vivox-500/15 px-3 py-1.5 text-xs text-vivox-300 shadow-lg backdrop-blur-sm transition-colors hover:bg-vivox-500/25"
            >
              <ArrowDownToLine className="size-3.5" />
              Jump to latest
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <motion.div
        animate={
          commandFlash
            ? { borderColor: "rgba(229, 24, 27, 0.5)", backgroundColor: "rgba(229, 24, 27, 0.04)" }
            : { borderColor: "var(--border)", backgroundColor: "rgba(255,255,255,0.02)" }
        }
        transition={{ duration: 0.28 }}
        className="shrink-0 border-t border-border"
      >
        <form
          className="flex items-center gap-2 px-3 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            sendCommand();
          }}
        >
          <ChevronRight className="size-4 shrink-0 text-vivox-400" aria-hidden />
          <ChevronRight className="-ml-3 size-4 shrink-0 text-vivox-400/70" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={!canSend}
            placeholder={
              canSend
                ? "Type a command…"
                : isRunning
                  ? "Switch to Console tab to send commands"
                  : "Start server to send commands…"
            }
            className={cn(
              "min-w-0 flex-1 bg-transparent font-mono text-sm text-foreground placeholder:text-subtle outline-none transition-all duration-200",
              "focus:placeholder:text-muted",
              !canSend && "cursor-not-allowed opacity-50",
            )}
            aria-label="Console command input"
          />
        </form>
      </motion.div>
    </div>
  );
}
