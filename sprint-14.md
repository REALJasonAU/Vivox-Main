# Sprint 14 — Vivox Hosting Company Panel

## Context

Vivox is now a **hosting company panel**, not a personal tool. Customers log in to manage their own services. Staff use the admin dashboard to manage customers and provision services on their behalf. No self-serve ordering yet — staff create services manually.

What already exists: multi-tenant services scoped by `owner_id`, role-based auth (JWT, `role` field on Better Auth `user` table), admin routes for nodes/audit, `listAllServices` handler, all Sprint 13 features (webhooks, backups, domains). The sidebar currently shows Nodes and Audit to ALL users — those must be hidden from customers.

---

## Section 1 — Role-gated navigation + customer UX

### 1a. `apps/web/src/components/sidebar.tsx`

The `NAV` array currently shows everything to everyone. Split it into a user nav and an admin nav, rendered based on role from `useSession()`.

Replace the existing `NAV` array and sidebar nav rendering with:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Boxes,
  Server,
  ScrollText,
  LayoutTemplate,
  Settings,
  Rocket,
  ChevronLeft,
  X,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { VivoxLogo } from "./vivox-logo";
import { useSession } from "@/lib/auth-client";

const USER_NAV = [
  { href: "/dashboard", label: "Services", icon: Boxes, match: ["/dashboard", "/services"] },
  { href: "/settings", label: "Settings", icon: Settings, match: ["/settings"] },
];

const ADMIN_NAV = [
  { href: "/dashboard", label: "Services", icon: Boxes, match: ["/dashboard", "/services"] },
  { href: "/admin/customers", label: "Customers", icon: Users, match: ["/admin/customers"] },
  { href: "/admin/nodes", label: "Nodes", icon: Server, match: ["/admin/nodes"] },
  { href: "/admin/audit", label: "Audit", icon: ScrollText, match: ["/admin/audit"] },
  { href: "/deploy", label: "Templates", icon: LayoutTemplate, match: ["/deploy"] },
  { href: "/settings", label: "Settings", icon: Settings, match: ["/settings"] },
];
```

In the sidebar body, get the role and pick the nav:

```tsx
const { data: session } = useSession();
const role = (session?.user as { role?: string } | undefined)?.role;
const isAdmin = role === "admin";
const NAV = isAdmin ? ADMIN_NAV : USER_NAV;
```

Keep all existing motion/animation/collapse logic — just swap the NAV source.

### 1b. `apps/web/src/app/(app)/dashboard/page.tsx`

Get session in the component:

```tsx
import { useSession } from "@/lib/auth-client";
// inside DashboardPage:
const { data: session } = useSession();
const role = (session?.user as { role?: string } | undefined)?.role;
const isAdmin = role === "admin";
```

1. **Header row**: Wrap the "Deploy service" `<Link>` + `<Button>` in `{isAdmin && (...)}`.

2. **Empty state** (when `services.length === 0`): Replace the single empty state with two variants:

```tsx
services.length === 0 ? (
  <div className="flex flex-col items-center gap-5 rounded-2xl border border-dashed border-zinc-800 py-20 text-center">
    <div className="grid size-16 place-items-center rounded-2xl bg-zinc-900">
      <Server className="size-8 text-zinc-600" />
    </div>
    <div>
      <h2 className="text-lg font-medium text-zinc-100">No active services</h2>
      <p className="mt-1 text-sm text-zinc-500">
        {isAdmin
          ? "Deploy your first service to get started."
          : "Your services will appear here once they've been set up. Contact support to get started."}
      </p>
    </div>
    {isAdmin && (
      <Link href="/deploy">
        <Button size="lg" actionType="deploy">
          <Rocket className="size-4" /> Deploy a service
        </Button>
      </Link>
    )}
  </div>
) : ...
```

### 1c. `apps/web/src/app/(app)/deploy/page.tsx`

Add a role guard at the top of the page component. Also read an optional `?for=userId` query param so admins can create a service on behalf of a customer.

At the top of the file:

```tsx
import { useSession } from "@/lib/auth-client";
import { useRouter, useSearchParams } from "next/navigation";
```

Inside `DeployPage`:

```tsx
const { data: session } = useSession();
const router = useRouter();
const searchParams = useSearchParams();
const forUserId = searchParams.get("for") ?? undefined;
const role = (session?.user as { role?: string } | undefined)?.role;
const isAdmin = role === "admin";

