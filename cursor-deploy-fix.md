# Vivox — Fix All Production Deployment Issues

We've been deploying Vivox (a monorepo: `go.work` workspace with `apps/api`, `apps/agent`, `apps/web`, `packages/proto`, `packages/domain`) to a VPS using Docker Compose. Pangolin (on a **separate** server) handles SSL termination and reverse proxies into port 3000 on the VPS. Below are every issue we hit and exactly what to fix. Apply all changes.

---

## 1. `apps/api/Dockerfile` — Two build failures

**Problem A:** `go.work` requires Go ≥ 1.25 but the Dockerfile uses `golang:1.23-alpine` → build fails.

**Problem B:** `go.work` references `apps/agent` but the Dockerfile never copies it → `go mod download` fails with "no such module".

**Fix:** Change the file to:

```dockerfile
FROM golang:1.25-alpine AS builder
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.work ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY apps/agent/ ./apps/agent/
WORKDIR /src/apps/api
RUN go mod download
RUN CGO_ENABLED=0 go build -o /api ./cmd/api

FROM alpine:3.20
RUN apk add --no-cache ca-certificates docker-cli
WORKDIR /app
COPY --from=builder /api /app/api
COPY infra/migrations /app/infra/migrations
COPY templates /app/templates
ENV HTTP_ADDR=:8080
ENV GRPC_ADDR=:9090
ENV MIGRATIONS_DIR=/app/infra/migrations
ENV TEMPLATES_DIR=/app/templates
EXPOSE 8080 9090
CMD ["/app/api"]
```

---

## 2. `apps/web/Dockerfile` — Build-time env var baked wrong

**Problem:** `next.config.ts` reads `process.env.API_URL` to set rewrite destinations. Next.js evaluates `rewrites()` at **build time** (not runtime), so the runtime `API_URL=http://api:8080` env var in docker-compose is ignored — the built image bakes in `localhost:8080` (the fallback). Every proxied API call then fails with `ECONNREFUSED`.

**Fix:** Add `ARG API_URL` + `ENV API_URL` **before** `npm run build` in the builder stage:

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm ci || npm install

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/web/ ./
ARG API_URL=http://api:8080
ENV API_URL=$API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
```

---

## 3. `infra/prod/docker-compose.yml` — Traefik network + missing build args

**Problems:**
- The compose file references a `traefik_public` external Docker network. Pangolin is on a **separate VPS**, not the same host. This network doesn't exist → `docker compose up` fails immediately with "network traefik_public declared as external, but could not be found".
- All Traefik labels on the web service are useless (no local Traefik instance) and cause confusion.
- The web service doesn't pass `API_URL` as a build arg, so fix #2 above has no effect.
- `NEXT_PUBLIC_APP_URL` is missing from the web environment — Better Auth client uses it server-side.
- Port 3000 is never exposed to the host — Pangolin (on its separate server) can't reach the panel.

**Fix:** Replace `infra/prod/docker-compose.yml` entirely with:

```yaml
# Vivox — Production stack
#
# Pangolin (SSL / reverse proxy) runs on a SEPARATE server and routes
# https://your-domain → http://THIS_VPS_IP:3000
#
# Usage:
#   cp infra/prod/.env.example infra/prod/.env   # fill in secrets
#   docker compose -f infra/prod/docker-compose.yml --env-file infra/prod/.env up -d --build

