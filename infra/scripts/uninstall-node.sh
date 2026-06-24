#!/usr/bin/env bash
# Vivox — node agent uninstall

set -euo pipefail

VIVOX_REPO_URL="https://github.com/your-org/vivox"
VIVOX_BRANCH="main"
VIVOX_INSTALL_DIR="/opt/vivox"
VIVOX_COMPOSE_FILE="infra/prod/docker-compose.yml"
VIVOX_ENV_FILE="infra/prod/.env"

AGENT_DIR="/opt/vivox-agent"
AGENT_ENV="/etc/vivox-agent/agent.env"

echo ""
echo "⚠ This will stop the Vivox agent and remove its installation."
echo "Your agent.env will be shown so you can save it first."
echo ""
if [[ -f "$AGENT_ENV" ]]; then
  echo "Current agent.env:"
  cat "$AGENT_ENV"
else
  echo "(No agent.env file found.)"
fi
echo ""
read -r -p 'Type "yes" to confirm: ' confirm
if [[ "$confirm" != "yes" ]]; then
  echo "Aborted."
  exit 0
fi

systemctl stop vivox-agent vivox-agent-updater.timer 2>/dev/null || true
systemctl disable vivox-agent vivox-agent-updater.timer 2>/dev/null || true
rm -f /etc/systemd/system/vivox-agent.service
rm -f /etc/systemd/system/vivox-agent-updater.service /etc/systemd/system/vivox-agent-updater.timer
systemctl daemon-reload

rm -f /usr/local/bin/vivox-agent
rm -rf /etc/vivox-agent
rm -rf "$AGENT_DIR"

echo "✓ Vivox Agent uninstalled."
