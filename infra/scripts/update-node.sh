#!/usr/bin/env bash
# Vivox — node agent update (preserves /etc/vivox-agent/agent.env)

set -euo pipefail

VIVOX_REPO_URL="https://github.com/REALJasonAU/Vivox-Main"
VIVOX_BRANCH="main"
VIVOX_INSTALL_DIR="/opt/vivox"
VIVOX_COMPOSE_FILE="infra/prod/docker-compose.yml"
VIVOX_ENV_FILE="infra/prod/.env"

AGENT_DIR="/opt/vivox-agent"
AGENT_ENV="/etc/vivox-agent/agent.env"

export PATH=$PATH:/usr/local/go/bin

if [[ ! -d "$AGENT_DIR" ]]; then
  echo "✗ No agent install found at ${AGENT_DIR}." >&2
  exit 1
fi

cd "$AGENT_DIR"

if [[ -f "$AGENT_ENV" ]]; then
  cp "$AGENT_ENV" "/tmp/vivox-agent-env-backup-$(date +%s)"
fi

git fetch origin "$VIVOX_BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$VIVOX_BRANCH")
if [[ "$LOCAL" == "$REMOTE" ]]; then
  echo "Already up to date."
  exit 0
fi
git pull origin "$VIVOX_BRANCH"

LATEST=$(ls -t /tmp/vivox-agent-env-backup-* 2>/dev/null | head -1)
[[ -n "$LATEST" ]] && cp "$LATEST" "$AGENT_ENV"

CGO_ENABLED=0 go build -o /usr/local/bin/vivox-agent ./apps/agent/cmd/agent

systemctl restart vivox-agent

echo "✓ Agent updated to $(git rev-parse --short HEAD)"
