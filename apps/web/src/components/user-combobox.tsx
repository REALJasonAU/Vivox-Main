"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { Customer } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  users: Customer[];
  value: string;
  onChange: (userId: string) => void;
  placeholder?: string;
}

export function UserCombobox({ users, value, onChange, placeholder = "Search by name or email…" }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const selected = users.find((u) => u.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users.slice(0, 12);
    return users
      .filter(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          (u.name ?? "").toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [users, query]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between rounded-lg border border-border bg-background/50 px-3 text-left text-sm text-foreground outline-none focus:border-border-focus"
      >
        <span className={cn("truncate", !selected && "text-muted")}>
          {selected ? `${selected.name ?? selected.email} · ${selected.email}` : placeholder}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-surface shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full border-b border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none"
          />
          <ul className="max-h-48 overflow-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted">No users match</li>
            ) : (
              filtered.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-raised"
                    onClick={() => {
                      onChange(u.id);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <Check className={cn("size-3.5", value === u.id ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-foreground">{u.name ?? u.email}</span>
                      <span className="ml-1 text-muted">{u.email}</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
