#!/usr/bin/env bash
# Vivox — panel one-command installer
#
# curl -fsSL https://raw.githubusercontent.com/REALJasonAU/Vivox-Main/main/infra/scripts/install.sh | bash
# bash <(curl -fsSL .../install.sh) --panel-only
# bash <(curl -fsSL .../install.sh) --panel-and-node

set -euo pipefail

VIVOX_REPO_URL="https://github.com/REALJasonAU/Vivox-Main"
VIVOX_BRANCH="main"
VIVOX_INSTALL_DIR="/opt/vivox"
VIVOX_COMPOSE_FILE="infra/prod/docker-compose.yml"
VIVOX_ENV_FILE="infra/prod/.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

err()  { echo -e "${RED}✗${NC} $*" >&2; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    err "Run as root (e.g. sudo bash install.sh)."
    exit 1
  fi
}

check_dep() {
  local tool="$1"
  if ! command -v "$tool" >/dev/null 2>&1; then
    err "Missing: ${tool}. Install it and re-run."
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
  check_dep curl
  check_dep git
  check_dep openssl
  check_dep systemctl
  ensure_docker
  if ! docker compose version >/dev/null 2>&1; then
    err "Missing: docker compose (Docker Compose v2 plugin). Install it and re-run."
    exit 1
  fi
}

get_env_var() {
  local key="$1"
  local file="$VIVOX_INSTALL_DIR/$VIVOX_ENV_FILE"
  if [[ -f "$file" ]] && grep -q "^${key}=" "$file" 2>/dev/null; then
    grep "^${key}=" "$file" | cut -d= -f2-
  fi
}

install_panel_autoupdater() {
  cat >/etc/systemd/system/vivox-updater.service <<EOF
[Unit]
Description=Vivox Panel Auto-Updater
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash ${VIVOX_INSTALL_DIR}/infra/scripts/update.sh
StandardOutput=journal
StandardError=journal
EOF

  cat >/etc/systemd/system/vivox-updater.timer <<'EOF'
[Unit]
Description=Run Vivox panel updater every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable --now vivox-updater.timer
  ok "Auto-updater enabled (vivox-updater.timer)"
}

sql_escape() {
  printf "%s" "${1//\'/''}"
}

install_local_node() {
  local domain panel_url agent_token token_hash node_name node_id capacity
  local compose=(docker compose -f "$VIVOX_INSTALL_DIR/$VIVOX_COMPOSE_FILE" --env-file "$VIVOX_INSTALL_DIR/$VIVOX_ENV_FILE")

  domain=$(get_env_var DOMAIN)
  if [[ -z "$domain" ]]; then
    domain="localhost"
  fi
  panel_url="https://${domain}"

  node_name=$(hostname -s 2>/dev/null || hostname)
  node_name=$(sql_escape "$node_name")

  local cpu_cores ram_mb disk_gb
  cpu_cores=$(nproc 2>/dev/null || echo 4)
  if [[ -r /proc/meminfo ]]; then
    ram_mb=$(($(grep -E '^MemTotal:' /proc/meminfo | awk '{print $2}') / 1024))
  else
    ram_mb=8192
  fi
  if df -BG / >/dev/null 2>&1; then
    disk_gb=$(df -BG / | awk 'NR==2 {gsub(/G/,"",$4); print $4}')
  else
    disk_gb=100
  fi
  capacity="{\"cpu_cores\":${cpu_cores},\"ram_mb\":${ram_mb},\"disk_gb\":${disk_gb}}"

  agent_token=$(openssl rand -hex 32)
  token_hash=$(printf '%s' "$agent_token" | openssl dgst -sha256 | awk '{print $2}')

  echo "Registering local node \"${node_name}\"..."
  node_id=$("${compose[@]}" exec -T postgres \
    psql -U vivox -d vivox -tAc \
    "INSERT INTO nodes (name, region, agent_token_hash, status, capacity)
     VALUES ('${node_name}', 'local', '${token_hash}', 'offline', '${capacity}'::jsonb)
     RETURNING id;" | tr -d '[:space:]')

  if [[ -z "$node_id" ]]; then
    err "Failed to register local node in the database."
    exit 1
  fi
  ok "Local node registered (${node_id})"

  bash "$VIVOX_INSTALL_DIR/infra/scripts/install-node.sh" \
    --panel-url "$panel_url" \
    --token "$agent_token" \
    --node-id "$node_id" \
    --control-addr "127.0.0.1:9090"
}

handle_existing_install() {
  echo ""
  warn "Vivox is already installed at ${VIVOX_INSTALL_DIR}."
  echo ""
  echo "Options:"
  echo "  1) Update to latest version"
  echo "  2) Uninstall"
  echo "  3) Exit"
  echo ""
  read -r -p "Choice [1-3]: " choice
  case "${choice:-3}" in
    1)
      bash "$VIVOX_INSTALL_DIR/infra/scripts/update.sh"
      exit 0
      ;;
    2)
      bash "$VIVOX_INSTALL_DIR/infra/scripts/uninstall.sh"
      exit 0
      ;;
    *)
      exit 0
      ;;
  esac
}