services:
  postgres:
    image: postgres:16
    container_name: vivox-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: vivox
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: vivox
    volumes:
      - vivox-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vivox -d vivox"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks:
      - internal

  redis:
    image: redis:7
    container_name: vivox-redis
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD}"]
    volumes:
      - vivox-redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks:
      - internal

  api:
    build:
      context: ../..
      dockerfile: apps/api/Dockerfile
    container_name: vivox-api
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      HTTP_ADDR: ":8080"
      GRPC_ADDR: ":9090"
      DATABASE_URL: postgres://vivox:${POSTGRES_PASSWORD}@postgres:5432/vivox
      REDIS_ADDR: redis:6379
      REDIS_PASSWORD: ${REDIS_PASSWORD}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      GRPC_TLS_DISABLED: "${GRPC_TLS_DISABLED:-false}"
      CERT_DIR: /app/certs
      MIGRATIONS_DIR: /app/infra/migrations
      TEMPLATES_DIR: /app/templates
      NODE_PUBLIC_HOST: ${NODE_PUBLIC_HOST:-}
      CADDY_ADMIN_URL: ${CADDY_ADMIN_URL:-}
    volumes:
      - vivox-certs:/app/certs
    # Port 8080 NOT exposed to host — Next.js proxies /api/control/* internally.
    # Port 9090 exposed so remote agents can connect via gRPC.
    ports:
      - "9090:9090"
    networks:
      - internal

  web:
    build:
      context: ../..
      dockerfile: apps/web/Dockerfile
      args:
        # Must be passed at build time — Next.js bakes rewrite destinations
        # into the standalone bundle during `npm run build`.
        API_URL: http://api:8080
    container_name: vivox-web
    restart: unless-stopped
    depends_on:
      - api
    environment:
      DATABASE_URL: postgres://vivox:${POSTGRES_PASSWORD}@postgres:5432/vivox
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: https://${DOMAIN}
      NEXT_PUBLIC_APP_URL: https://${DOMAIN}
      API_INTERNAL_URL: http://api:8080
      API_URL: http://api:8080
      NEXT_PUBLIC_API_URL: /api/control
    # Port 3000 exposed so Pangolin (on its own server) can route traffic here.
    ports:
      - "3000:3000"
    networks:
      - internal

volumes:
  vivox-pgdata:
  vivox-redisdata:
  vivox-certs:

networks:
  internal:
    driver: bridge
