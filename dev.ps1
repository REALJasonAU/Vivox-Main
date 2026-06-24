# Nexus Control — local dev infra + run instructions
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "==> Starting Postgres + Redis..."
docker compose -f infra/dev/docker-compose.yml up -d postgres redis

Write-Host ""
Write-Host "==> Infra ready. Use these env vars for the API:"
Write-Host '  $env:DATABASE_URL = "postgres://nexus:nexus@localhost:5432/nexus"'
Write-Host '  $env:REDIS_ADDR = "localhost:6379"'
Write-Host '  $env:BETTER_AUTH_SECRET = "dev-insecure-secret-change-me"'
Write-Host '  $env:AUTH_DEV_MODE = "true"'
Write-Host '  $env:GRPC_TLS_DISABLED = "true"'
Write-Host '  $env:HTTP_ADDR = ":8080"'
Write-Host '  $env:GRPC_ADDR = ":9090"'
Write-Host "  `$env:MIGRATIONS_DIR = `"$Root\infra\migrations`""
Write-Host "  `$env:TEMPLATES_DIR = `"$Root\templates`""
Write-Host ""
Write-Host "==> Terminal 1 — API (from repo root):"
Write-Host "  go run ./apps/api/cmd/api"
Write-Host ""
Write-Host "==> Terminal 2 — Web:"
Write-Host "  cd apps/web; npm run dev"
Write-Host ""
Write-Host "==> Open http://localhost:3000/register"
Write-Host "See QUICKSTART.md for the full 6-step sequence."
