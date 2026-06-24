## Learned User Preferences

- Targets "Apple-level" polish for the Vivox hosting platform UI and architecture.
- Expects full implementation to a working state — no TODOs, placeholders, stubs, or deferred work when building features.
- Wants a root `PROGRESS.md` kept continuously updated with completed work, blockers, current task, failed attempts, and next actions.
- Do not edit Cursor plan files (e.g. `nexus_control_mvp_*.plan.md`).
- Prefer minimal, surgical diffs when fixing integration bugs or build issues.
- Dashboard UI should use Tailwind zinc utility classes consistently; Vivox red accent (`vivox-400` / `#e5181b`) per `design.md`.
- Work through multi-part sprint prompts in the order given.

## Learned Workspace Facts

- **Product:** Vivox — multi-tenant **hosting company panel** (Sprint 14). Customers manage their services; staff (admins) manage customers, nodes, audit, and manual provisioning. No self-serve ordering yet.
- **Repo:** Nexus Control monorepo — Go API (`apps/api`), Go edge agent (`apps/agent`), Next.js 15 frontend (`apps/web`), `packages/proto`, `packages/domain`. Module import path `github.com/nexus-control/...`; UI brand is Vivox.
- **Stack:** Next.js 15 + Go + PostgreSQL + Redis Streams; stateless Go edge agents over mTLS gRPC only (agents never access Redis/Postgres directly).
- **Auth:** Better Auth in `apps/web`; API verifies JWT via `BETTER_AUTH_SECRET`. `user.role` is `user` (customer) or `admin`. Frontend: `useSession()` + `(session?.user as { role?: string })?.role === "admin"`. Go: `auth.OwnerID(c)`, `auth.IsAdmin(c)`.
- **Multi-tenancy & suspensions:** `services.owner_id`; customers see only owned services. Admins may set `owner_id` on `POST /api/services` (`/deploy?for=<userId>`). `user_suspensions` table (`010_suspensions.sql`); `suspendCheck` middleware; Redis key `suspended:<userId>`. Admins exempt.
- **Role-gated UI:** `USER_NAV` (Services, Settings) vs `ADMIN_NAV` (+ Customers, Nodes, Audit, Templates). Deploy button and `/deploy` page are admin-only. `/` renders `LandingPage` when unauthenticated; signed-in users redirect to `/dashboard`.
- **Admin API (Sprint 14):** `GET /api/admin/customers`, `PATCH .../suspend`, `PATCH .../unsuspend`. Frontend `adminApi` in `apps/web/src/lib/api.ts`.
- **Production deploy:** `infra/prod/docker-compose.yml` + idempotent `infra/prod/setup.sh` for first-run VPS setup. Pangolin on a **separate server** terminates SSL and proxies to VPS port 3000 (no local Traefik network). Web Docker build requires `ARG API_URL` before `npm run build` (Next.js bakes rewrite destinations).
- **Migrations:** API start runs only numbered `NNN_*.sql` files via `migrate.Run` (`MIGRATIONS_DIR`); `schema.sql` is a reference snapshot. `001_core.sql` creates core tables; `002_auth.sql` includes `jwks` for Better Auth JWT. Hand-written queries also live in `apps/api/internal/db/sprint*.go` alongside sqlc output.
- **Sprint 11–13 extras:** Metrics history, health checks, API keys, bulk actions; log history, alert rules, service tags, profile `PATCH /user/profile`; webhooks (`notify` pkg), volume backups, custom domains via optional `CADDY_ADMIN_URL` + `apps/api/internal/caddy`.
- **Windows/PowerShell dev environment;** Go at `C:\Program Files\Go\bin`, Node v24. Docker often unavailable locally — live stack smoke tests need Docker elsewhere.
- **Dev integration:** `go.work` ties four Go modules; `apps/api` and `apps/agent` `go.mod` need `replace` directives for local `packages/{proto,domain}`. Next.js dev proxy: `API_BASE=/api/control`; `apiFetch` paths omit `/api/` prefix. `api.ts` `_tokenSyncPromise` blocks until `SessionSync` sets Bearer JWT (prevents 401 loop). Dev auth: `AUTH_DEV_MODE=true` accepts `X-Dev-User` / `X-Dev-Role`; browser WebSocket needs Better Auth session cookie. Agent gRPC: metadata `x-agent-token`; dev TLS bypass via `GRPC_TLS_DISABLED` on API and `-insecure` on agent.
