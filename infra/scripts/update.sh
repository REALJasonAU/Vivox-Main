#!/usr/bin/env bash
# Vivox — panel update (preserves infra/prod/.env)
# Usage: update.sh [--rebuild]   # --rebuild: docker build even when git is up to date

set -euo pipefail

FORCE_REBUILD=false
if [[ "${1:-}" == "--rebuild" ]] || [[ "${1:-}" == "-f" ]]; then
  FORCE_REBUILD=true
fi

VIVOX_REPO_URL="https://github.com/REALJasonAU/Vivox-Main"
VIVOX_BRANCH="main"
VIVOX_INSTALL_DIR="/opt/vivox"
VIVOX_COMPOSE_FILE="infra/prod/docker-compose.yml"
VIVOX_ENV_FILE="infra/prod/.env"

export DOCKER_BUILDKIT=1

cd "$VIVOX_INSTALL_DIR"

if [[ ! -f "$VIVOX_ENV_FILE" ]]; then
  echo "✗ No Vivox installation found at ${VIVOX_INSTALL_DIR} (missing ${VIVOX_ENV_FILE})." >&2
  exit 1
fi

cp "$VIVOX_ENV_FILE" "/tmp/vivox-env-backup-$(date +%s)"

git fetch origin "$VIVOX_BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$VIVOX_BRANCH")
if [[ "$LOCAL" == "$REMOTE" ]] && [[ "$FORCE_REBUILD" != "true" ]]; then
  echo "Already up to date. Run: bash infra/scripts/update.sh --rebuild to rebuild containers."
  exit 0
fi
if [[ "$LOCAL" != "$REMOTE" ]]; then
  git pull origin "$VIVOX_BRANCH"
fi

LATEST_BACKUP=$(ls -t /tmp/vivox-env-backup-* 2>/dev/null | head -1)
[[ -n "$LATEST_BACKUP" ]] && cp "$LATEST_BACKUP" "$VIVOX_ENV_FILE"

docker compose -f "$VIVOX_COMPOSE_FILE" --env-file "$VIVOX_ENV_FILE" \
  up -d --build --remove-orphans

echo "✓ Updated to $(git rev-parse --short HEAD) at $(date)"
