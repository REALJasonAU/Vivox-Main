"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Users, Search, Play, Ban, CheckCircle2, Plus, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { adminApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Skeleton } from "@/components/ui/states";
import { cn, formatRelativeTime } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { useSession } from "@/lib/auth-client";
import type { Customer } from "@/lib/types";

function SummaryCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-surface p-4"
    >
      <p className={cn("text-3xl font-semibold tracking-tight", accent ?? "text-foreground")}>
        {value}
      </p>
      <p className="mt-1 text-xs uppercase tracking-wider text-muted">{label}</p>
    </motion.div>
  );
}

function Initials({ name, email }: { name?: string | null; email: string }) {
  const src = name || email;
  const letters = src
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-raised text-xs font-semibold text-foreground">
      {letters || "?"}
    </div>
  );
}

export default function UsersPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const { data, loading, error, refetch } = useApi<Customer[]>(() => adminApi.customers());
  const users = data ?? [];
  const [query, setQuery] = useState("");
  const [suspending, setSuspending] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return users;
    return users.filter(
      (c) =>
        c.email.toLowerCase().includes(q) ||
        (c.name ?? "").toLowerCase().includes(q),
    );
  }, [users, query]);

  const totals = useMemo(() => {
    const active = users.filter((c) => !c.is_suspended).length;
    const suspended = users.filter((c) => c.is_suspended).length;
    return { total: users.length, active, suspended };
  }, [users]);

  const handleSuspend = async (user: Customer) => {
    setSuspending(user.id);
    try {
      await adminApi.suspendCustomer(user.id);
      toast(`${user.email} suspended`, "warning");
      refetch();
    } catch {
      toast("Failed to suspend user", "error");
    } finally {
      setSuspending(null);
    }
  };

  const handleUnsuspend = async (user: Customer) => {
    setSuspending(user.id);
    try {
      await adminApi.unsuspendCustomer(user.id);
      toast(`${user.email} reactivated`, "success");
      refetch();
    } catch {
      toast("Failed to unsuspend user", "error");
    } finally {
      setSuspending(null);
    }
  };

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Users</h1>
        <p className="mt-1 text-sm text-muted">
          {users.length} registered · {totals.active} active
        </p>
      </div>

      {!loading && users.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <SummaryCard label="Total" value={totals.total} />
          <SummaryCard label="Active" value={totals.active} accent="text-emerald-500" />
          <SummaryCard label="Suspended" value={totals.suspended} accent={totals.suspended > 0 ? "text-red-500" : undefined} />
        </div>
      )}

      {users.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search by email or name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input-field h-10 w-full pl-9"
          />
        </div>
      )}

      {error && <ErrorBanner message={`Could not load users (${error})`} />}

      {loading ? (
        <Skeleton className="h-64" />
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border py-20 text-center">
          <div className="grid size-16 place-items-center rounded-2xl bg-surface-raised">
            <Users className="size-8 text-muted" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-foreground">No users yet</h2>
            <p className="mt-1 text-sm text-muted">Users will appear here once they register.</p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Role</th>
                <th className="px-4 py-3 font-medium">Servers</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Joined</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <AnimatePresence initial={false}>
                {filtered.map((user, i) => (
                  <motion.tr
                    key={user.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ delay: i * 0.03, duration: 0.2 }}
                    className="transition-colors hover:bg-surface-raised/50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Initials name={user.name} email={user.email} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {user.name || user.email}
                          </p>
                          {user.name && (
                            <p className="truncate text-xs text-muted">{user.email}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          user.role === "admin"
                            ? "bg-vivox-500/10 text-vivox-500"
                            : "bg-surface-raised text-muted",
                        )}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-foreground">{user.service_count}</span>
                        {user.running_count > 0 && (
                          <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-500">
                            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            {user.running_count}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 text-muted md:table-cell">
                      {formatRelativeTime(user.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {user.is_suspended ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-500">
                          <Ban className="size-3" /> Suspended
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-500">
                          <CheckCircle2 className="size-3" /> Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/deploy?for=${user.id}`}>
                          <Button size="sm" variant="ghost" className="gap-1.5 text-xs">
                            <Plus className="size-3" /> Server
                          </Button>
                        </Link>
                        {user.is_suspended ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={suspending === user.id}
                            onClick={() => void handleUnsuspend(user)}
                            className="gap-1.5 text-xs text-emerald-500"
                          >
                            <Play className="size-3" /> Unsuspend
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={suspending === user.id}
                            onClick={() => void handleSuspend(user)}
                            className="gap-1.5 text-xs text-red-500"
                          >
                            <Ban className="size-3" /> Suspend
                          </Button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
          {filtered.length === 0 && query && (
            <div className="py-10 text-center text-sm text-muted">
              No users match <span className="text-foreground">&quot;{query}&quot;</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
