## Learned User Preferences

- Targets "Apple-level" polish for the Vivox hosting platform UI and architecture.
- Expects full implementation to a working state — no TODOs, placeholders, stubs, or deferred work when building features.
- Wants a root `PROGRESS.md` kept continuously updated with completed work, blockers, current task, failed attempts, and next actions.
- Do not edit Cursor plan files (e.g. `nexus_control_mvp_*.plan.md`).
- Prefer minimal, surgical diffs when fixing integration bugs or build issues.
- Dashboard UI should use **semantic Tailwind tokens** (`text-foreground`, `bg-surface`, `border-border`, …) per `design.md`; Vivox red accent (`vivox-400` / `#e5181b`).
- Work through multi-part sprint prompts in the order given.

## Learned Workspace Facts

- **Product:** Vivox — multi-tenant **hosting company panel**. Customers manage **My Servers**; staff (admins) use a **separate admin panel** for fleet ops. No self-serve ordering yet.
- **Repo:** Nexus Control monorepo — Go API (`apps/api`), Go edge agent (`apps/agent`), Next.js 15 frontend (`apps/web`), `packages/proto`, `packages/domain`. Module import path `github.com/nexus-control/...`; UI brand is Vivox.
- **Stack:** Next.js 15 + Go + PostgreSQL + Redis Streams; stateless Go edge agents over mTLS gRPC (agents dial **outbound** only; never access Redis/Postgres directly).

### Auth & roles

- Better Auth in `apps/web`; API verifies JWT (`BETTER_AUTH_SECRET` dev HMAC; production **EdDSA via `BETTER_AUTH_JWKS_URL`**).
- `user.role`: `user` (customer) or `admin`.
- Frontend: `useSession()` + `(session?.user as { role?: string })?.role === "admin"`.
- Go: `auth.OwnerID(c)`, `auth.IsAdmin(c)`.
- `suspendCheck` middleware + Redis `suspended:<userId>`; admins exempt. Table `user_suspensions` (`010_suspensions.sql`).

### UI navigation (Sprint 14+)

- **User panel:** `USER_NAV` — My Servers (`/dashboard`, `/services/*`). Settings via profile menu only (not sidebar).
- **Admin panel:** `ADMIN_NAV` — Dashboard, Servers (`/admin/servers`), Users, Nodes, Audit, Templates (`/deploy`). Detected when path starts with `/admin` or `/deploy`.
- **Panel switcher:** Shield icon in sidebar footer (user mode); `← User panel` text link at bottom (admin mode); profile dropdown also has Admin panel / User panel.
- `/` → landing when signed out; customers → `/dashboard`; admins may use `/admin/dashboard`.
- Deploy wizard and admin routes are **admin-only** (client redirect + API checks).

### Services & install flow (Pterodactyl-style)

- Templates in `templates/*.yaml`: `image`, `ports`, `env`, `configurable` (with `field_type`, `required`), `startup_cmd`, **`install_script`**.
- `service.BuildConfig` / deploy wizard persist `install_script` into `services.config` JSONB.
- Agent (`apps/agent/internal/docker`): mounts `vivox-data-{serviceId}` → `/mnt/server`; lifecycle wrapper runs install once (`.vivox-installed` marker), then `startup_cmd` or image entrypoint.
- Control env peeled by agent: `VIVOX_INSTALL_SCRIPT`, `VIVOX_STARTUP_CMD`, `VIVOX_FORCE_REINSTALL`, `VIVOX_CPU_SHARES`, `VIVOX_DISK_GB`.
- **Reinstall:** `POST /api/services/:id/reinstall` → asynq deploy with `force_reinstall` → wipes volume + re-runs install. UI: **Reinstall** in `service-controls.tsx`.
- Templates shipped: `minecraft`, `rust` (SturdyStubs AIO + SteamCMD egg install), `docker`, `static`.
- Default install script in `service.DefaultInstallScript` when template omits one.

### Nodes & agents

- Register node: `POST /api/admin/nodes` with **`name` only** (`region` defaults to `"default"`); capacity auto-detected on agent heartbeat.
- UI: `/admin/nodes/create` → `RegisterNodeForm` → `NodeSetupPanel` (one-time token).
- Edge install scripts: `infra/scripts/install-node.sh`, `update-node.sh`, `node-agent-lib.sh`. Support `curl | bash` via bootstrap download of lib from GitHub raw.
- Agent env: `/etc/vivox-agent/agent.env` — `NEXUS_CONTROL_ADDR`, `NEXUS_AGENT_ID`, `NEXUS_AGENT_TOKEN`, `VIVOX_PANEL_URL`.
- When panel and node are co-located, `NEXUS_CONTROL_ADDR=127.0.0.1:9090` (public URL is HTTPS web only; gRPC is not via reverse proxy unless explicitly routed).
- gRPC auth: metadata `x-agent-token` → SHA-256 hash lookup in `nodes.agent_token_hash`.

### Realtime

- `apps/api/internal/realtime/publisher.go` — `PublishNodeStatus`, service status on connect/disconnect/heartbeat.
- WebSocket topics: `node:{id}:status`, service status hooks in `apps/web/src/hooks/useLiveStatuses.ts`.

### Multi-tenancy

- `services.owner_id`; customers see owned services only.
- Admins may set `owner_id` on `POST /api/services` (`/deploy?for=<userId>`).

### Production deploy

- `infra/prod/docker-compose.yml` + `infra/prod/setup.sh`.
- Pangolin (or similar) on a **separate** host terminates SSL for the panel URL; port `9090` must reach the API for agents (often `127.0.0.1:9090` on same machine).
- Web Docker build: `ARG API_URL` before `npm run build` (Next.js bakes rewrite destinations).

### Migrations & DB

- API start runs numbered `NNN_*.sql` via `migrate.Run` (`MIGRATIONS_DIR`); `schema.sql` is reference only.
- sqlc + hand-written queries in `apps/api/internal/db/sprint*.go`.
- Service status enum: `PROVISIONING`, `STARTING`, `RUNNING`, `STOPPING`, `STOPPED`, `CRASHED`.

### Dev environment

- Windows/PowerShell common; Docker often unavailable locally — full E2E needs Docker on a node host.
- `go.work` + `replace` for `packages/{proto,domain}`.
- Next.js: `API_BASE=/api/control`; `apiFetch` omits `/api/` prefix; `_tokenSyncPromise` waits for Bearer JWT from `SessionSync`.
- Dev auth: `AUTH_DEV_MODE=true` + `X-Dev-User` / `X-Dev-Role` for curl; browsers need session cookies.
- Agent dev: `GRPC_TLS_DISABLED` on API + `-insecure` on agent.

### Docs map

| File | Purpose |
|------|---------|
| `README.md` | Stack, quick start, API routes, architecture |
| `design.md` | UI tokens, sidebar, components, motion |
| `QUICKSTART.md` | Step-by-step local dev |
| `AGENTS.md` | This file — assistant context |
