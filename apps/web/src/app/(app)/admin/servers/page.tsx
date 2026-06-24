"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Boxes, Rocket, Search, ShieldAlert, ExternalLink } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { adminApi } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import type { Customer, Service } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Skeleton } from "@/components/ui/states";
import { StatusBadge } from "@/components/status-badge";
import { cn, formatRelativeTime } from "@/lib/utils";

export default function AdminServersPage() {
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

  if (role !== undefined && role !== "admin") {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <ShieldAlert className="size-8 text-muted" />
        <p className="text-sm text-muted">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Servers</h1>
        <div className="flex items-center gap-3">
          <Link href="/deploy">
            <Button actionType="deploy" size="sm">
              <Rocket className="size-4" />
              Deploy server
            </Button>
          </Link>
        </div>
      </div>

      {(services?.length ?? 0) > 0 && (
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search servers, owners, status…"
            className="h-9 w-full rounded-lg border border-border bg-surface-raised pl-9 pr-3 text-sm text-foreground outline-none focus:border-border-focus"
          />
        </div>
      )}

      {error && <ErrorBanner message={`Could not load servers (${error})`} />}

      {loading ? (
        <Skeleton className="h-64" />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
          <Boxes className="size-8 text-muted" />
          <p className="text-sm text-muted">
            {services?.length ? "No servers match your search." : "No servers deployed yet."}
          </p>
          <Link href="/deploy">
            <Button size="sm" actionType="deploy">
              <Rocket className="size-4" /> Deploy server
            </Button>
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Server</th>
                <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Owner</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Created</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <AnimatePresence initial={false}>
                {filtered.map((svc) => (
                  <motion.tr
                    key={svc.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="transition-colors hover:bg-surface-raised/60"
                  >
                    <td className="px-3 py-2.5 font-medium text-foreground">{svc.name}</td>
                    <td className="hidden px-3 py-2.5 text-muted sm:table-cell">
                      {userMap.get(svc.owner_id)?.email ?? svc.owner_id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2.5 capitalize text-muted">{svc.type}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={svc.status} />
                    </td>
                    <td className="hidden px-3 py-2.5 text-muted lg:table-cell">
                      {formatRelativeTime(svc.created_at)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        href={`/services/${svc.id}`}
                        className={cn(
                          "inline-flex items-center gap-1 text-xs text-vivox-500 hover:text-vivox-400",
                        )}
                      >
                        Open <ExternalLink className="size-3" />
                      </Link>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
