#!/usr/bin/env bash
# Vivox — node one-command installer
#
# bash <(curl -fsSL .../install-node.sh) \
#   --panel-url https://panel.example.com \
#   --token TOKEN_HERE \
#   --node-id NODE_UUID_HERE \
#   [--control-addr HOST:9090]

set -euo pipefail

VIVOX_REPO_URL="https://github.com/REALJasonAU/Vivox-Main"
VIVOX_BRANCH="main"
VIVOX_INSTALL_DIR="/opt/vivox"
VIVOX_COMPOSE_FILE="infra/prod/docker-compose.yml"
VIVOX_ENV_FILE="infra/prod/.env"

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

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

err()  { echo -e "${RED}✗${NC} $*" >&2; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }

PANEL_URL=""
AGENT_TOKEN=""
NODE_ID=""
CONTROL_ADDR=""

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    err "Run as root (e.g. sudo bash install-node.sh ...)."
    exit 1
  fi
}

parse_flags() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --panel-url)    PANEL_URL="$2"; shift 2 ;;
      --token)        AGENT_TOKEN="$2"; shift 2 ;;
      --node-id)      NODE_ID="$2"; shift 2 ;;
      --control-addr) CONTROL_ADDR="$2"; shift 2 ;;
      *) err "Unknown flag: $1"; exit 1 ;;
    esac
  done

  if [[ -z "$PANEL_URL" || -z "$AGENT_TOKEN" || -z "$NODE_ID" ]]; then
    err "Missing required flags: --panel-url, --token, and --node-id are all required."
    exit 1
  fi
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1; then
    return 0
  fi
  echo "Docker not found — installing via get.docker.com..."
  curl -fsSL https://get.docker.com | sh
  if ! command -v docker >/dev/null 2>&1; then
    err "Missing: docker. Install it and re-run."
    exit 1
  fi
}

check_dependencies() {
  if ! command -v curl >/dev/null 2>&1; then
    err "Missing: curl. Install it and re-run."
    exit 1
  fi
  if ! command -v git >/dev/null 2>&1; then
    err "Missing: git. Install it and re-run."
    exit 1
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    err "Missing: systemctl. Install it and re-run."
    exit 1
  fi
  ensure_docker
}

build_agent() {
  cd "$AGENT_DIR"
  ensure_go
  CGO_ENABLED=0 go build -o /usr/local/bin/vivox-agent ./apps/agent/cmd/agent
  chmod +x /usr/local/bin/vivox-agent
}

install_agent_systemd() {
  cat >/etc/systemd/system/vivox-agent.service <<'EOF'
[Unit]
Description=Vivox Edge Agent
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/vivox-agent/agent.env
ExecStart=/usr/local/bin/vivox-agent -insecure
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
}

install_agent_autoupdater() {
  cat >/etc/systemd/system/vivox-agent-updater.service <<EOF
[Unit]
Description=Vivox Agent Auto-Updater

[Service]
Type=oneshot
ExecStart=/bin/bash ${AGENT_DIR}/infra/scripts/update-node.sh
EOF

  cat >/etc/systemd/system/vivox-agent-updater.timer <<'EOF'
[Unit]
Description=Run Vivox agent updater every 5 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable --now vivox-agent-updater.timer
}

handle_existing_install() {
  echo ""
  warn "Vivox Agent is already installed."
  echo ""

  # Non-interactive (curl | bash): apply credentials immediately.
  if [[ ! -t 0 ]]; then
    ok "Applying credentials from command line..."
    update_args=(--panel-url "$PANEL_URL" --token "$AGENT_TOKEN" --node-id "$NODE_ID")
    [[ -n "$CONTROL_ADDR" ]] && update_args+=(--control-addr "$CONTROL_ADDR")
    bash "${AGENT_DIR}/infra/scripts/update-node.sh" "${update_args[@]}"
    exit 0
  fi

  echo "Options:"
  echo "  1) Update / apply new credentials"
  echo "  2) Uninstall"
  echo "  3) Exit"
  echo ""
  read -r -p "Choice [1-3]: " choice
  case "${choice:-3}" in
    1)
      update_args=(--panel-url "$PANEL_URL" --token "$AGENT_TOKEN" --node-id "$NODE_ID")
      [[ -n "$CONTROL_ADDR" ]] && update_args+=(--control-addr "$CONTROL_ADDR")
      bash "${AGENT_DIR}/infra/scripts/update-node.sh" "${update_args[@]}"
      exit 0
      ;;
    2)
      bash "${AGENT_DIR}/infra/scripts/uninstall-node.sh"
      exit 0
      ;;
    *)
      exit 0
      ;;
  esac
}

main() {
  require_root
  parse_flags "$@"

  if [[ -f "$AGENT_ENV" ]]; then
    handle_existing_install
  fi

  check_dependencies
  ensure_go

  if [[ -d "$AGENT_DIR" ]]; then
    err "Directory ${AGENT_DIR} exists but agent is not configured. Remove it or run uninstall-node.sh first."
    exit 1
  fi

  echo "Cloning Vivox agent source into ${AGENT_DIR}..."
  git clone --branch "$VIVOX_BRANCH" "$VIVOX_REPO_URL" "$AGENT_DIR"

  build_agent
  write_agent_env "$PANEL_URL" "$NODE_ID" "$AGENT_TOKEN" "$CONTROL_ADDR"
  install_agent_systemd
  install_agent_autoupdater

  systemctl daemon-reload
  systemctl enable --now vivox-agent
  sleep 3
  if systemctl is-active --quiet vivox-agent; then
    ok "Agent running"
  else
    err "Agent failed to start — check: journalctl -u vivox-agent"
    exit 1
  fi

  echo ""
  ok "Vivox Agent installed!"
  echo ""
  echo "Panel URL  : ${PANEL_URL}"
  echo "Node ID    : ${NODE_ID}"
  echo "Auto-update: every 5 minutes (vivox-agent-updater.timer)"
  echo ""
  echo "Useful commands:"
  echo "  Status    : systemctl status vivox-agent"
  echo "  Logs      : journalctl -u vivox-agent -f"
  echo "  Update now: bash ${AGENT_DIR}/infra/scripts/update-node.sh --panel-url URL --token TOKEN --node-id UUID [--control-addr HOST:9090]"
  echo "  Uninstall : bash ${AGENT_DIR}/infra/scripts/uninstall-node.sh"
  echo ""
}

main "$@"
