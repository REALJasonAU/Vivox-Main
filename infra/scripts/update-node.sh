#!/usr/bin/env bash
# Vivox — node agent update (rebuild binary; optionally refresh credentials)
#
# bash update-node.sh
# bash update-node.sh --token NEW_TOKEN --panel-url https://panel.example.com --node-id UUID [--control-addr HOST:9090]

set -euo pipefail

VIVOX_REPO_URL="https://github.com/REALJasonAU/Vivox-Main"
VIVOX_BRANCH="main"

AGENT_DIR="/opt/vivox-agent"
AGENT_ENV="/etc/vivox-agent/agent.env"

_vivox_bootstrap_script_dir() {
  local script_path="${1:?}"
  local dir=""
  if dir="$(cd "$(dirname "$script_path")" 2>/dev/null && pwd)"; then
    if [[ "$dir" != /dev/fd/* && "$dir" != /proc/*/fd/* && -f "${dir}/node-agent-lib.sh" ]]; then
      echo "$dir"
      return 0
    fi
  fi
  dir="/tmp/vivox-agent-scripts-$$"
  mkdir -p "$dir"
  curl -fsSL "${VIVOX_REPO_URL}/raw/${VIVOX_BRANCH}/infra/scripts/node-agent-lib.sh" -o "${dir}/node-agent-lib.sh"
  echo "$dir"
}

SCRIPT_DIR="$(_vivox_bootstrap_script_dir "${BASH_SOURCE[0]}")"
# shellcheck source=node-agent-lib.sh
source "${SCRIPT_DIR}/node-agent-lib.sh"

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

require_root

if [[ ! -d "$AGENT_DIR" ]]; then
  echo "✗ No agent install found at ${AGENT_DIR}." >&2
  exit 1
fi

cd "$AGENT_DIR"

CREDENTIALS_CLI=false
if [[ -n "$PANEL_URL" || -n "$AGENT_TOKEN" || -n "$NODE_ID" || -n "$CONTROL_ADDR" ]]; then
  CREDENTIALS_CLI=true
fi

config_changed=false
if [[ "$CREDENTIALS_CLI" == true ]]; then
  if apply_agent_config_overrides "$PANEL_URL" "$AGENT_TOKEN" "$NODE_ID" "$CONTROL_ADDR"; then
    config_changed=true
    echo "✓ Agent credentials updated in ${AGENT_ENV}"
  fi
fi

env_backup=""
if [[ -f "$AGENT_ENV" && "$CREDENTIALS_CLI" != true ]]; then
  env_backup="/tmp/vivox-agent-env-backup-$(date +%s)"
  cp "$AGENT_ENV" "$env_backup"
fi

git fetch origin "$VIVOX_BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$VIVOX_BRANCH")

code_updated=false
if [[ "$LOCAL" != "$REMOTE" ]]; then
  git pull origin "$VIVOX_BRANCH"
  code_updated=true
fi

if [[ -n "$env_backup" && -f "$env_backup" ]]; then
  cp "$env_backup" "$AGENT_ENV"
  chmod 600 "$AGENT_ENV"
fi

# Re-apply CLI overrides after git pull so flags always win over restored backup.
if [[ "$CREDENTIALS_CLI" == true ]]; then
  if apply_agent_config_overrides "$PANEL_URL" "$AGENT_TOKEN" "$NODE_ID" "$CONTROL_ADDR"; then
    config_changed=true
    echo "✓ Agent credentials applied"
  fi
fi

if [[ "$code_updated" != true && "$config_changed" != true ]]; then
  echo "Already up to date."
  exit 0
fi

if [[ "$code_updated" == true ]]; then
  ensure_go
  CGO_ENABLED=0 go build -o /usr/local/bin/vivox-agent ./apps/agent/cmd/agent
  chmod +x /usr/local/bin/vivox-agent
  echo "✓ Agent updated to $(git rev-parse --short HEAD)"
fi

if [[ "$config_changed" == true || "$code_updated" == true ]]; then
  systemctl restart vivox-agent
  if [[ "$config_changed" == true ]]; then
    echo "✓ Agent restarted with new credentials"
  elif [[ "$code_updated" == true ]]; then
    echo "✓ Agent restarted"
  fi
fi
