# Cursor Prompt — Fix WebSocket for Pangolin Reverse Proxy

## Context

Stack: Next.js 15 (App Router, standalone output) + Go Fiber API on `:8080` + Pangolin reverse proxy (Traefik-based).

The symptom: `WebSocket connection to 'wss://…/api/control/ws?token=…' failed: WebSocket is closed before the connection is established.`

## Why This Breaks

**Next.js `rewrites()` only proxy HTTP — they do NOT handle the WebSocket upgrade handshake.**

When the browser sends `GET /api/control/ws` with `Upgrade: websocket`, Next.js accepts the TCP connection but never sends a `101 Switching Protocols` back, so the connection is immediately closed. This breaks both development (`next dev`) and any production deployment that relies on Next.js rewrites for WebSocket traffic.

The existing `apps/web/ws-proxy.mjs` correctly solves this for Docker production (it sits in front of Next.js on port 3000, intercepts WS upgrades, and forwards them directly to the Go API). **But there is no equivalent for `next dev`**, so local development WebSockets never work.

## Files to Read First

1. `apps/web/ws-proxy.mjs` — the production WS proxy (already correct in concept)
2. `apps/web/start-with-ws-proxy.sh` — production startup script
3. `apps/web/next.config.ts` — rewrites config
4. `apps/web/package.json` — dev scripts
5. `apps/api/cmd/api/main.go` — the Go API's `/api/ws` route and Fiber config
6. `apps/web/src/hooks/useWebSocket.ts` — the WebSocket client singleton

## Tasks

### Task 1 — Dev mode: run ws-proxy alongside `next dev`

In `apps/web/package.json`, change the `dev` script so that Next.js listens on port 3001 and ws-proxy.mjs listens on port 3000 (what the browser hits). Use `concurrently` or two separate processes.

**Option A (preferred — no extra dep):** Create `apps/web/dev.sh`:
```sh
#!/bin/sh
set -eu
export NEXT_INTERNAL_PORT=3001
export NEXT_INTERNAL_HOST=127.0.0.1
export NEXT_INTERNAL_URL=http://127.0.0.1:3001
export PORT=3000
export HOSTNAME=0.0.0.0
# Go API on localhost in dev
export API_INTERNAL_URL="${API_URL:-http://127.0.0.1:8080}"

# Start Next.js dev server on port 3001
PORT=3001 HOSTNAME=127.0.0.1 npx next dev &
NEXT_PID=$!

# Wait for Next to be ready
sleep 3

cleanup() { kill "$NEXT_PID" 2>/dev/null || true; }
trap cleanup INT TERM EXIT

# Start ws-proxy on port 3000
node ws-proxy.mjs
```

Add a script to `package.json`:
```json
"dev:proxy": "sh dev.sh",
"dev": "next dev"
```

Developers run `npm run dev:proxy` for full WS support (or `npm run dev` when not needing WS).

**Option B (simpler):** Install `concurrently` and update `package.json`:
```json
"dev": "concurrently -k \"PORT=3001 HOSTNAME=127.0.0.1 next dev\" \"NEXT_INTERNAL_URL=http://127.0.0.1:3001 API_INTERNAL_URL=http://127.0.0.1:8080 PORT=3000 node ws-proxy.mjs\""
```

### Task 2 — Fix `ws-proxy.mjs` for Pangolin/Traefik compatibility

Open `apps/web/ws-proxy.mjs` and make these improvements:

**2a. Better error logging** — add the error reason to the proxy error handlers so connection failures are visible in logs:
```js
apiWsProxy.on("error", (err, _req, socket) => {
  console.error("[proxy:api-ws] Cannot reach API:", err.message,
    "— check API_INTERNAL_URL:", API_TARGET);
  socket?.destroy?.();
});
```

**2b. Preserve `Connection` header for Pangolin** — Traefik/Pangolin strips `Connection: Upgrade` headers by default. Re-inject them:
```js
apiWsProxy.on("proxyReqWs", (proxyReq, req) => {
  normalizeForwardedProto(req, proxyReq);
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  if (host) proxyReq.setHeader("X-Forwarded-Host", host);
  // Ensure WS upgrade headers survive the hop
  proxyReq.setHeader("Connection", "Upgrade");
  proxyReq.setHeader("Upgrade", "websocket");
});
```

**2c. Add a health endpoint** so Pangolin/Traefik can confirm the proxy is alive:
```js
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  nextProxy.web(req, res);
});
```

**2d. Handle `ECONNREFUSED` gracefully** — if the Go API isn't up yet, don't crash:
```js
apiWsProxy.on("error", (err, _req, socket) => {
  if (err.code !== "ECONNREFUSED") {
    console.error("[proxy:api-ws]", err.message);
  }
  socket?.destroy?.();
});
```

### Task 3 — Go API: add WebSocket-friendly CORS

Open `apps/api/cmd/api/main.go` and add CORS headers before the auth middleware so the WebSocket upgrade handshake is not blocked by a CORS preflight:

```go
import "github.com/gofiber/fiber/v2/middleware/cors"

// In buildHTTP(), before apiGroup:
app.Use(cors.New(cors.Config{
    AllowOrigins:     "*",   // tighten this to your actual domain in production
    AllowHeaders:     "Authorization, Content-Type, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Protocol, Sec-WebSocket-Extensions",
    AllowMethods:     "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    AllowCredentials: false,
}))
```

Note: `AllowCredentials: true` cannot be combined with `AllowOrigins: "*"`. Since the WS auth uses `?token=` (not cookies), leave credentials as false.

### Task 4 — Go API: verify the WebSocket upgrade check

In `apps/api/cmd/api/main.go`, the WS route uses `gofiber/contrib/websocket`:
```go
apiGroup.Get("/ws", websocket.New(hub.Serve, websocket.Config{
    HandshakeTimeout:  15 * time.Second,
    EnableCompression: false,
}))
```

Add the `websocket.IsWebSocketUpgrade` check to return a clear error for plain HTTP requests:
```go
apiGroup.Use("/ws", func(c *fiber.Ctx) error {
    if websocket.IsWebSocketUpgrade(c) {
        c.Locals("allowed", true)
        return c.Next()
    }
    return fiber.ErrUpgradeRequired
})
apiGroup.Get("/ws", websocket.New(hub.Serve, websocket.Config{
    HandshakeTimeout:  15 * time.Second,
    EnableCompression: false,
}))
```

### Task 5 — Fix `next.config.ts` to NOT intercept the WS path

In `apps/web/next.config.ts`, explicitly exclude the WebSocket path from rewrites. Next.js should never see `/api/control/ws` — the ws-proxy intercepts it first. But if `next dev` is somehow reached, this makes the failure explicit:

```ts
async rewrites() {
  return [
    {
      // WebSocket path is handled by ws-proxy.mjs — not proxied via Next.js
      // This rewrite handles REST API calls only.
      source: "/api/control/:path((?!ws).*)",
      destination: `${apiUrl}/api/:path*`,
    },
  ];
},
```

The negative lookahead `(?!ws)` ensures `/api/control/ws` is never matched by the Next.js rewrite. If it somehow reaches Next.js (no proxy in front), the browser gets a 404 instead of a silently hung connection.

### Task 6 — Verify environment variables for production

In whatever deploys this (docker-compose or production config), confirm:
- `API_INTERNAL_URL=http://api:8080` (Docker service name, not `localhost`)
- `NEXT_INTERNAL_URL=http://127.0.0.1:3001` (Next.js on 3001 inside container)
- `PORT=3000` for ws-proxy
- `NEXT_PUBLIC_API_URL=/api/control` (relative, so browser uses same origin)

If `API_INTERNAL_URL` is not set, `ws-proxy.mjs` defaults to `http://api:8080`. If the Go API Docker service is named something other than `api`, update this variable.

Add startup validation to `ws-proxy.mjs`:
```js
console.log("[ws-proxy] Config:", {
  listen: `${LISTEN_HOST}:${LISTEN_PORT}`,
  next: NEXT_TARGET,
  api: API_TARGET,
});
```

### Task 7 — `useWebSocket.ts`: guard against CLOSING state

In `apps/web/src/hooks/useWebSocket.ts`, the `connect()` method currently only checks for OPEN and CONNECTING states. Add CLOSING (state 2) to prevent calling `teardownSocket` on an in-flight close:

```ts
private connect() {
  if (typeof window === "undefined") return;
  if (this.intentionalClose || this.topics.size === 0) return;
  if (this.connecting) return;
  const rs = this.ws?.readyState;
  if (
    rs === WebSocket.OPEN ||
    rs === WebSocket.CONNECTING ||
    rs === WebSocket.CLOSING          // ← add this
  ) {
    return;
  }
  // ... rest of connect()
}
```

This prevents creating a new socket while the old one is still shutting down, which causes the "WebSocket is closed before the connection is established" error Chrome reports when `close()` is called on a CONNECTING socket.

## Verification

After all changes:

1. **Dev**: `npm run dev:proxy` (port 3000) — open browser DevTools → Network → WS → confirm 101 Switching Protocols response
2. **Production**: check `docker logs nexus-web` for `[ws-proxy] listening on…` and then `[proxy:api-ws]` lines
3. **Pangolin health**: curl `https://vivoxpanel.jasonn.net/health` — should return `ok` (from the ws-proxy health endpoint)
4. **WS connect test**: In browser console on the live site: `new WebSocket('wss://vivoxpanel.jasonn.net/api/control/ws?token=test')` — you should get a 401 (not a close-before-open), meaning the proxy reached the Go API

## Summary of Root Causes

| Symptom | Root Cause | Fix |
|---|---|---|
| WS closed before established in dev | `next dev` never handles WS upgrades | Task 1: run ws-proxy alongside next dev |
| WS closed before established in prod | API_INTERNAL_URL wrong or Go API unreachable | Task 6: verify env vars + Task 2: add error logging |
| Console doesn't work | Depends on WS | Cascade fix from above |
| File manager 500 | Agent not connected OR files API bug | Separate issue — check agent connection |
| Reconnect storm / "Insufficient resources" | Already fixed in useWebSocket.ts via generation counter + teardown | Task 7: add CLOSING guard |
