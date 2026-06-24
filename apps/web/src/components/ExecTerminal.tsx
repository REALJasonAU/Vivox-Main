"use client";

import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { getWebSocketManager, useTopic } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";

interface TerminalPayload {
  data?: string;
  closed?: boolean;
}

export function ExecTerminal({ serviceId, className }: { serviceId: string; className?: string }) {
  const [sessionId] = useState(() => crypto.randomUUID());
  const topic = `service:${serviceId}:terminal:${sessionId}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useTopic<TerminalPayload>(topic, (payload) => {
      const term = termRef.current;
      if (!term) return;
      if (payload.data) {
        try {
          term.write(atob(payload.data));
        } catch {
          /* ignore bad frame */
        }
      }
      if (payload.closed) {
        term.writeln("\r\n[session closed]");
      }
    });

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    const ws = getWebSocketManager();

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
        theme: {
          background: "#00000000",
          foreground: "#d4d4d8",
          cursor: "#6366f1",
          cursorAccent: "#0a0a0c",
          selectionBackground: "#6366f159",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      termRef.current = term;
      fitRef.current = fit;

      try {
        fit.fit();
      } catch {
        /* not measured yet */
      }

      term.onData((input) => {
        ws.sendRaw({
          event: "terminal_input",
          session_id: sessionId,
          data: btoa(input),
        });
      });

      term.onResize(({ cols, rows }) => {
        ws.sendRaw({
          event: "terminal_resize",
          session_id: sessionId,
          cols,
          rows,
        });
      });

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
    };
  }, [serviceId, sessionId]);

  return (
    <div
      className={cn(
        "flex h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-background/80",
        className,
      )}
    >
      <div ref={containerRef} className="min-h-0 flex-1 p-2" />
    </div>
  );
}
