"use client";

import { Search, Menu } from "lucide-react";
import { motion } from "framer-motion";
import { useCommandPalette } from "./command-palette-provider";
import { WsStatusIndicator } from "./ws-status";

export function TopBar({ onOpenMobileNav }: { onOpenMobileNav?: () => void }) {
  const { setOpen } = useCommandPalette();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur-md md:px-6">
      {onOpenMobileNav && (
        <button
          type="button"
          className="mr-0.5 grid size-10 place-items-center rounded-xl text-muted hover:bg-surface-raised hover:text-foreground md:hidden"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </button>
      )}

      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="group relative flex h-10 flex-1 items-center gap-2.5 overflow-hidden rounded-xl border border-border bg-background px-3.5 text-sm text-muted shadow-sm transition-[border-color,box-shadow,background-color] duration-300 hover:border-border-focus hover:bg-surface hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vivox-500/30 md:max-w-lg"
      >
        <motion.span
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-vivox-500/0 via-vivox-500/[0.06] to-vivox-500/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          aria-hidden
        />
        <Search className="size-4 shrink-0 transition-transform duration-300 group-hover:scale-110 group-hover:text-foreground" />
        <span className="relative flex-1 truncate text-left transition-colors group-hover:text-foreground/80">
          Search servers or run a command…
        </span>
        <kbd className="relative hidden shrink-0 items-center rounded-md border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-subtle sm:inline-flex">
          ⌘K
        </kbd>
      </motion.button>

      <WsStatusIndicator className="hidden shrink-0 sm:inline-flex" />
    </header>
  );
}
