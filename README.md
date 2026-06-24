# Vivox

**Vivox** is a multi-tenant hosting control plane: customers log in to manage their
services; staff use an admin dashboard to manage customers, nodes, and
provisioning. The product UI and branding are Vivox; the monorepo module paths
use `nexus-control` internally.

Stack: Next.js 15 premium UI, Go control plane (HTTP/REST + gRPC), stateless Go
edge agents, Better Auth (JWT + `role` on the `user` table), PostgreSQL, and
Redis Streams.

> **Status:** Phase 1 control plane, edge agent, and web app are implemented
> through **Sprint 14** (hosting company panel). The workspace builds and
> vets cleanly. See **Verified build status** below.

## Product model (Sprint 14+)

| Role | Who | What they see |
| ---- | --- | ------------- |
| **Customer** (`role: user`) | Registered account | Services dashboard, service detail, Settings. No deploy, nodes, audit, or customers. |
| **Admin** (`role: admin`) | Hosting staff | Full nav: Services, **Customers**, Nodes, Audit, Templates (deploy), Settings. |

- Services are scoped by `owner_id`. Customers only see their own services.
- **No self-serve ordering yet** — admins deploy services manually (including on
  behalf of a customer via **Customers → Service** or `/deploy?for=<userId>`).
- Admins can **suspend** customers; suspended users get `403` on API calls
  (`suspendCheck` middleware + Redis cache).
- Unauthenticated visitors see a **landing page** at `/`; signed-in users go to
  `/dashboard`.

## Monorepo layout

```
nexus-control/
├── apps/
│   ├── web/                  # Next.js 15 frontend (Vivox UI)
│   │   └── src/{app,components,hooks,lib}/
│   ├── api/                  # Go control plane (HTTP/REST + gRPC + asynq worker)
│   │   ├── cmd/api/          # entrypoint + REST handlers (handlers.go, handlers_sprint*.go)
│   │   ├── internal/{auth,config,db,grpc,service,worker,ws,notify,caddy}/
│   │   ├── sqlc.yaml
│   │   └── query.sql
│   └── agent/                # Go edge agent (stateless, dials out only)
│       ├── cmd/agent/
│       └── internal/{client,docker,metrics,exec}/
├── packages/
│   ├── proto/                # agent.proto + gen/
│   └── domain/               # shared domain types (JSONB overrides for sqlc)
├── infra/
│   ├── dev/                  # docker-compose: postgres + redis (+ generated certs/)
│   └── migrations/           # numbered SQL migrations + schema.sql snapshot
├── templates/                # deploy template YAMLs
├── go.work
├── QUICKSTART.md             # copy-paste local dev sequence
├── AGENTS.md                   # agent / assistant context
└── README.md
```

## Feature overview (by sprint)

| Area | Highlights |
| ---- | ---------- |
| **Core** | Multi-tenant services, explicit status state machine, mTLS gRPC agents, WebSocket console/metrics, deploy templates |
| **Auth** | Better Auth (email/password), JWT verification on API, `role` field (`user` / `admin`) |
| **Admin** | Nodes, audit log, list-all-services |
| **Sprint 12** | Log history, resource alerts, service tags, profile settings |
| **Sprint 13** | Webhooks, volume backups, custom domains (optional Caddy admin URL) |
| **Sprint 14** | Role-gated nav, customer list/suspend/unsuspend, admin `owner_id` override on create, landing page |

## Toolchain (verified versions)

| Tool | Version (verified) | Used for |
| ---- | ------------------ | -------- |
| Go | 1.26.4 | `apps/api`, `apps/agent`, packages |
| Node / npm | v24.16.0 / 11.13.0 | `apps/web` (Next.js 15.5) |
| protoc + protoc-gen-go/-go-grpc | protoc 35.0 | gRPC stubs |
| sqlc | 1.31.1 | typed db layer (optional regen) |
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

For a fresh database you can also apply the snapshot once:

```powershell
Get-Content infra/migrations/schema.sql |
  docker compose -f infra/dev/docker-compose.yml exec -T postgres psql -U nexus -d nexus
```

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
promote your account to `admin` (see QUICKSTART) to access Customers, Nodes,
Deploy, and Audit.

### 5. Register a node + agent

```bash
curl -X POST http://localhost:8080/api/admin/nodes \
  -H "X-Dev-User: dev-admin" -H "X-Dev-Role: admin" \
  -H "Content-Type: application/json" \
  -d '{"name":"local","region":"au-1","capacity":{"cpu_cores":4,"ram_mb":16384,"disk_gb":100}}'
```

```bash
go run ./apps/agent/cmd/agent -addr localhost:9090 -agent-id local \
  -token <TOKEN> -insecure -mock
```

Use `-mock` only for pipeline testing without Docker; production-like deploys need a real agent.

## Key API routes

| Method | Path | Access | Purpose |
| ------ | ---- | ------ | ------- |
| `GET` | `/api/services` | owner (or admin sees all via admin list) | List services for current user |
| `POST` | `/api/services` | authenticated; `owner_id` override admin-only | Create service |
| `GET` | `/api/admin/customers` | admin | List users + service counts + suspension |
| `PATCH` | `/api/admin/customers/:id/suspend` | admin | Suspend customer |
| `PATCH` | `/api/admin/customers/:id/unsuspend` | admin | Unsuspend customer |
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
| `AUTH_DEV_MODE` | `true` | `X-Dev-User` / `X-Dev-Role` dev bypass |
| `MIGRATIONS_DIR` | `infra/migrations` | SQL migrations folder |
| `GRPC_TLS_DISABLED` | `false` | Disable mTLS on gRPC (dev) |
| `TEMPLATES_DIR` | `templates` | Deploy templates |
| `CADDY_ADMIN_URL` | `""` | Caddy admin API for custom domains (optional) |
| `NODE_PUBLIC_HOST` | `host.docker.internal` | Host agents publish ports on |

### Agent flags

| Flag | Purpose |
| ---- | ------- |
| `-addr` | Control plane gRPC `host:port` |
| `-agent-id` / `-token` | Node identity + bearer token |
| `-insecure` | Skip mTLS (dev) |
| `-mock` | Synthetic logs/metrics (no Docker) |

## Regenerating generated code

```bash
cd packages/proto && ./gen.ps1    # gRPC stubs
cd apps/api && sqlc generate      # typed db layer (optional; hand-written queries also used)
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
- **Multi-tenant:** `services.owner_id` + `auth.OwnerID(c)`; admins bypass ownership checks where implemented.
- **Explicit status machine:** `PROVISIONING → STARTING → RUNNING → STOPPING → STOPPED` (+ `CRASHED`).

## Verified build status

Verified on Windows (Go 1.26.4, Node v24.16.0):

| Module / app | `go build` | `npm run build` |
| ------------ | ---------- | ----------------- |
| `apps/api` | pass | — |
| `apps/agent` | pass | — |
| `apps/web` | — | pass |

## Known gaps

- **Live smoke test:** Docker may be unavailable locally; use QUICKSTART on a machine with Docker for full E2E.
- **Browser WebSocket + dev headers:** `X-Dev-User` works for `curl` only; browsers need Better Auth cookies (or same-origin API proxy).
- **Region selection:** deploy wizard sends `region`; scheduler may still pick first online node in single-node dev.
- **Self-serve ordering:** customers cannot deploy their own services yet — staff provision via admin UI.
