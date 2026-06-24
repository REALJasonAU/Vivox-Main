"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CommandPalette } from "./command-palette";

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  contextServiceId: string | null;
  setContextServiceId: (id: string | null) => void;
}

const Ctx = createContext<CommandPaletteContextValue | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [contextServiceId, setContextServiceId] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo(
    () => ({
      open,
      setOpen,
      toggle: () => setOpen((o) => !o),
      contextServiceId,
      setContextServiceId,
    }),
    [open, contextServiceId],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </Ctx.Provider>
  );
}

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  return ctx;
}
