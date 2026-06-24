#!/usr/bin/env bash
# Vivox — panel uninstall

set -euo pipefail

VIVOX_REPO_URL="https://github.com/your-org/vivox"
VIVOX_BRANCH="main"
VIVOX_INSTALL_DIR="/opt/vivox"
VIVOX_COMPOSE_FILE="infra/prod/docker-compose.yml"
VIVOX_ENV_FILE="infra/prod/.env"

if [[ ! -d "$VIVOX_INSTALL_DIR" ]]; then
  echo "✗ No Vivox installation at ${VIVOX_INSTALL_DIR}." >&2
  exit 1
fi

echo ""
echo "⚠ This will stop all Vivox containers and remove the installation."
echo "Your .env secrets will be shown so you can save them first."
echo ""
if [[ -f "$VIVOX_INSTALL_DIR/$VIVOX_ENV_FILE" ]]; then
  echo "Current .env:"
  cat "$VIVOX_INSTALL_DIR/$VIVOX_ENV_FILE"
else
  echo "(No .env file found.)"
fi
echo ""
read -r -p 'Type "yes" to confirm: ' confirm
if [[ "$confirm" != "yes" ]]; then
  echo "Aborted."
  exit 0
fi

read -r -p "Remove all data volumes (postgres, redis)? [y/N] " remove_volumes
remove_volumes="${remove_volumes:-N}"

cd "$VIVOX_INSTALL_DIR"
if [[ -f "$VIVOX_COMPOSE_FILE" && -f "$VIVOX_ENV_FILE" ]]; then
  if [[ "$remove_volumes" =~ ^[Yy]$ ]]; then
    docker compose -f "$VIVOX_COMPOSE_FILE" --env-file "$VIVOX_ENV_FILE" down --volumes
  else
    docker compose -f "$VIVOX_COMPOSE_FILE" --env-file "$VIVOX_ENV_FILE" down
  fi
fi

systemctl stop vivox-updater.timer vivox-updater.service 2>/dev/null || true
systemctl disable vivox-updater.timer 2>/dev/null || true
rm -f /etc/systemd/system/vivox-updater.service /etc/systemd/system/vivox-updater.timer
systemctl daemon-reload

rm -rf "$VIVOX_INSTALL_DIR"

echo "✓ Vivox uninstalled."