// Redirect non-admins away
useEffect(() => {
  if (session && !isAdmin) {
    router.replace("/dashboard");
  }
}, [session, isAdmin, router]);
```

When `forUserId` is set, show a banner below the page title:

```tsx
{forUserId && (
  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-sm text-amber-400">
    Creating service on behalf of a customer
  </div>
)}
```

In the deploy submit handler, wherever `servicesApi.create(input)` is called, pass the override:

```tsx
await servicesApi.create({
  ...input,
  ...(forUserId ? { owner_id: forUserId } : {}),
});
```

After a successful deploy, redirect to `/admin/customers` if `forUserId` was set, otherwise `/dashboard`.

---

## Section 2 — Go API: customer management

### 2a. `infra/migrations/010_suspensions.sql`

```sql
CREATE TABLE user_suspensions (
  user_id      VARCHAR(255) PRIMARY KEY,
  reason       TEXT,
  suspended_by VARCHAR(255) NOT NULL,
  suspended_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### 2b. `apps/api/internal/db/sprint14.go`

```go
package db

import (
	"context"
	"time"
)

// Customer is a joined view of the Better Auth user table + service counts + suspension status.
// Better Auth (Postgres adapter) stores users in the lowercase-quoted "user" table.
type Customer struct {
	ID           string
	Email        string
	Name         *string
	Role         string
	CreatedAt    time.Time
	IsSuspended  bool
	ServiceCount int64
	RunningCount int64
}

const listCustomers = `
SELECT
  u.id,
  u.email,
  u.name,
  COALESCE(u.role, 'user') AS role,
  u.created_at,
  CASE WHEN us.user_id IS NOT NULL THEN true ELSE false END AS is_suspended,
  COUNT(s.id)                                                AS service_count,
  COUNT(CASE WHEN s.status = 'RUNNING' THEN 1 END)          AS running_count
FROM "user" u
LEFT JOIN services       s  ON s.owner_id  = u.id
LEFT JOIN user_suspensions us ON us.user_id = u.id
GROUP BY u.id, u.email, u.name, u.role, u.created_at, us.user_id
ORDER BY u.created_at DESC
`

func (q *Queries) ListCustomers(ctx context.Context) ([]Customer, error) {
	rows, err := q.db.Query(ctx, listCustomers)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Customer
	for rows.Next() {
		var c Customer
		if err := rows.Scan(
			&c.ID, &c.Email, &c.Name, &c.Role, &c.CreatedAt,
			&c.IsSuspended, &c.ServiceCount, &c.RunningCount,
		); err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

const suspendCustomer = `
INSERT INTO user_suspensions (user_id, reason, suspended_by)
VALUES ($1, $2, $3)
ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, suspended_by = EXCLUDED.suspended_by, suspended_at = NOW()
`

func (q *Queries) SuspendCustomer(ctx context.Context, userID, reason, suspendedBy string) error {
	_, err := q.db.Exec(ctx, suspendCustomer, userID, reason, suspendedBy)
	return err
}

const unsuspendCustomer = `DELETE FROM user_suspensions WHERE user_id = $1`

func (q *Queries) UnsuspendCustomer(ctx context.Context, userID string) error {
	_, err := q.db.Exec(ctx, unsuspendCustomer, userID)
	return err
}
```

### 2c. `apps/api/cmd/api/handlers.go` — owner override in `createService`

Add `OwnerID string` to `createServiceReq`:

```go
type createServiceReq struct {
	Name       string            `json:"name"`
	TemplateID string            `json:"template_id"`
	NodeID     string            `json:"node_id"`
	Region     string            `json:"region"`
	Params     map[string]string `json:"params"`
	Type       string            `json:"type"`
	Config     *domain.ServiceConfig  `json:"config"`
	Limits     *domain.ResourceLimits `json:"resource_limits"`
	// OwnerID may be set by an admin to create a service on behalf of a customer.
	OwnerID string `json:"owner_id"`
}
```

In `createService`, right after `owner := auth.OwnerID(c)`, add:

```go
// Admins may create services on behalf of any customer.
if auth.IsAdmin(c) {
    if override := strings.TrimSpace(req.OwnerID); override != "" {
        owner = override
    }
}
```

Also add `caddy *caddyclient.Client` to the `api` struct (it was added in Sprint 13's handlers but the struct definition is in handlers.go — check if already present; add if missing):

```go
type api struct {
	cfg         config.Config
	q           *db.Queries
	pool        *pgxpool.Pool
	rdb         *redis.Client
	mgr         *service.Manager
	sched       *scheduler.Scheduler
	enq         *worker.Enqueuer
	reg         *grpcsrv.Registry
	fileTracker *filestrack.Tracker
	caddy       *caddyclient.Client  // nil when CADDY_ADMIN_URL not set
	log         *slog.Logger
}
```

(Sprint 13 added the caddy client — confirm it's in the struct, add if absent.)

### 2d. `apps/api/cmd/api/handlers_sprint14.go`

```go
package main

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"

	"github.com/nexus-control/apps/api/internal/auth"
)

// GET /api/admin/customers
func (a *api) listCustomers(c *fiber.Ctx) error {
	rows, err := a.q.ListCustomers(c.UserContext())
	if err != nil {
		return err
	}
	out := make([]fiber.Map, 0, len(rows))
	for _, cust := range rows {
		out = append(out, fiber.Map{
			"id":            cust.ID,
			"email":         cust.Email,
			"name":          cust.Name,
			"role":          cust.Role,
			"created_at":    cust.CreatedAt,
			"is_suspended":  cust.IsSuspended,
			"service_count": cust.ServiceCount,
			"running_count": cust.RunningCount,
		})
	}
	return c.JSON(out)
}

type suspendReq struct {
	Reason string `json:"reason"`
}

// PATCH /api/admin/customers/:userId/suspend
func (a *api) suspendCustomer(c *fiber.Ctx) error {
	userID := strings.TrimSpace(c.Params("userId"))
	if userID == "" {
		return fiber.ErrBadRequest
	}
	var req suspendReq
	_ = c.BodyParser(&req)

	if err := a.q.SuspendCustomer(c.UserContext(), userID, req.Reason, auth.OwnerID(c)); err != nil {
		return err
	}
	// Cache suspension in Redis so the middleware can check it without a DB hit.
	a.rdb.Set(c.UserContext(), "suspended:"+userID, "1", 0)
	return c.SendStatus(204)
}

// PATCH /api/admin/customers/:userId/unsuspend
func (a *api) unsuspendCustomer(c *fiber.Ctx) error {
	userID := strings.TrimSpace(c.Params("userId"))
	if userID == "" {
		return fiber.ErrBadRequest
	}
	if err := a.q.UnsuspendCustomer(c.UserContext(), userID); err != nil {
		return err
	}
	a.rdb.Del(c.UserContext(), "suspended:"+userID)
	return c.SendStatus(204)
}

// suspendCheck is a Fiber middleware that rejects API calls from suspended users.
// It runs after the auth middleware and skips admins (to prevent lockout).
func suspendCheck(rdb *redis.Client) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// Never block admins — they manage suspensions.
		if auth.IsAdmin(c) {
			return c.Next()
		}
		uid := auth.OwnerID(c)
		if uid == "" {
			return c.Next()
		}
		val, _ := rdb.Get(c.Context(), "suspended:"+uid).Result()
		if val == "1" {
			return fiber.NewError(fiber.StatusForbidden, "account suspended — contact support")
		}
		return c.Next()
	}
}
```

### 2e. `apps/api/cmd/api/main.go` — wire new routes + middleware

In `buildHTTP`, update the `apiGroup` line and admin routes:

```go
// Add suspendCheck as second middleware on the API group
apiGroup := app.Group("/api", authmw, suspendCheck(a.rdb))
```

In the admin group, add:

```go
admin.Get("/customers", a.listCustomers)
admin.Patch("/customers/:userId/suspend", a.suspendCustomer)
admin.Patch("/customers/:userId/unsuspend", a.unsuspendCustomer)
```

Also wire the caddy client onto `a` in `buildHTTP`. In `run()`, after loading config, add:

```go
var caddyClient *caddyclient.Client
if cfg.CaddyAdminURL != "" {
    caddyClient = caddyclient.New(cfg.CaddyAdminURL)
}
```

And pass it in `a`:

```go
a := &api{..., caddy: caddyClient, ...}
```

(Check if Sprint 13 already did this — if the `caddy` field already exists in the struct and is already wired, skip. Only add what is missing.)

---

## Section 3 — Frontend: types + API client

### 3a. `apps/web/src/lib/types.ts`

Add at the bottom:

```typescript
export interface Customer {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  created_at: string;
  is_suspended: boolean;
  service_count: number;
  running_count: number;
}
```

### 3b. `apps/web/src/lib/api.ts`

Add the import for `Customer` to the import block at the top:

```typescript
import type {
  // ...existing...
  Customer,
} from "./types";
```

Add to `CreateServiceInput` an optional owner_id field — update the type in `types.ts`:

```typescript
export interface CreateServiceInput {
  name: string;
  type: ServiceType;
  region: string;
  config: ServiceConfig;
  resource_limits: ResourceLimits;
  owner_id?: string; // admin-only: create on behalf of a customer
}
```

Add the admin API namespace to `api.ts`:

```typescript
export const adminApi = {
  customers: () => apiFetch<Customer[]>("/admin/customers"),
  suspendCustomer: (userId: string, reason?: string) =>
    apiFetch<void>(`/admin/customers/${userId}/suspend`, {
      method: "PATCH",
      body: { reason: reason ?? "" },
      raw: true,
    }),
  unsuspendCustomer: (userId: string) =>
    apiFetch<void>(`/admin/customers/${userId}/unsuspend`, {
      method: "PATCH",
      raw: true,
    }),
};
```

---

## Section 4 — Admin customers page

### `apps/web/src/app/(app)/admin/customers/page.tsx`

Full file:

```tsx
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

function AnimatedCount({ value }: { value: number }) {
  return <span>{value}</span>;
}

function SummaryCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
    >
      <p className={cn("text-3xl font-semibold tracking-tight", accent ?? "text-zinc-100")}>
        <AnimatedCount value={value} />
      </p>
      <p className="mt-1 text-xs uppercase tracking-wider text-zinc-500">{label}</p>
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
    <div className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">
      {letters || "?"}
    </div>
  );
}

export default function CustomersPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const { data, loading, error, refetch } = useApi<Customer[]>(() => adminApi.customers());
  const customers = data ?? [];
  const [query, setQuery] = useState("");
  const [suspending, setSuspending] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.email.toLowerCase().includes(q) ||
        (c.name ?? "").toLowerCase().includes(q),
    );
  }, [customers, query]);

  const totals = useMemo(() => {
    const active = customers.filter((c) => !c.is_suspended).length;
    const suspended = customers.filter((c) => c.is_suspended).length;
    return { total: customers.length, active, suspended };
  }, [customers]);

  const handleSuspend = async (customer: Customer) => {
    setSuspending(customer.id);
    try {
      await adminApi.suspendCustomer(customer.id);
      toast(`${customer.email} suspended`, "warning");
      refetch();
    } catch {
      toast("Failed to suspend customer", "error");
    } finally {
      setSuspending(null);
    }
  };

  const handleUnsuspend = async (customer: Customer) => {
    setSuspending(customer.id);
    try {
      await adminApi.unsuspendCustomer(customer.id);
      toast(`${customer.email} reactivated`, "success");
      refetch();
    } catch {
      toast("Failed to unsuspend customer", "error");
    } finally {
      setSuspending(null);
    }
  };

  if (role !== undefined && role !== "admin") {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <ShieldAlert className="size-8 text-zinc-600" />
        <p className="text-sm text-zinc-400">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Customers</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {customers.length} registered · {totals.active} active
          </p>
        </div>
      </div>

      {/* Summary strip */}
      {!loading && customers.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <SummaryCard label="Total" value={totals.total} />
          <SummaryCard label="Active" value={totals.active} accent="text-emerald-400" />
          <SummaryCard label="Suspended" value={totals.suspended} accent={totals.suspended > 0 ? "text-red-400" : undefined} />
        </div>
      )}

      {/* Search */}
      {customers.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by email or name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900 pl-9 pr-4 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-zinc-600"
          />
        </div>
      )}

      {error && <ErrorBanner message={`Could not load customers (${error})`} />}

      {loading ? (
        <Skeleton className="h-64" />
      ) : customers.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-zinc-800 py-20 text-center">
          <div className="grid size-16 place-items-center rounded-2xl bg-zinc-900">
            <Users className="size-8 text-zinc-600" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-zinc-100">No customers yet</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Customers will appear here once they register.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="bg-[#1f1f23] text-left text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Role</th>
                <th className="px-4 py-3 font-medium">Services</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Joined</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              <AnimatePresence initial={false}>
                {filtered.map((customer, i) => (
                  <motion.tr
                    key={customer.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ delay: i * 0.03, duration: 0.2 }}
                    className="transition-colors hover:bg-[#1c1c20]"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Initials name={customer.name} email={customer.email} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-zinc-100">
                            {customer.name || customer.email}
                          </p>
                          {customer.name && (
                            <p className="truncate text-xs text-zinc-500">{customer.email}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          customer.role === "admin"
                            ? "bg-vivox-500/10 text-vivox-400"
                            : "bg-zinc-800 text-zinc-400",
                        )}
                      >
                        {customer.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-zinc-300">{customer.service_count}</span>
                        {customer.running_count > 0 && (
                          <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-400">
                            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            {customer.running_count}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 text-zinc-500 md:table-cell">
                      {formatRelativeTime(customer.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {customer.is_suspended ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
                          <Ban className="size-3" /> Suspended
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                          <CheckCircle2 className="size-3" /> Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/deploy?for=${customer.id}`}>
                          <Button size="sm" variant="ghost" className="gap-1.5 text-xs">
                            <Plus className="size-3" /> Service
                          </Button>
                        </Link>
                        {customer.is_suspended ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={suspending === customer.id}
                            onClick={() => void handleUnsuspend(customer)}
                            className="gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
                          >
                            <Play className="size-3" /> Unsuspend
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={suspending === customer.id}
                            onClick={() => void handleSuspend(customer)}
                            className="gap-1.5 text-xs text-red-400 hover:text-red-300"
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
            <div className="py-10 text-center text-sm text-zinc-500">
              No customers match <span className="text-zinc-300">"{query}"</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## Section 5 — Landing page

### 5a. `apps/web/src/app/page.tsx`

Replace the current `redirect("/dashboard")` with a server component that checks auth and renders the landing:

```tsx
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { LandingPage } from "@/components/landing-page";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/dashboard");
  return <LandingPage />;
}
```

### 5b. `apps/web/src/components/landing-page.tsx`

```tsx
"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Gamepad2, Globe, Database, ArrowRight, Zap, Shield, Activity } from "lucide-react";
import { VivoxLogo } from "@/components/vivox-logo";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: Gamepad2,
    title: "Game Servers",
    description:
      "Deploy Minecraft, Rust, CS2, and more in seconds. Full console access, live metrics, and automated restarts.",
  },
  {
    icon: Globe,
    title: "Web & App Hosting",
    description:
      "Run Node.js, Python, Docker containers — anything with a port. Custom domains included.",
  },
  {
    icon: Database,
    title: "Managed Databases",
    description:
      "Postgres, MySQL, Redis and more. Automated backups, connection management, zero config.",
  },
];

const PERKS = [
  { icon: Zap, label: "Instant deployment" },
  { icon: Shield, label: "Isolated containers" },
  { icon: Activity, label: "Live monitoring" },
];

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1 + 0.4, duration: 0.4, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Nav */}
      <header className="flex items-center justify-between border-b border-zinc-900 px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <VivoxLogo size={32} />
          <span className="text-sm font-semibold tracking-tight">Vivox</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link href="/register">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center">
        {/* Hero */}
        <section className="flex w-full max-w-5xl flex-col items-center gap-8 px-6 py-24 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <VivoxLogo size={64} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-4"
          >
            <h1 className="text-5xl font-bold tracking-tight text-zinc-50 sm:text-6xl">
              Hosting that{" "}
              <span className="text-vivox-400">just works</span>
            </h1>
            <p className="mx-auto max-w-xl text-lg text-zinc-400">
              Game servers, web apps, and databases — deployed in seconds on edge infrastructure
              built for reliability.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="flex flex-wrap items-center justify-center gap-3"
          >
            <Link href="/register">
              <Button size="lg" actionType="deploy">
                Get started <ArrowRight className="size-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="secondary">
                Sign in
              </Button>
            </Link>
          </motion.div>

          {/* Perks strip */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45, duration: 0.4 }}
            className="flex flex-wrap items-center justify-center gap-6 text-sm text-zinc-500"
          >
            {PERKS.map(({ icon: Icon, label }) => (
              <span key={label} className="flex items-center gap-1.5">
                <Icon className="size-4 text-vivox-500" />
                {label}
              </span>
            ))}
          </motion.div>
        </section>

        {/* Features */}
        <section className="w-full max-w-5xl px-6 pb-24">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
              >
                <div className="grid size-10 place-items-center rounded-xl bg-vivox-500/10">
                  <f.icon className="size-5 text-vivox-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-zinc-100">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{f.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-900 px-6 py-5 text-center text-xs text-zinc-600">
        © {new Date().getFullYear()} Vivox. All rights reserved.
      </footer>
    </div>
  );
}
```

---

## Build targets

```bash
# Apply the new migration
# (will run automatically on next API start via migrate.Run)

# Go — verify all packages compile
go build ./apps/api/...

# Frontend — full production build (catches type errors)
cd apps/web && npm run build
```

## Checklist

- [ ] `infra/migrations/010_suspensions.sql` created
- [ ] `apps/api/internal/db/sprint14.go` — `ListCustomers`, `SuspendCustomer`, `UnsuspendCustomer`
- [ ] `handlers.go` — `OwnerID` added to `createServiceReq`, admin override in `createService`, `caddy` field on `api` struct
- [ ] `handlers_sprint14.go` — `listCustomers`, `suspendCustomer`, `unsuspendCustomer`, `suspendCheck`
- [ ] `main.go` — `suspendCheck(a.rdb)` on `apiGroup`, new admin routes, caddy client wired
- [ ] `types.ts` — `Customer` type + `owner_id` on `CreateServiceInput`
- [ ] `api.ts` — `adminApi` namespace + `Customer` import
- [ ] `sidebar.tsx` — role-aware nav split
- [ ] `dashboard/page.tsx` — role-aware empty state + hide Deploy button for non-admins
- [ ] `deploy/page.tsx` — admin role guard + `?for=userId` banner + pass `owner_id` to create
- [ ] `admin/customers/page.tsx` — full customer table
- [ ] `page.tsx` — server component with auth check
- [ ] `landing-page.tsx` — new component
- [ ] `go build ./apps/api/...` passes
- [ ] `npm run build` passes
