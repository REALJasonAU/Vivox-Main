"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { WebSocketProvider } from "@/hooks/useWebSocket";
import { CommandPaletteProvider } from "@/components/command-palette-provider";
import { SessionSync } from "@/components/session-sync";

export function Providers({
  children,
  initialTheme = "dark",
}: {
  children: ReactNode;
  initialTheme?: "dark" | "light";
}) {
  return (
    <ThemeProvider initialTheme={initialTheme}>
      <WebSocketProvider>
        <CommandPaletteProvider>
          <SessionSync />
          {children}
        </CommandPaletteProvider>
      </WebSocketProvider>
    </ThemeProvider>
  );
}
