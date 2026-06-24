#!/usr/bin/env bash
# Vivox — node one-command installer
#
# bash <(curl -fsSL .../install-node.sh) \
#   --panel-url https://panel.example.com \
#   --token TOKEN_HERE \
#   --node-id NODE_UUID_HERE

set -euo pipefail

VIVOX_REPO_URL="https://github.com/your-org/vivox"
VIVOX_BRANCH="main"
VIVOX_INSTALL_DIR="/opt/vivox"
VIVOX_COMPOSE_FILE="infra/prod/docker-compose.yml"
VIVOX_ENV_FILE="infra/prod/.env"

AGENT_DIR="/opt/vivox-agent"
AGENT_ENV="/etc/vivox-agent/agent.env"

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

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    err "Run as root (e.g. sudo bash install-node.sh ...)."
    exit 1
  fi
}

parse_flags() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --panel-url) PANEL_URL="$2"; shift 2 ;;
      --token)     AGENT_TOKEN="$2"; shift 2 ;;
      --node-id)   NODE_ID="$2"; shift 2 ;;
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

ensure_go() {
  if command -v go >/dev/null 2>&1; then
    return 0
  fi
  echo "Go not found — installing Go 1.25.0..."
  curl -fsSL https://go.dev/dl/go1.25.0.linux-amd64.tar.gz -o /tmp/go.tar.gz
  tar -C /usr/local -xzf /tmp/go.tar.gz
  rm -f /tmp/go.tar.gz
  echo 'export PATH=$PATH:/usr/local/go/bin' >/etc/profile.d/go.sh
  export PATH=$PATH:/usr/local/go/bin
}

build_agent() {
  cd "$AGENT_DIR"
  export PATH=$PATH:/usr/local/go/bin
  CGO_ENABLED=0 go build -o /usr/local/bin/vivox-agent ./apps/agent/cmd/agent
  chmod +x /usr/local/bin/vivox-agent
}

write_agent_env() {
  local grpc_host="${PANEL_URL#https://}"
  grpc_host="${grpc_host#http://}"
  grpc_host="${grpc_host%%/*}"
  local nexus_control_addr="${grpc_host}:9090"

  mkdir -p /etc/vivox-agent
  cat >"$AGENT_ENV" <<EOF
NEXUS_CONTROL_ADDR=${nexus_control_addr}
NEXUS_AGENT_ID=${NODE_ID}
NEXUS_AGENT_TOKEN=${AGENT_TOKEN}
NEXUS_AGENT_INSECURE=true
NEXUS_AGENT_HEALTH_ADDR=:8082
VIVOX_PANEL_URL=${PANEL_URL}
VIVOX_REPO_URL=${VIVOX_REPO_URL}
VIVOX_BRANCH=${VIVOX_BRANCH}
EOF
  chmod 600 "$AGENT_ENV"
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
  echo "Options:"
  echo "  1) Update to latest version"
  echo "  2) Uninstall"
  echo "  3) Exit"
  echo ""
  read -r -p "Choice [1-3]: " choice
  case "${choice:-3}" in
    1)
      bash "${AGENT_DIR}/infra/scripts/update-node.sh"
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
  write_agent_env
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
  echo "  Update now: bash ${AGENT_DIR}/infra/scripts/update-node.sh"
  echo "  Uninstall : bash ${AGENT_DIR}/infra/scripts/uninstall-node.sh"
  echo ""
}

main "$@"
