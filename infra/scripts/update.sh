#!/usr/bin/env bash
# Vivox — panel update (preserves infra/prod/.env)

set -euo pipefail

VIVOX_REPO_URL="https://github.com/your-org/vivox"
VIVOX_BRANCH="main"
VIVOX_INSTALL_DIR="/opt/vivox"
VIVOX_COMPOSE_FILE="infra/prod/docker-compose.yml"
VIVOX_ENV_FILE="infra/prod/.env"

cd "$VIVOX_INSTALL_DIR"

if [[ ! -f "$VIVOX_ENV_FILE" ]]; then
  echo "✗ No Vivox installation found at ${VIVOX_INSTALL_DIR} (missing ${VIVOX_ENV_FILE})." >&2
  exit 1
fi

cp "$VIVOX_ENV_FILE" "/tmp/vivox-env-backup-$(date +%s)"

git fetch origin "$VIVOX_BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$VIVOX_BRANCH")
if [[ "$LOCAL" == "$REMOTE" ]]; then
  echo "Already up to date. Nothing to do."
  exit 0
fi
git pull origin "$VIVOX_BRANCH"

LATEST_BACKUP=$(ls -t /tmp/vivox-env-backup-* 2>/dev/null | head -1)
[[ -n "$LATEST_BACKUP" ]] && cp "$LATEST_BACKUP" "$VIVOX_ENV_FILE"

docker compose -f "$VIVOX_COMPOSE_FILE" --env-file "$VIVOX_ENV_FILE" \
  up -d --build --remove-orphans

echo "✓ Updated to $(git rev-parse --short HEAD) at $(date)"
