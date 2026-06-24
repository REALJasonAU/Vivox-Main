# Vivox

**Vivox** is a multi-tenant hosting control plane: customers log in to manage their
servers; staff use an admin panel to manage customers, nodes, and provisioning.
The product UI and branding are Vivox; the monorepo module paths use
`nexus-control` internally.

Stack: Next.js 15 premium UI, Go control plane (HTTP/REST + gRPC), stateless Go
edge agents, Better Auth (JWT + `role` on the `user` table), PostgreSQL, and
Redis Streams.

> **Status:** Phase 1 control plane, edge agent, and web app are implemented
> through **Sprint 14+** (hosting company panel, Pterodactyl-style installs,
> live node status). See **Verified build status** below.

## Product model

| Role | Who | What they see |
| ---- | --- | ------------- |
| **Customer** (`role: user`) | Registered account | **My Servers** dashboard, service detail, settings. No deploy, nodes, or admin areas. |
| **Admin** (`role: admin`) | Hosting staff | Separate **admin panel**: Dashboard, Servers, Users, Nodes, Audit, Templates (deploy). Toggle via sidebar footer or profile menu. |

- Services are scoped by `owner_id`. Customers only see their own services.
- **No self-serve ordering yet** — admins deploy services manually (including on
  behalf of a customer via **Users → Service** or `/deploy?for=<userId>`).
- Admins can **suspend** customers; suspended users get `403` on API calls
  (`suspendCheck` middleware + Redis cache).
- Unauthenticated visitors see a **landing page** at `/`; signed-in users go to
  `/dashboard` (customers) or `/admin/dashboard` (admins in admin mode).

## Monorepo layout

```
nexus-control/
├── apps/
│   ├── web/                  # Next.js 15 frontend (Vivox UI)
│   │   └── src/{app,components,hooks,lib}/
│   ├── api/                  # Go control plane (HTTP/REST + gRPC + asynq worker)
│   │   ├── cmd/api/          # entrypoint + REST handlers
│   │   └── internal/{auth,config,db,grpc,service,worker,ws,notify,caddy,realtime}/
│   └── agent/                # Go edge agent (stateless, dials out only)
│       ├── cmd/agent/
│       └── internal/{client,docker,metrics,exec}/
├── packages/
│   ├── proto/                # agent.proto + gen/
│   └── domain/               # shared domain types (JSONB overrides for sqlc)
├── infra/
│   ├── dev/                  # docker-compose: postgres + redis (+ generated certs/)
│   ├── prod/                 # production compose + setup scripts
│   ├── migrations/           # numbered SQL migrations + schema.sql snapshot
│   └── scripts/              # panel + edge node install/update (install-node.sh, …)
├── templates/                # deploy template YAMLs (minecraft, rust, docker, static)
├── design.md                 # UI / design system reference
├── go.work
├── QUICKSTART.md             # copy-paste local dev sequence
├── AGENTS.md                 # agent / assistant context
└── README.md
```

## Feature overview

| Area | Highlights |
| ---- | ---------- |
| **Core** | Multi-tenant services, explicit status state machine, mTLS gRPC agents, WebSocket console/metrics, deploy templates |
| **Install flow** | Pterodactyl-style `install_script` per template; persistent `/mnt/server` volume; **Reinstall** wipes data and re-runs install |
| **Auth** | Better Auth (email/password), JWT verification on API (JWKS in prod), `role` field (`user` / `admin`) |
| **Admin** | Separate admin dashboard, nodes (`/admin/nodes/create` — name only), audit log, live node status over WebSocket |
| **Templates** | YAML blueprints with `env`, `startup_cmd`, `install_script`, typed `configurable` fields (`field_type`: select, password, …) |
| **Sprint 12–14** | Logs, alerts, tags, webhooks, backups, custom domains, role-gated nav, customer suspend, landing page |

## Deploy templates

Templates live in `templates/*.yaml` and are loaded from `TEMPLATES_DIR` (default `./templates`).

