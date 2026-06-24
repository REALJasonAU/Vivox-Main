## Learned User Preferences

- Targets "Apple-level" polish for the Vivox hosting platform UI and architecture.
- Expects full implementation to a working state — no TODOs, placeholders, stubs, or deferred work when building features.
- Wants a root `PROGRESS.md` kept continuously updated with completed work, blockers, current task, failed attempts, and next actions.
- Do not edit Cursor plan files (e.g. `nexus_control_mvp_*.plan.md`).
- Prefer minimal, surgical diffs when fixing integration bugs or build issues.
- Dashboard UI should use **semantic Tailwind tokens** (`text-foreground`, `bg-surface`, `border-border`, …) per `design.md`; Vivox red accent (`vivox-400` / `#e5181b`).
- Work through multi-part sprint prompts in the order given.
- Sidebar footer holds user menu, notifications, and theme toggle — not the top bar; no deploy button in the sidebar (deploy CTAs live on pages).
- Settings removed from the sidebar — access via profile menu only.

## Learned Workspace Facts

- **Product:** Vivox — multi-tenant **hosting company panel**. Customers manage **My Servers**; staff (admins) use a **separate admin panel** for fleet ops. No self-serve ordering yet.
- **Repo:** Nexus Control monorepo at `https://github.com/REALJasonAU/Vivox-Main` — Go API (`apps/api`), Go edge agent (`apps/agent`), Next.js 15 frontend (`apps/web`), `packages/proto`, `packages/domain`. Module import path `github.com/nexus-control/...`; UI brand is Vivox.
- **Stack:** Next.js 15 + Go + PostgreSQL + Redis Streams; stateless Go edge agents over mTLS gRPC (agents dial **outbound** only; never access Redis/Postgres directly).
- **Auth:** Better Auth in `apps/web`; API verifies JWT (`BETTER_AUTH_SECRET` dev HMAC; production **EdDSA via `BETTER_AUTH_JWKS_URL`**). `user.role`: `user` (customer) or `admin`. `suspendCheck` middleware + Redis `suspended:<userId>`; admins exempt (`010_suspensions.sql`).
- **UI navigation:** `USER_NAV` — My Servers (`/dashboard`, `/services/*`). `ADMIN_NAV` — Dashboard, Servers (`/admin/servers`), Users (`/admin/users`), Nodes, Audit, Templates (`/deploy`). Panel switcher (shield icon / profile menu). Deploy wizard and admin routes are **admin-only**.
- **Deploy wizard:** target **node** dropdown (regions removed); per-port bind IP + optional alias; numeric memory / CPU threads / disk GB; owner user picker for admins. Ports validated against node conflicts.
- **Services & install:** Templates in `templates/*.yaml` with `install_script`; agent mounts `vivox-data-{serviceId}` → `/mnt/server`, runs install once (`.vivox-installed`), then `startup_cmd`. **Reinstall:** `POST /api/services/:id/reinstall` + UI in `service-controls.tsx`.
- **Nodes & agents:** Register with **`name` only** — capacity auto-detected on heartbeat. Edge scripts: `infra/scripts/install-node.sh`, `update-node.sh`, `node-agent-lib.sh` (update accepts `--token`, `--panel-url`, `--node-id`, `--control-addr`). Agent env: `/etc/vivox-agent/agent.env`. Co-located panel+node: `NEXUS_CONTROL_ADDR=127.0.0.1:9090` (Pangolin proxies HTTPS only, not gRPC **9090**).
- **Realtime:** WebSocket topics `service:{id}:status` and `node:{id}:status`; hooks in `apps/web/src/hooks/useLiveStatuses.ts`; publisher in `apps/api/internal/realtime/publisher.go`.
- **Production deploy:** `infra/prod/docker-compose.yml` + idempotent `infra/prod/setup.sh`. Pangolin on a **separate** host terminates SSL → port 3000; **9090** must reach the API for agents. Web Docker build: `ARG API_URL` before `npm run build`.
- **Migrations & DB:** API runs numbered `NNN_*.sql` via `migrate.Run` (`MIGRATIONS_DIR`); `schema.sql` is reference only. Better Auth `user` table uses camelCase `"createdAt"` (not `created_at`).
- **Dev environment:** Windows/PowerShell common; Docker often unavailable locally. `go.work` + `replace` for `packages/{proto,domain}`. Next.js: `API_BASE=/api/control`; `apiFetch` omits `/api/` prefix; `_tokenSyncPromise` waits for Bearer JWT. Dev auth: `AUTH_DEV_MODE=true` + `X-Dev-User` / `X-Dev-Role`. Agent dev: `GRPC_TLS_DISABLED` on API + `-insecure` on agent.
