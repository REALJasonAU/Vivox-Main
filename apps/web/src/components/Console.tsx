"use client";

import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import {
  Terminal as TerminalIcon,
  Trash2,
  Copy,
  Search,
  WrapText,
} from "lucide-react";
import { useTopic } from "@/hooks/useWebSocket";
import type { ConsolePayload } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  serviceId: string;
  className?: string;
}

export function Console({ serviceId, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const [ready, setReady] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
        cursorBlink: true,
        fontFamily: 'var(--font-mono), "JetBrains Mono", ui-monospace, monospace',
        fontSize: 13,
        lineHeight: 1.4,
        scrollback: 5000,
        allowProposedApi: true,
        theme: {
          background: "#00000000",
          foreground: "#d4d4d8",
          cursor: "#6366f1",
          cursorAccent: "#0a0a0c",
          selectionBackground: "#6366f159",
          black: "#18181b",
          red: "#ef4444",
          green: "#10b981",
          yellow: "#f59e0b",
          blue: "#6366f1",
          magenta: "#818cf8",
          cyan: "#38bdf8",
          white: "#f4f4f5",
          brightBlack: "#52525b",
          brightGreen: "#34d399",
          brightMagenta: "#a5b4fc",
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
      term.writeln(
        "\x1b[2m── Vivox console · streaming service \x1b[0m\x1b[34m" +
          serviceId +
          "\x1b[0m\x1b[2m ──\x1b[0m",
      );

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
    };
  }, [serviceId]);

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
    ready ? `service:${serviceId}:console` : null,
    (payload) => {
      const term = termRef.current;
      if (!term || !payload) return;
      const text = typeof payload === "string" ? payload : payload.text;
      if (typeof text !== "string") return;
      const colored =
        payload && payload.stream === "stderr" ? `\x1b[31m${text}\x1b[0m` : text;
      term.write(colored);
    },
  );

  const clearConsole = () => termRef.current?.clear();

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

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-[#0a0a0c]",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <TerminalIcon className="size-3.5 text-muted" />
        <span className="font-mono text-xs text-muted">console</span>
        <div className="ml-auto flex gap-1.5">
          <span className="size-2.5 rounded-full bg-red-500/70" />
          <span className="size-2.5 rounded-full bg-amber-500/70" />
          <span className="size-2.5 rounded-full bg-emerald-500/70" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="sm" onClick={clearConsole}>
          <Trash2 className="size-3.5" /> Clear
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void copyAll()}>
          <Copy className="size-3.5" /> Copy all
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSearchOpen((o) => !o)}
          className={searchOpen ? "text-vivox-400" : undefined}
        >
          <Search className="size-3.5" /> Search
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setWrap((w) => !w)}
          className={wrap ? "text-vivox-400" : undefined}
        >
          <WrapText className="size-3.5" /> Wrap
        </Button>
      </div>

      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") findNext();
            }}
            placeholder="Search console…"
            className="h-8 flex-1 rounded-lg border border-border bg-background/50 px-2 font-mono text-xs text-foreground outline-none focus:border-border-focus"
          />
          <Button variant="ghost" size="sm" onClick={findPrevious}>
            Prev
          </Button>
          <Button variant="ghost" size="sm" onClick={findNext}>
            Next
          </Button>
        </div>
      )}

      <div
        ref={containerRef}
        data-wrap={wrap}
        className={cn(
          "h-[420px] w-full px-3 py-2",
          wrap ? "overflow-x-hidden" : "overflow-x-auto",
        )}
        role="log"
        aria-label="Service console output"
      />
    </div>
  );
}
