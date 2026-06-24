#!/usr/bin/env bash
# Nexus Control — local dev infra + run instructions
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> Starting Postgres + Redis..."
docker compose -f infra/dev/docker-compose.yml up -d postgres redis

echo ""
echo "==> Infra ready. Use these env vars for the API:"
echo "  export DATABASE_URL=postgres://nexus:nexus@localhost:5432/nexus"
echo "  export REDIS_ADDR=localhost:6379"
echo "  export BETTER_AUTH_SECRET=dev-insecure-secret-change-me"
echo "  export AUTH_DEV_MODE=true"
echo "  export GRPC_TLS_DISABLED=true"
echo "  export HTTP_ADDR=:8080"
echo "  export GRPC_ADDR=:9090"
echo "  export MIGRATIONS_DIR=$ROOT/infra/migrations"
echo "  export TEMPLATES_DIR=$ROOT/templates"
echo ""
echo "==> Terminal 1 — API (from repo root):"
echo "  go run ./apps/api/cmd/api"
echo ""
echo "==> Terminal 2 — Web:"
echo "  cd apps/web && npm run dev"
echo ""
echo "==> Open http://localhost:3000/register"
echo "See QUICKSTART.md for the full 6-step sequence."
