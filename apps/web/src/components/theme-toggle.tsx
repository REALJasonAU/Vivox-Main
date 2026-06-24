"use client";

import { motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "./theme-provider";

interface ThemeToggleProps {
  className?: string;
  /** Icon-only square button for sidebar footer */
  compact?: boolean;
}

export function ThemeToggle({ className, compact = false }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-xl transition-colors",
        compact
          ? "size-10 text-muted hover:bg-surface-raised hover:text-foreground"
          : "size-9 text-muted hover:bg-surface-raised hover:text-foreground",
        className,
      )}
    >
      <motion.span
        className="absolute inset-0 grid place-items-center"
        initial={false}
        animate={{
          rotate: isDark ? 0 : 180,
          scale: isDark ? 1 : 0.85,
          opacity: isDark ? 1 : 0,
        }}
        transition={{ type: "spring", stiffness: 420, damping: 28 }}
      >
        <Moon className="size-4" />
      </motion.span>
      <motion.span
        className="absolute inset-0 grid place-items-center"
        initial={false}
        animate={{
          rotate: isDark ? -180 : 0,
          scale: isDark ? 0.85 : 1,
          opacity: isDark ? 0 : 1,
        }}
        transition={{ type: "spring", stiffness: 420, damping: 28 }}
      >
        <Sun className="size-4 text-amber-500" />
      </motion.span>
    </button>
  );
}
