#!/usr/bin/env bash
# Vivox — first-run production setup
#
# Run with: bash infra/prod/setup.sh
# Or first: chmod +x infra/prod/setup.sh && ./infra/prod/setup.sh
#
# Idempotent: safe to re-run. Existing secrets in infra/prod/.env are preserved.

set -euo pipefail

cd "$(dirname "$0")/../.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ENV_FILE="infra/prod/.env"
COMPOSE=(docker compose -f infra/prod/docker-compose.yml --env-file "$ENV_FILE")

err()  { echo -e "${RED}✗${NC} $*" >&2; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
prompt() { echo -en "${YELLOW}?${NC} $*"; }

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------
check_dep() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Required command not found: $1"
    exit 1
  fi
}

check_dep docker
check_dep curl
check_dep openssl
if ! docker compose version >/dev/null 2>&1; then
  err "Required command not found: docker compose (Docker Compose v2 plugin)"
  exit 1
fi

# ---------------------------------------------------------------------------
# .env helpers
# ---------------------------------------------------------------------------
set_env_var() {
  local key="$1"
  local value="$2"
  local file="$ENV_FILE"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    local current
    current=$(grep "^${key}=" "$file" | cut -d= -f2-)
    if [[ -z "$current" || "$current" == replace_with_* ]]; then
      sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    fi
  else
    echo "${key}=${value}" >>"$file"
  fi
}

set_env_var_force() {
  local key="$1"
  local value="$2"
  local file="$ENV_FILE"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >>"$file"
  fi
}

get_env_var() {
  local key="$1"
  if [[ -f "$ENV_FILE" ]] && grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    grep "^${key}=" "$ENV_FILE" | cut -d= -f2-
  fi
}

generate_secret_if_needed() {
  local key="$1"
  local current
  current=$(get_env_var "$key" || true)
  if [[ -z "$current" || "$current" == replace_with_* ]]; then
    openssl rand -hex 32
  else
    echo "$current"
  fi
}

escape_json() {
  local input="$1"
  local output=""
  local i c
  for ((i = 0; i < ${#input}; i++)); do
    c=${input:i:1}
    case "$c" in
      '"') output+='\"' ;;
      '\\') output+='\\\\' ;;
      $'\n') output+='\n' ;;
      $'\r') output+='\r' ;;
      $'\t') output+='\t' ;;
      *) output+="$c" ;;
    esac
  done
  printf '%s' "$output"
}

sql_escape() {
  printf "%s" "${1//\'/''}"
}

# ---------------------------------------------------------------------------
# 1. Collect configuration
# ---------------------------------------------------------------------------
echo ""
echo "Vivox production setup"
echo "======================"
echo ""

