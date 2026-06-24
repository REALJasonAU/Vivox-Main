"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Boxes, Search, ShieldAlert, ExternalLink } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { adminApi } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import type { Customer, Service } from "@/lib/types";
import { ErrorBanner, Skeleton } from "@/components/ui/states";
import { StatusBadge } from "@/components/status-badge";
import { cn, formatRelativeTime } from "@/lib/utils";

export default function AdminServicesPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const { data: services, loading, error } = useApi<Service[]>(() => adminApi.services(), []);
  const { data: users } = useApi<Customer[]>(() => adminApi.customers(), []);
  const [query, setQuery] = useState("");

  const userMap = useMemo(() => {
    const m = new Map<string, Customer>();
    for (const u of users ?? []) m.set(u.id, u);
    return m;
  }, [users]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const list = services ?? [];
    if (!q) return list;
    return list.filter((s) => {
      const owner = userMap.get(s.owner_id);
      return (
        s.name.toLowerCase().includes(q) ||
        s.type.toLowerCase().includes(q) ||
        s.status.toLowerCase().includes(q) ||
        s.owner_id.toLowerCase().includes(q) ||
        (owner?.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [services, query, userMap]);

  const counts = useMemo(() => {
    const list = services ?? [];
    return {
      total: list.length,
      running: list.filter((s) => s.status === "RUNNING").length,
      stopped: list.filter((s) => s.status === "STOPPED").length,
    };
  }, [services]);

  if (role !== undefined && role !== "admin") {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <ShieldAlert className="size-8 text-muted" />
        <p className="text-sm text-muted">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Services</h1>
          <p className="mt-1 text-sm text-muted">
            {counts.total} platform-wide · {counts.running} running · {counts.stopped} stopped
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-vivox-500 transition-colors hover:text-vivox-400"
        >
          View my servers →
        </Link>
      </div>

      {(services?.length ?? 0) > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search by name, owner, type, status…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input-field h-10 w-full pl-9"
          />
        </div>
      )}

      {error && <ErrorBanner message={`Could not load services (${error})`} />}

      {loading ? (
        <Skeleton className="h-64" />
      ) : (services?.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border py-20 text-center">
          <div className="grid size-16 place-items-center rounded-2xl bg-surface-raised">
            <Boxes className="size-8 text-muted" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-foreground">No services yet</h2>
            <p className="mt-1 text-sm text-muted">Deploy a server from Templates or a user profile.</p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Server</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Owner</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Created</th>
                <th className="px-4 py-3 font-medium text-right">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <AnimatePresence initial={false}>
                {filtered.map((svc, i) => {
                  const owner = userMap.get(svc.owner_id);
                  return (
                    <motion.tr
                      key={svc.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.02, duration: 0.2 }}
                      className="transition-colors hover:bg-surface-raised/50"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{svc.name}</p>
                        <p className="font-mono text-xs text-muted">{svc.id.slice(0, 8)}…</p>
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <p className="truncate text-foreground">{owner?.email ?? svc.owner_id.slice(0, 12)}</p>
                      </td>
                      <td className="px-4 py-3 capitalize text-muted">{svc.type}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={svc.status} />
                      </td>
                      <td className="hidden px-4 py-3 text-muted md:table-cell">
                        {formatRelativeTime(svc.created_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/services/${svc.id}`}
                          className="inline-flex items-center gap-1 text-xs text-vivox-500 hover:text-vivox-400"
                        >
                          Manage <ExternalLink className="size-3" />
                        </Link>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
          {filtered.length === 0 && query && (
            <div className="py-10 text-center text-sm text-muted">
              No services match <span className="text-foreground">&quot;{query}&quot;</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