| Template | Type | Notes |
| -------- | ---- | ----- |
| `minecraft` | game | `itzg/minecraft-server` |
| `rust` | game | SturdyStubs AIO egg; SteamCMD install script + dedicated startup |
| `docker` | docker | Generic image + ports |
| `static` | static | nginx; optional `ASSET_URL` in install |

Each service gets a Docker volume `vivox-data-{serviceId}` mounted at `/mnt/server`.
On first start the agent runs the template's `install_script`, writes
`.vivox-installed`, then starts the process (`startup_cmd` or image default).

**Reinstall:** `POST /api/services/:id/reinstall` — wipes the data volume and
re-runs install (UI: **Reinstall** on the service detail page).

## Toolchain (verified versions)

| Tool | Version (verified) | Used for |
| ---- | ------------------ | -------- |
| Go | 1.26+ | `apps/api`, `apps/agent`, packages |
| Node / npm | v24+ / 11+ | `apps/web` (Next.js 15.5) |
| protoc + protoc-gen-go/-go-grpc | protoc 35+ | gRPC stubs |
| sqlc | 1.31+ | typed db layer (optional regen) |
| Docker + Compose | (for dev infra) | local Postgres + Redis, edge nodes |

## Quick start (full stack, dev)

See **[QUICKSTART.md](QUICKSTART.md)** for the full step-by-step (register,
promote admin, register node, deploy).

Two supported dev paths for the agent ↔ control-plane gRPC link:

- **Insecure bypass** (fastest): `GRPC_TLS_DISABLED=true` on the API + `-insecure` on the agent.
- **Dev mTLS** (default): API auto-generates certs into `infra/dev/certs/` on first boot.

### 1. Backing services (Postgres + Redis)

```bash
docker compose -f infra/dev/docker-compose.yml up -d
# or: ./dev.sh  /  .\dev.ps1
```

Dev credentials: user `nexus`, password `nexus`, db `nexus` on `localhost:5432` / `6379`.

### 2. Migrations

Migrations run **automatically** when the API starts (`migrate.Run` over
`infra/migrations/`). Set `MIGRATIONS_DIR` if not running from the repo root.

### 3. Start the control plane

```powershell
$env:GRPC_TLS_DISABLED = "true"
$env:AUTH_DEV_MODE     = "true"
go run ./apps/api/cmd/api
```

HTTP `:8080` (REST + WebSocket), gRPC `:9090`. Templates from `./templates`.

### 4. Frontend

```bash
cd apps/web && npm install && npm run dev
```

Open **http://localhost:3000** — landing page when signed out; register, then
promote your account to `admin` (see QUICKSTART) to access the admin panel.

### 5. Register a node + agent

**UI:** Admin → Nodes → **Register node** (`/admin/nodes/create`) — only a name
is required; CPU/RAM/disk are detected when the agent connects.

**API:**

```bash
curl -X POST http://localhost:8080/api/admin/nodes \
  -H "X-Dev-User: dev-admin" -H "X-Dev-Role: admin" \
  -H "Content-Type: application/json" \
  -d '{"name":"edge-01"}'
```

**Production edge node** (on the host):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/REALJasonAU/Vivox-Main/main/infra/scripts/install-node.sh) \
  --panel-url https://your-panel.example.com \
  --token <AGENT_TOKEN> \
  --node-id <NODE_UUID>
```

When the panel and API share a machine, set `NEXUS_CONTROL_ADDR=127.0.0.1:9090`
in `/etc/vivox-agent/agent.env` (public HTTPS is for the web UI only).

**Local dev agent:**

```bash
go run ./apps/agent/cmd/agent -addr localhost:9090 -agent-id <UUID> \
  -token <TOKEN> -insecure
