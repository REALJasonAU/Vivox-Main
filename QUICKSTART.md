# Vivox — Quick Start

Copy-pasteable sequence to run the full local stack (infra + API + web + agent).
The product UI is **Vivox**; repo module paths use `nexus-control`.

## Prerequisites

- Docker Desktop (Postgres + Redis)
- Go 1.23+
- Node.js 20+

## 1. Start infrastructure

**Bash (macOS / Linux / WSL):**

```bash
./dev.sh
```

**PowerShell (Windows):**

```powershell
.\dev.ps1
```

This starts `postgres` and `redis` from `infra/dev/docker-compose.yml` and prints
recommended API env vars.

## 2. Run the API

From the **repo root** (migrations apply automatically on startup):

```bash
go run ./apps/api/cmd/api
```

API listens on `http://localhost:8080` (REST + WebSocket) and `:9090` (gRPC for agents).

## 3. Run the web app

```bash
cd apps/web
npm install   # first time only
npm run dev
```

Open **http://localhost:3000** — you should see the **Vivox landing page** when signed out.

## 4. Register accounts

### Customer account (optional)

Go to **http://localhost:3000/register** and create a normal user. After sign-in:

- Sidebar shows **Services** and **Settings** only.
- Dashboard empty state says services will appear once staff set them up.
- **Deploy** is not available (admin-only).

### Staff / admin account

Register your own account, then promote it to admin:

```bash
docker compose -f infra/dev/docker-compose.yml exec postgres \
  psql -U nexus -d nexus -c "UPDATE \"user\" SET role='admin' WHERE email='you@example.com';"
```

**PowerShell:**

```powershell
docker compose -f infra/dev/docker-compose.yml exec postgres `
  psql -U nexus -d nexus -c "UPDATE ""user"" SET role='admin' WHERE email='you@example.com';"
```

Log out and back in so the session picks up `role: admin`. Admins see **Customers**, **Nodes**, **Audit**, **Templates**, and the Deploy actions.

## 5. Register a node and run the agent

1. **Admin → Nodes → Register** — copy the **agent token** (shown once).
2. Run the edge agent on a machine with Docker:

```bash
go run ./apps/agent/cmd/agent \
  -addr localhost:9090 \
  -agent-id <node-uuid-from-admin> \
  -token <agent-token> \
  -insecure
```

Do **not** use `-mock` for real deploys — `-mock` only fakes logs/metrics without Docker.

## 6. Deploy and verify (admin)

1. **Deploy** (sidebar or dashboard) → pick a template → deploy.
2. Open the service → **Console** — live logs via WebSocket.
3. **Start / Stop / Restart** — status updates on the dashboard.

Deploy is **admin-only**. Customers cannot reach `/deploy` (redirected to dashboard).

## 7. Manage customers (admin)

1. Open **Admin → Customers**.
2. View registered users, service counts, and active/suspended status.
3. **Service** — opens `/deploy?for=<customerId>` to provision on their behalf (`owner_id` sent to API).
4. **Suspend / Unsuspend** — blocks or restores API access for that customer (admins are never blocked).

After provisioning for a customer, you are redirected back to **Customers**.

---

## Roles at a glance

| | Customer (`user`) | Admin (`admin`) |
| --- | --- | --- |
| Landing `/` | redirect to dashboard if signed in | same |
| Services dashboard | own services only | all services (admin list) |
| Deploy | hidden | yes (+ `?for=userId`) |
| Customers / Nodes / Audit | hidden | yes |
| API when suspended | `403` | still works |

## Env reference

| Variable | Dev value |
|----------|-----------|
| `DATABASE_URL` | `postgres://nexus:nexus@localhost:5432/nexus` |
| `REDIS_ADDR` | `localhost:6379` |
| `BETTER_AUTH_SECRET` | shared with `apps/web` (see `.env.example`) |
| `MIGRATIONS_DIR` | `infra/migrations` (auto-applied on API start) |
| `NEXT_PUBLIC_API_URL` | `/api/control` (proxied through Next.js) |
| `API_URL` / `API_INTERNAL_URL` | `http://localhost:8080` (Next.js rewrite target) |
| `CADDY_ADMIN_URL` | optional — enable custom domains (Sprint 13) |

See [README.md](README.md) for architecture and [AGENTS.md](AGENTS.md) for assistant context.
