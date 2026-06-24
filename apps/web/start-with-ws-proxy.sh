#!/bin/sh
set -eu

# Next standalone server (HTTP only path — WS handled by ws-proxy.mjs)
export PORT="${NEXT_INTERNAL_PORT:-3001}"
export HOSTNAME="${NEXT_INTERNAL_HOST:-127.0.0.1}"

node server.js &
NEXT_PID=$!

# Wait for Next standalone to bind before accepting public traffic.
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if node -e "require('http').get('http://127.0.0.1:${NEXT_INTERNAL_PORT:-3001}/', (r) => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

cleanup() {
  kill "$NEXT_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Public listener (what Pangolin hits)
export PORT="${PUBLIC_PORT:-3000}"
export HOSTNAME="${PUBLIC_HOST:-0.0.0.0}"

exec node ws-proxy.mjs