```

Use `-mock` only for pipeline testing without Docker.

## Key API routes

| Method | Path | Access | Purpose |
| ------ | ---- | ------ | ------- |
| `GET` | `/api/services` | owner | List services for current user |
| `POST` | `/api/services` | authenticated; `owner_id` override admin-only | Create service |
| `POST` | `/api/services/:id/reinstall` | owner | Wipe data volume + re-run install script |
| `GET` | `/api/templates` | authenticated | List deploy templates |
| `GET` | `/api/admin/customers` | admin | List users + service counts |
| `PATCH` | `/api/admin/customers/:id/suspend` | admin | Suspend customer |
| `POST` | `/api/admin/nodes` | admin | Register node (`name` required; `region` defaults to `default`) |
| `GET` | `/api/admin/nodes` | admin | Edge nodes |
| `GET` | `/api/admin/audit` | admin | Audit events |

All `/api/*` routes (except health) run through auth middleware and
`suspendCheck` (blocks suspended non-admins).

## Configuration

### API (`apps/api`)

| Env var | Default | Purpose |
| ------- | ------- | ------- |
| `HTTP_ADDR` | `:8080` | REST + WebSocket |
| `GRPC_ADDR` | `:9090` | Agent gRPC |
| `DATABASE_URL` | `postgres://nexus:nexus@localhost:5432/nexus` | Postgres |
| `REDIS_ADDR` | `localhost:6379` | Redis Streams + asynq |
| `BETTER_AUTH_SECRET` | `dev-insecure-secret-change-me` | JWT HMAC (must match web app) |
| `BETTER_AUTH_JWKS_URL` | — | JWKS URL for EdDSA JWT verification (production) |
| `AUTH_DEV_MODE` | `true` | `X-Dev-User` / `X-Dev-Role` dev bypass |
| `MIGRATIONS_DIR` | `infra/migrations` | SQL migrations folder |
| `GRPC_TLS_DISABLED` | `false` | Disable mTLS on gRPC (dev) |
| `TEMPLATES_DIR` | `templates` | Deploy templates |
| `CADDY_ADMIN_URL` | `""` | Caddy admin API for custom domains (optional) |

### Agent

| Env / flag | Purpose |
| ---------- | ------- |
| `NEXUS_CONTROL_ADDR` | Control plane gRPC `host:port` |
| `NEXUS_AGENT_ID` / `NEXUS_AGENT_TOKEN` | Node identity + bearer token |
| `VIVOX_PANEL_URL` | Panel URL (install scripts) |
| `-insecure` | Skip mTLS (dev) |
| `-mock` | Synthetic logs/metrics (no Docker) |

Internal env vars (stripped before container): `VIVOX_INSTALL_SCRIPT`,
`VIVOX_STARTUP_CMD`, `VIVOX_FORCE_REINSTALL`, `VIVOX_CPU_SHARES`, `VIVOX_DISK_GB`.

## Regenerating generated code

```bash
cd packages/proto && ./gen.ps1    # gRPC stubs
cd apps/api && sqlc generate      # typed db layer (optional)
```

## Build & verify

```bash
go build ./...
go vet ./...
cd apps/web && npm run build
```

## Architecture (Phase 1)

- **Zero-trust edge:** agents use mTLS gRPC only; telemetry → Redis Streams → WSHub → browser.
- **One bidi stream per agent** for tasks, logs, metrics, heartbeats.
- **Multi-tenant:** `services.owner_id` + `auth.OwnerID(c)`; admins bypass ownership where implemented.
- **Install lifecycle:** image pull → container with `/mnt/server` volume → install script (once) → startup command.
- **Explicit status machine:** `PROVISIONING → STARTING → RUNNING → STOPPING → STOPPED` (+ `CRASHED`).

```
Create service → asynq deploy worker → StartServiceTask → agent
  → pull image → mount vivox-data-{id}:/mnt/server
  → run install_script (if no .vivox-installed marker)
  → exec startup_cmd (or image entrypoint)
```

## Verified build status

| Module / app | `go build` | `npm run build` |
| ------------ | ---------- | ----------------- |
| `apps/api` | pass | — |
| `apps/agent` | pass | — |
| `apps/web` | pass | pass |

## Known gaps

- **Self-serve ordering:** customers cannot deploy their own services yet — staff provision via admin UI.
- **Browser WebSocket + dev headers:** `X-Dev-User` works for `curl` only; browsers need Better Auth session cookies.
- **Game images vs `/mnt/server`:** some images (e.g. `itzg/minecraft-server`) expect `/data` — set `DATA=/mnt/server` in template env if needed.