```

---

## 4. `apps/api/internal/migrate/migrate.go` — `schema.sql` gets picked up as a migration

**Problem:** The migration runner picks up **every** `.sql` file in `infra/migrations/` alphabetically. `schema.sql` is a reference/documentation file that was already applied manually during initial setup. On a fresh deployment the runner tries to apply it and conflicts with the numbered migrations that follow (duplicate table errors). On a redeployment it's fine only because someone manually inserted it into `schema_migrations` — that's not repeatable.

**Fix:** Filter to only files whose names start with one or more digits (i.e. `001_*.sql`, `002_*.sql` …). Change the file filter in `migrate.go`:

```go
for _, e := range entries {
    if e.IsDir() {
        continue
    }
    name := e.Name()
    // Only run numbered migrations (e.g. 001_foo.sql).
    // schema.sql and any other non-numbered files are skipped.
    if !strings.HasSuffix(name, ".sql") || !isNumbered(name) {
        continue
    }
    files = append(files, filepath.Join(dir, name))
}
```

Add this helper at the bottom of the file:

```go
// isNumbered returns true if the filename starts with at least one digit.
// This excludes reference files like schema.sql from the migration runner.
func isNumbered(name string) bool {
    return len(name) > 0 && name[0] >= '0' && name[0] <= '9'
}
```

---

## 5. `infra/migrations/002_auth.sql` — Missing `jwks` table

**Problem:** Better Auth's JWT plugin (`plugins: [jwt()]`) requires a `jwks` table to store the signing key pair. It isn't in `002_auth.sql`, so the first login after a fresh deploy fails with `relation "jwks" does not exist` and the API returns 500.

**Fix:** Append to `infra/migrations/002_auth.sql`:

```sql
CREATE TABLE IF NOT EXISTS "jwks" (
  id          TEXT PRIMARY KEY,
  "publicKey"  TEXT NOT NULL,
  "privateKey" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Also remove this line from `002_auth.sql` (it references `audit_events` which doesn't exist yet at migration 002 — it's created by `schema.sql` which is now excluded from the runner):

```sql
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
```

Move that index to the appropriate numbered migration that creates `audit_events`, or check if `audit_events` is created in one of the other numbered migrations and add it there.

---

## 6. `apps/web/src/lib/api.ts` — Race condition causes 401 loop on page load

**Problem:** React fires child `useEffect`s before parent ones. The dashboard page's `useApi` fires **before** `SessionSync` (mounted in `Providers`, a parent) has had a chance to call `authClient.token()` and set the in-memory Bearer token. The request goes out with only the opaque `better-auth.session_token` cookie — the Go API tries to parse it as a JWT, fails, and returns 401. `apiFetch` then does `window.location.href = /login`, but the middleware sees the cookie is still valid and redirects back to `/dashboard` — infinite loop.

**Fix:** Add a one-time promise to `api.ts` that blocks `apiFetch` until `SessionSync` has called `setApiToken` at least once:

Find the current `setApiToken` function and the module-level `let authToken` declaration and replace that whole block with:

```ts
let authToken: string | null = null;

/**
 * One-time promise that resolves as soon as SessionSync calls setApiToken for
 * the first time (or after 4 s as a safety valve). This prevents a race where
 * dashboard useEffects fire before the Bearer JWT has been fetched.
 */
let _tokenSyncResolve: (() => void) | undefined;
const _tokenSyncPromise = new Promise<void>((resolve) => {
  _tokenSyncResolve = resolve;
  setTimeout(resolve, 4000); // safety valve
});

export function setApiToken(token: string | null): void {
  authToken = token;
  _tokenSyncResolve?.();
  _tokenSyncResolve = undefined;
}
```

Then at the very top of the `apiFetch` function body (before the destructure), add:

```ts
if (typeof window !== "undefined") {
  await _tokenSyncPromise;
}
```

---

## 7. `infra/prod/.env.example` — Document all required vars

Replace with:

```bash
# Vivox production environment — copy to .env and fill in values
# Generate secrets with: openssl rand -hex 32

# -------------------------------------------------------------------
# Required
# -------------------------------------------------------------------

# Your panel domain (no https://)
DOMAIN=panel.yourdomain.com

# Strong random secrets — NEVER use the dev defaults in production
BETTER_AUTH_SECRET=replace_with_openssl_rand_hex_32
POSTGRES_PASSWORD=replace_with_openssl_rand_hex_32
REDIS_PASSWORD=replace_with_openssl_rand_hex_32

# -------------------------------------------------------------------
# gRPC / Agent connectivity
# -------------------------------------------------------------------

# Set to "true" ONLY if agents connect via WireGuard (Pangolin/Gerbil tunnel).
# If agents connect over the public internet, leave as "false".
GRPC_TLS_DISABLED=false

# Public IP or hostname agents use to reach port 9090 on this VPS.
NODE_PUBLIC_HOST=

# -------------------------------------------------------------------
# Optional
# -------------------------------------------------------------------

# Caddy Admin API URL — only needed for custom domain provisioning.
CADDY_ADMIN_URL=
```

---

## Summary of all files to change

| File | What changes |
|---|---|
| `apps/api/Dockerfile` | Go 1.23 → 1.25; add `COPY apps/agent/` |
| `apps/web/Dockerfile` | Add `ARG API_URL` + `ENV API_URL` before `npm run build` |
| `infra/prod/docker-compose.yml` | Remove Traefik network/labels; expose port 3000; add build arg `API_URL`; add `NEXT_PUBLIC_APP_URL` |
| `apps/api/internal/migrate/migrate.go` | Skip non-numbered `.sql` files (exclude `schema.sql`) |
| `infra/migrations/002_auth.sql` | Add `jwks` table; remove the premature `audit_events` index |
| `apps/web/src/lib/api.ts` | Add `_tokenSyncPromise` + await it in `apiFetch` to fix 401 loop |
| `infra/prod/.env.example` | Clean up and document all vars |

After making all changes, a **fresh VPS** should be deployable with just:

```bash
cp infra/prod/.env.example infra/prod/.env
# fill in DOMAIN, BETTER_AUTH_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD
docker compose -f infra/prod/docker-compose.yml --env-file infra/prod/.env up -d --build
```

No manual SQL, no manual `schema_migrations` inserts, no build arg hacks.