prompt "Panel domain (hostname only, e.g. panel.example.com): "
read -r DOMAIN
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN%%/*}"
DOMAIN=$(echo "$DOMAIN" | tr -d '[:space:]')

if [[ -z "$DOMAIN" ]]; then
  err "Domain is required."
  exit 1
fi

prompt "Admin display name: "
read -r ADMIN_NAME
if [[ -z "$ADMIN_NAME" ]]; then
  err "Admin name is required."
  exit 1
fi

prompt "Admin email: "
read -r ADMIN_EMAIL
ADMIN_EMAIL=$(echo "$ADMIN_EMAIL" | tr -d '[:space:]')
if [[ -z "$ADMIN_EMAIL" ]]; then
  err "Admin email is required."
  exit 1
fi

prompt "Admin password: "
read -rs ADMIN_PASSWORD
echo ""
if [[ -z "$ADMIN_PASSWORD" ]]; then
  err "Admin password is required."
  exit 1
fi

# ---------------------------------------------------------------------------
# 2–3. Prepare .env
# ---------------------------------------------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f infra/prod/.env.example ]]; then
    cp infra/prod/.env.example "$ENV_FILE"
  else
    touch "$ENV_FILE"
  fi
fi

BETTER_AUTH_SECRET=$(generate_secret_if_needed BETTER_AUTH_SECRET)
POSTGRES_PASSWORD=$(generate_secret_if_needed POSTGRES_PASSWORD)
REDIS_PASSWORD=$(generate_secret_if_needed REDIS_PASSWORD)

set_env_var_force DOMAIN "$DOMAIN"
set_env_var BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"
set_env_var POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
set_env_var REDIS_PASSWORD "$REDIS_PASSWORD"

# Ensure optional keys exist with defaults from .env.example
if ! grep -q "^GRPC_TLS_DISABLED=" "$ENV_FILE" 2>/dev/null; then
  echo "GRPC_TLS_DISABLED=false" >>"$ENV_FILE"
fi
if ! grep -q "^NODE_PUBLIC_HOST=" "$ENV_FILE" 2>/dev/null; then
  echo "NODE_PUBLIC_HOST=" >>"$ENV_FILE"
fi
if ! grep -q "^CADDY_ADMIN_URL=" "$ENV_FILE" 2>/dev/null; then
  echo "CADDY_ADMIN_URL=" >>"$ENV_FILE"
fi

ok "Wrote $ENV_FILE"

# ---------------------------------------------------------------------------
# 4. Build and start
# ---------------------------------------------------------------------------
echo ""
echo "Building and starting Vivox stack..."
"${COMPOSE[@]}" up -d --build

# ---------------------------------------------------------------------------
# 5. Wait for readiness
# ---------------------------------------------------------------------------
echo -n "Waiting for Vivox to start"
ready=0
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000 >/dev/null 2>&1; then
    ready=1
    echo " ready!"
    break
  fi
  echo -n "."
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  echo ""
  err "Timed out waiting for Vivox. Check logs:"
  echo "  docker compose -f infra/prod/docker-compose.yml logs"
  exit 1
fi

# ---------------------------------------------------------------------------
# 6. Register admin user
# ---------------------------------------------------------------------------
ADMIN_EMAIL_SQL=$(sql_escape "$ADMIN_EMAIL")
USER_EXISTS=$("${COMPOSE[@]}" exec -T postgres \
  psql -U vivox -d vivox -tAc \
  "SELECT COUNT(*) FROM \"user\" WHERE email='${ADMIN_EMAIL_SQL}';" 2>/dev/null | tr -d '[:space:]' || echo "0")

if [[ "${USER_EXISTS:-0}" != "0" ]]; then
  warn "Admin email already registered — skipping sign-up."
else
  NAME_JSON=$(escape_json "$ADMIN_NAME")
  EMAIL_JSON=$(escape_json "$ADMIN_EMAIL")
  PASS_JSON=$(escape_json "$ADMIN_PASSWORD")

  SIGNUP_BODY=$(curl -s -w "\n__HTTP_CODE__:%{http_code}" \
    -X POST "http://localhost:3000/api/auth/sign-up/email" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${NAME_JSON}\",\"email\":\"${EMAIL_JSON}\",\"password\":\"${PASS_JSON}\"}") || {
    err "Sign-up request failed (curl error)."
    exit 1
  }

  SIGNUP_HTTP=$(echo "$SIGNUP_BODY" | sed -n 's/^__HTTP_CODE__://p')
  SIGNUP_RESPONSE=$(echo "$SIGNUP_BODY" | sed '/^__HTTP_CODE__:/d')

  if echo "$SIGNUP_RESPONSE" | grep -qi '"error"'; then
    if echo "$SIGNUP_RESPONSE" | grep -qiE 'already exists|already registered|duplicate|unique'; then
      warn "Sign-up returned user-already-exists — continuing."
    else
      err "Sign-up failed (HTTP ${SIGNUP_HTTP}):"
      echo "$SIGNUP_RESPONSE"
      exit 1
    fi
  elif [[ "${SIGNUP_HTTP:-000}" -ge 400 ]]; then
    if echo "$SIGNUP_RESPONSE" | grep -qiE 'already exists|already registered|duplicate|unique'; then
      warn "Sign-up returned user-already-exists — continuing."
    else
      err "Sign-up failed (HTTP ${SIGNUP_HTTP}):"
      echo "$SIGNUP_RESPONSE"
      exit 1
    fi
  else
    ok "Admin account created."
  fi
fi

# ---------------------------------------------------------------------------
# 7. Promote to admin
# ---------------------------------------------------------------------------
"${COMPOSE[@]}" exec -T postgres \
  psql -U vivox -d vivox \
  -c "UPDATE \"user\" SET role='admin' WHERE email='${ADMIN_EMAIL_SQL}';" >/dev/null

ADMIN_ROLE=$("${COMPOSE[@]}" exec -T postgres \
  psql -U vivox -d vivox -tAc \
  "SELECT role FROM \"user\" WHERE email='${ADMIN_EMAIL_SQL}';" 2>/dev/null | tr -d '[:space:]' || true)

if [[ "$ADMIN_ROLE" != "admin" ]]; then
  warn "Could not confirm admin role for ${ADMIN_EMAIL} — check the database manually."
else
  ok "Admin role granted."
fi

# ---------------------------------------------------------------------------
# 8. Success summary
# ---------------------------------------------------------------------------
echo ""
ok "Vivox is running"
echo ""
echo "Panel URL : https://${DOMAIN}"
echo "Admin     : ${ADMIN_EMAIL}"
echo ""
echo "Next steps:"
echo "  • Point ${DOMAIN} at this server's IP in Pangolin"
echo "  • Open https://${DOMAIN} and log in with the credentials above"
echo "  • Go to Nodes → Register node to add your first edge server"
echo ""
