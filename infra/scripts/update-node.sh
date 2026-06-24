#!/usr/bin/env bash
# Vivox — node agent update (rebuild binary; optionally refresh credentials)
#
# bash update-node.sh
# bash update-node.sh --token NEW_TOKEN --panel-url https://panel.example.com --node-id UUID

set -euo pipefail

VIVOX_REPO_URL="https://github.com/REALJasonAU/Vivox-Main"
VIVOX_BRANCH="main"

AGENT_DIR="/opt/vivox-agent"
AGENT_ENV="/etc/vivox-agent/agent.env"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=node-agent-lib.sh
source "${SCRIPT_DIR}/node-agent-lib.sh"

export PATH=$PATH:/usr/local/go/bin

PANEL_URL=""
AGENT_TOKEN=""
NODE_ID=""
CONTROL_ADDR=""

parse_flags() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --panel-url)    PANEL_URL="$2"; shift 2 ;;
      --token)        AGENT_TOKEN="$2"; shift 2 ;;
      --node-id)      NODE_ID="$2"; shift 2 ;;
      --control-addr) CONTROL_ADDR="$2"; shift 2 ;;
      *) echo "✗ Unknown flag: $1" >&2; exit 1 ;;
    esac
  done
}

parse_flags "$@"

if [[ ! -d "$AGENT_DIR" ]]; then
  echo "✗ No agent install found at ${AGENT_DIR}." >&2
  exit 1
fi

cd "$AGENT_DIR"

if [[ -f "$AGENT_ENV" ]]; then
  cp "$AGENT_ENV" "/tmp/vivox-agent-env-backup-$(date +%s)"
fi

config_changed=false
if [[ -n "$PANEL_URL" || -n "$AGENT_TOKEN" || -n "$NODE_ID" || -n "$CONTROL_ADDR" ]]; then
  if apply_agent_config_overrides "$PANEL_URL" "$AGENT_TOKEN" "$NODE_ID" "$CONTROL_ADDR"; then
    config_changed=true
    echo "✓ Agent credentials updated in ${AGENT_ENV}"
  fi
fi

git fetch origin "$VIVOX_BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$VIVOX_BRANCH")

if [[ "$LOCAL" == "$REMOTE" ]]; then
  if [[ "$config_changed" == true ]]; then
    systemctl restart vivox-agent
    echo "✓ Agent restarted with new credentials"
  else
    echo "Already up to date."
  fi
  exit 0
fi

git pull origin "$VIVOX_BRANCH"

LATEST=$(ls -t /tmp/vivox-agent-env-backup-* 2>/dev/null | head -1)
if [[ "$config_changed" != true && -n "$LATEST" ]]; then
  cp "$LATEST" "$AGENT_ENV"
fi

CGO_ENABLED=0 go build -o /usr/local/bin/vivox-agent ./apps/agent/cmd/agent

systemctl restart vivox-agent

echo "✓ Agent updated to $(git rev-parse --short HEAD)"
