# Shared helpers for Vivox edge agent install/update scripts.
# Source from install-node.sh / update-node.sh — do not execute directly.

AGENT_ENV="${AGENT_ENV:-/etc/vivox-agent/agent.env}"

# Derive gRPC address from panel URL unless CONTROL_ADDR is set.
panel_to_control_addr() {
  local panel_url="$1"
  local grpc_host="${panel_url#https://}"
  grpc_host="${grpc_host#http://}"
  grpc_host="${grpc_host%%/*}"
  echo "${grpc_host}:9090"
}

# Load KEY=VALUE pairs from agent.env into the shell (safe for our generated file).
load_agent_env() {
  PANEL_URL=""
  AGENT_TOKEN=""
  NODE_ID=""
  CONTROL_ADDR=""
  if [[ -f "$AGENT_ENV" ]]; then
    # shellcheck disable=SC1090
    set -a
    source "$AGENT_ENV"
    set +a
    PANEL_URL="${VIVOX_PANEL_URL:-}"
    AGENT_TOKEN="${NEXUS_AGENT_TOKEN:-}"
    NODE_ID="${NEXUS_AGENT_ID:-}"
    CONTROL_ADDR="${NEXUS_CONTROL_ADDR:-}"
  fi
}

# Write /etc/vivox-agent/agent.env. Requires PANEL_URL, NODE_ID, AGENT_TOKEN set.
write_agent_env() {
  local panel_url="$1"
  local node_id="$2"
  local token="$3"
  local control_addr="${4:-}"

  if [[ -z "$panel_url" || -z "$node_id" || -z "$token" ]]; then
    echo "✗ Missing panel URL, node ID, or agent token for agent.env" >&2
    return 1
  fi

  if [[ -z "$control_addr" ]]; then
    control_addr="$(panel_to_control_addr "$panel_url")"
  fi

  mkdir -p "$(dirname "$AGENT_ENV")"
  cat >"$AGENT_ENV" <<EOF
NEXUS_CONTROL_ADDR=${control_addr}
NEXUS_AGENT_ID=${node_id}
NEXUS_AGENT_TOKEN=${token}
NEXUS_AGENT_INSECURE=true
NEXUS_AGENT_HEALTH_ADDR=:8082
VIVOX_PANEL_URL=${panel_url}
VIVOX_REPO_URL=${VIVOX_REPO_URL:-https://github.com/REALJasonAU/Vivox-Main}
VIVOX_BRANCH=${VIVOX_BRANCH:-main}
EOF
  chmod 600 "$AGENT_ENV"
}

# Merge CLI overrides into existing agent.env; returns 0 if anything changed.
apply_agent_config_overrides() {
  local new_panel="${1:-}"
  local new_token="${2:-}"
  local new_node_id="${3:-}"
  local new_control="${4:-}"

  load_agent_env

  local old_panel="$PANEL_URL"
  local old_token="$AGENT_TOKEN"
  local old_node="$NODE_ID"
  local old_control="$CONTROL_ADDR"

  [[ -n "$new_panel" ]] && PANEL_URL="$new_panel"
  [[ -n "$new_token" ]] && AGENT_TOKEN="$new_token"
  [[ -n "$new_node_id" ]] && NODE_ID="$new_node_id"
  [[ -n "$new_control" ]] && CONTROL_ADDR="$new_control"

  if [[ -z "$PANEL_URL" || -z "$NODE_ID" || -z "$AGENT_TOKEN" ]]; then
    echo "✗ Cannot update credentials — provide --panel-url, --token, and --node-id (or keep existing agent.env)." >&2
    return 1
  fi

  if [[ "$PANEL_URL" == "$old_panel" && "$AGENT_TOKEN" == "$old_token" && "$NODE_ID" == "$old_node" && "$CONTROL_ADDR" == "$old_control" ]]; then
    return 1
  fi

  write_agent_env "$PANEL_URL" "$NODE_ID" "$AGENT_TOKEN" "$CONTROL_ADDR"
  return 0
}

# Apply CLI credential flags even when values match (used after git pull).
apply_credentials_from_cli() {
  local new_panel="${1:-}"
  local new_token="${2:-}"
  local new_node_id="${3:-}"
  local new_control="${4:-}"

  if [[ -z "$new_panel" && -z "$new_token" && -z "$new_node_id" && -z "$new_control" ]]; then
    return 1
  fi

  load_agent_env
  [[ -n "$new_panel" ]] && PANEL_URL="$new_panel"
  [[ -n "$new_token" ]] && AGENT_TOKEN="$new_token"
  [[ -n "$new_node_id" ]] && NODE_ID="$new_node_id"
  [[ -n "$new_control" ]] && CONTROL_ADDR="$new_control"

  if [[ -z "$PANEL_URL" || -z "$NODE_ID" || -z "$AGENT_TOKEN" ]]; then
    echo "✗ Cannot update credentials — provide --panel-url, --token, and --node-id." >&2
    return 1
  fi

  write_agent_env "$PANEL_URL" "$NODE_ID" "$AGENT_TOKEN" "$CONTROL_ADDR"
  return 0
}
