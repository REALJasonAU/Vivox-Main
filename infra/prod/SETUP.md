# Vivox — Production Setup Guide

## One-command install (recommended)

On a fresh Linux VPS (Ubuntu/Debian), run as root:

```bash
curl -fsSL https://raw.githubusercontent.com/REALJasonAU/Vivox-Main/main/infra/scripts/install.sh | bash
```

Flags (skip the interactive mode prompt):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/REALJasonAU/Vivox-Main/main/infra/scripts/install.sh) --panel-only
bash <(curl -fsSL https://raw.githubusercontent.com/REALJasonAU/Vivox-Main/main/infra/scripts/install.sh) --panel-and-node
```

The installer clones to `/opt/vivox`, runs `infra/prod/setup.sh`, enables a **systemd timer** that auto-updates every 5 minutes, and optionally installs a local edge agent.

| Script | Purpose |
|---|---|
| `infra/scripts/install.sh` | Panel one-command installer |
| `infra/scripts/update.sh` | Pull latest code, rebuild stack (preserves `.env`) |
| `infra/scripts/uninstall.sh` | Stop containers and remove `/opt/vivox` |
| `infra/scripts/install-node.sh` | Edge node agent installer (`--panel-url`, `--token`, `--node-id`) |
| `infra/scripts/update-node.sh` | Rebuild agent binary (preserves `/etc/vivox-agent/agent.env`) |
| `infra/scripts/uninstall-node.sh` | Remove agent service and `/opt/vivox-agent` |

Update `VIVOX_REPO_URL` at the top of each script if you fork the repository.

---

## Architecture

```
Internet
   │
   ▼
Pangolin / Traefik (SSL termination)
   │  HTTPS → port 3000
   ▼
vivox-web (Next.js)
   │  internal: /api/control/* → http://api:8080/api/*
   ▼
vivox-api (Go)   ← port 9090 exposed for agents
   │
   ├── vivox-postgres
   └── vivox-redis

Edge node (separate VPS)
   └── vivox-agent → connects to YOUR_VPS_IP:9090
```

---

## Step 1 — Get the code onto your VPS

```bash
# SSH into your control plane VPS
ssh user@your-vps

# Clone the repo
git clone https://github.com/REALJasonAU/Vivox-Main.git /opt/vivox
cd /opt/vivox
```

---

## Step 2 — Run the setup script

```bash
bash infra/prod/setup.sh
```

The script will ask for your domain and admin credentials, generate all secrets, start the stack, and create your admin account automatically.

---

## Step 3 — Connect Pangolin (reverse proxy)

Pangolin runs on a **separate server** and terminates SSL. Point your panel domain at this VPS on port **3000**:

1. In the Pangolin UI, add a **Resource** (or route) targeting `http://<THIS_VPS_IP>:3000`.
2. Assign your panel domain (the same hostname you entered during setup) to that resource.
3. Ensure port **3000** is reachable from the Pangolin server (firewall / security group).

The production `docker-compose.yml` exposes `3000:3000` on the host — no local Traefik network is required.

### WebSocket (required for live console, metrics, status)

The panel uses a single multiplexed WebSocket at `/api/control/ws`. The web container runs a small **WS upgrade proxy** (`ws-proxy.mjs`) because Next.js rewrites do not forward WebSocket handshakes in standalone mode.

**Optional Pangolin header override** (recommended if you see upgrade failures): on the panel resource, add a custom request header:

| Header | Value |
|--------|--------|
| `X-Forwarded-Proto` | `https` |

Pangolin/Traefik sometimes sends `x-forwarded-proto: wss` on WebSocket upgrades; some stacks expect `https` per [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-Proto). The built-in proxy normalizes this, but the header override is a useful belt-and-suspenders fix.

After deploy, verify in browser DevTools → Network → WS: `wss://your-domain/api/control/ws` should show **101 Switching Protocols**, not immediate failure.

---

## Step 4 — Open port 9090

Agents connect to your control plane on port 9090 (gRPC). Open it in your firewall:

```bash
# UFW
ufw allow 9090/tcp

# iptables
iptables -A INPUT -p tcp --dport 9090 -j ACCEPT

# Or in your VPS provider's firewall/security group settings
```

> **If agents connect via WireGuard** (e.g. all nodes tunnel through Pangolin/Gerbil): you can skip this and set `GRPC_TLS_DISABLED=true` in `.env` — WireGuard encrypts the tunnel so mTLS is redundant.

---

## Step 5 — Register an edge node

An edge node is any VPS/server where customer services (game servers, apps, databases) will actually run. It needs Docker installed.

In the Vivox panel:
1. Go to **Nodes** → **Register node**
2. Fill in name, region, and capacity (set it to match the actual VPS specs)
3. Copy the **Agent Token** shown after registration — you only see it once

Note the **Node ID** from the URL or the node list.

---

## Step 6 — Install the agent on each edge node

The fastest path is the **⚡ Quick Install** command on the Nodes page (after registering a node). It runs `infra/scripts/install-node.sh` on the edge server.

Alternatively, build and install manually:

### Build the agent

```bash
# On your dev machine (or the edge node if Go is installed)
cd /opt/vivox
CGO_ENABLED=0 GOOS=linux go build -o vivox-agent ./apps/agent/cmd/agent
```

### Copy to edge node

```bash
scp vivox-agent user@edge-node-ip:/usr/local/bin/vivox-agent
chmod +x /usr/local/bin/vivox-agent
```

### Run with mTLS disabled (if using WireGuard / same private network)

```bash
vivox-agent \
  -addr YOUR_CONTROL_PLANE_IP:9090 \
  -agent-id YOUR_NODE_ID \
  -token YOUR_AGENT_TOKEN \
  -insecure
```

### Run with mTLS enabled (agents connecting over public internet)

The API auto-generates a CA cert in the `vivox-certs` Docker volume on first boot. Extract it:

```bash
# On the control plane VPS
docker cp vivox-api:/app/certs/ca.crt ./ca.crt
# Copy ca.crt to the edge node
scp ca.crt user@edge-node-ip:/etc/vivox/ca.crt
```

Then on the edge node:

```bash
vivox-agent \
  -addr YOUR_CONTROL_PLANE_IP:9090 \
  -agent-id YOUR_NODE_ID \
  -token YOUR_AGENT_TOKEN \
  -ca /etc/vivox/ca.crt
```

### Run as a systemd service (recommended)

```bash
cat > /etc/systemd/system/vivox-agent.service << 'EOF'
[Unit]
Description=Vivox Edge Agent
After=docker.service network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/vivox-agent \
  -addr YOUR_CONTROL_PLANE_IP:9090 \
  -agent-id YOUR_NODE_ID \
  -token YOUR_AGENT_TOKEN \
  -insecure
Restart=always
RestartSec=10
Environment=NEXUS_AGENT_INSECURE=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable vivox-agent
systemctl start vivox-agent
systemctl status vivox-agent
```

---

## Step 7 — Verify everything works

1. In the panel → **Nodes** page, the node should show **online** within ~10 seconds
2. Create a test service via **Templates** → pick any template → deploy
3. Check the service dashboard — status should go PROVISIONING → STARTING → RUNNING

---

## Updating

Auto-update runs every 5 minutes via `vivox-updater.timer`. To update manually:

```bash
bash /opt/vivox/infra/scripts/update.sh
```

The update script backs up `infra/prod/.env` before `git pull` and restores it afterward. New migrations are applied automatically on startup.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Panel returns 502 | `docker compose logs web` — is the container healthy? |
| Node stays offline | `systemctl status vivox-agent` on the edge node; check port 9090 is open |
| Login redirects to `/login` in a loop | `BETTER_AUTH_URL` must match the exact URL you're browsing (including `https://`) |
| `certificate signed by unknown authority` on agent | Copy `ca.crt` from the API container (Step 6) |
| Database error on startup | Check `POSTGRES_PASSWORD` matches in both `DATABASE_URL` and the `postgres` service env |