parse_args() {
  INSTALL_MODE=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --panel-only)
        INSTALL_MODE="panel"
        shift
        ;;
      --panel-and-node)
        INSTALL_MODE="panel_and_node"
        shift
        ;;
      -h | --help)
        echo "Usage: install.sh [--panel-only | --panel-and-node]"
        exit 0
        ;;
      *)
        err "Unknown argument: $1"
        exit 1
        ;;
    esac
  done
}

prompt_install_mode() {
  if [[ -n "$INSTALL_MODE" ]]; then
    return 0
  fi
  echo ""
  echo "What would you like to install?"
  echo "  1) Panel only         (control plane + web UI)"
  echo "  2) Panel + Node       (also installs agent on this machine)"
  echo ""
  read -r -p "Choice [1-2]: " choice
  case "${choice:-1}" in
    2) INSTALL_MODE="panel_and_node" ;;
    *) INSTALL_MODE="panel" ;;
  esac
}

main() {
  require_root
  parse_args "$@"
  check_dependencies

  if [[ -d "$VIVOX_INSTALL_DIR" && -f "$VIVOX_INSTALL_DIR/$VIVOX_ENV_FILE" ]]; then
    handle_existing_install
  fi

  prompt_install_mode

  if [[ -d "$VIVOX_INSTALL_DIR" ]]; then
    err "Directory ${VIVOX_INSTALL_DIR} exists but is not a Vivox install (missing ${VIVOX_ENV_FILE})."
    exit 1
  fi

  echo ""
  echo "Cloning Vivox into ${VIVOX_INSTALL_DIR}..."
  git clone --branch "$VIVOX_BRANCH" "$VIVOX_REPO_URL" "$VIVOX_INSTALL_DIR"
  cd "$VIVOX_INSTALL_DIR"

  bash infra/prod/setup.sh

  install_panel_autoupdater

  if [[ "$INSTALL_MODE" == "panel_and_node" ]]; then
    install_local_node
  fi

  domain=$(get_env_var DOMAIN)
  domain="${domain:-localhost}"

  echo ""
  ok "Vivox installed successfully!"
  echo ""
  echo "Panel URL : https://${domain}"
  echo "Install   : ${VIVOX_INSTALL_DIR}"
  echo "Auto-update: every 5 minutes (vivox-updater.timer)"
  echo ""
  echo "Useful commands:"
  echo "  Update now : bash ${VIVOX_INSTALL_DIR}/infra/scripts/update.sh"
  echo "  View logs  : docker compose -f ${VIVOX_INSTALL_DIR}/${VIVOX_COMPOSE_FILE} logs -f"
  echo "  Uninstall  : bash ${VIVOX_INSTALL_DIR}/infra/scripts/uninstall.sh"
  echo ""
}

main "$@"
