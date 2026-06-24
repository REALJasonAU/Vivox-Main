/**
 * Front proxy for the Next.js standalone server.
 *
 * Next.js rewrites() only proxy HTTP — not WebSocket upgrade handshakes. In
 * production (standalone `node server.js`) WS to /api/control/ws never reaches
 * the Go API, which caused instant failures and a client reconnect storm
 * (Chrome: "Insufficient resources" once ~255 sockets leak).
 *
 * This process listens on PORT (3000), forwards normal HTTP to Next on 3001,
 * and proxies WS upgrades for /api/control/ws → API /api/ws with correct
 * X-Forwarded-* headers for Pangolin.
 */
import { createServer } from "node:http";
import { parse as parseUrl } from "node:url";
import httpProxy from "http-proxy";

const LISTEN_HOST = process.env.HOSTNAME ?? "0.0.0.0";
const LISTEN_PORT = parseInt(process.env.PORT ?? "3000", 10);
const NEXT_TARGET = process.env.NEXT_INTERNAL_URL ?? "http://127.0.0.1:3001";
const API_TARGET =
  process.env.API_INTERNAL_URL ?? process.env.API_URL ?? "http://api:8080";

const WS_PUBLIC_PREFIX = "/api/control/ws";
const WS_API_PATH = "/api/ws";

function normalizeForwardedProto(req, proxyReq) {
  const proto = String(req.headers["x-forwarded-proto"] ?? "").toLowerCase();
  // Pangolin/Traefik may send "wss" — backends expect "https" per MDN.
  if (proto === "wss" || proto === "ws") {
    proxyReq.setHeader("X-Forwarded-Proto", "https");
  }
}

const nextProxy = httpProxy.createProxyServer({
  target: NEXT_TARGET,
  ws: true,
  xfwd: true,
});

const apiWsProxy = httpProxy.createProxyServer({
  target: API_TARGET,
  ws: true,
  changeOrigin: true,
  xfwd: true,
});

nextProxy.on("error", (err, _req, res) => {
  console.error("[proxy:next]", err.message);
  if (res && !res.headersSent) {
    res.writeHead(502);
    res.end("Bad Gateway");
  }
});

apiWsProxy.on("error", (err, _req, socket) => {
  console.error("[proxy:api-ws]", err.message);
  socket?.destroy?.();
});

apiWsProxy.on("proxyReqWs", (proxyReq, req) => {
  normalizeForwardedProto(req, proxyReq);
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  if (host) proxyReq.setHeader("X-Forwarded-Host", host);
});

const server = createServer((req, res) => {
  nextProxy.web(req, res);
});

server.on("upgrade", (req, socket, head) => {
  const pathname = parseUrl(req.url ?? "", true).pathname ?? "";
  if (pathname === WS_PUBLIC_PREFIX || pathname.startsWith(`${WS_PUBLIC_PREFIX}/`)) {
    const qs = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    req.url = `${WS_API_PATH}${qs}`;
    apiWsProxy.ws(req, socket, head);
    return;
  }
  nextProxy.ws(req, socket, head);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `[ws-proxy] listening on http://${LISTEN_HOST}:${LISTEN_PORT} → next ${NEXT_TARGET}, ws ${API_TARGET}${WS_API_PATH}`,
  );
});
