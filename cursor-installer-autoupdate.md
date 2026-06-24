# Vivox — One-Command Installer, Auto-Update, and Node Install Command

Create a full suite of install/update/uninstall scripts and wire auto-update into the panel and nodes. Every script must be pure bash + standard Unix tools (curl, git, docker, openssl, systemctl). No Python, no Node, no extra runtimes.

---

## Configuration constants (top of every script)

Every script must start with these constants so there is one place to update them:

```bash
VIVOX_REPO_URL="https://github.com/OWNER/REPO"   # ← fill in actual GitHub URL
VIVOX_BRANCH="main"
VIVOX_INSTALL_DIR="/opt/vivox"
VIVOX_COMPOSE_FILE="infra/prod/docker-compose.yml"
VIVOX_ENV_FILE="infra/prod/.env"
```

---

## Files to create

### 1. `infra/scripts/install.sh` — Panel one-command installer

**Invocation:**
```bash
# Interactive (asks what to install):
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/infra/scripts/install.sh | bash

# Or with a flag to skip the mode question:
bash <(curl -fsSL .../install.sh) --panel-only
bash <(curl -fsSL .../install.sh) --panel-and-node
```

**Full behaviour, in exact order:**

1. **Strict mode**: `set -euo pipefail`

2. **Dependency check**: Verify `curl`, `git`, `openssl`, `docker`, `systemctl` exist. If `docker` is missing, install it with `curl -fsSL https://get.docker.com | sh` and then re-verify. If any other dependency is missing, print a friendly error (`✗ Missing: <tool>. Install it and re-run.`) and exit 1.

3. **Detect existing installation**: Check if `$VIVOX_INSTALL_DIR` exists AND `$VIVOX_INSTALL_DIR/$VIVOX_ENV_FILE` exists. If so:
   ```
   ⚠ Vivox is already installed at /opt/vivox.
   
   Options:
     1) Update to latest version
     2) Uninstall
     3) Exit
   ```
   Read the user's choice. Option 1 runs `bash infra/scripts/update.sh` from the install dir and exits. Option 2 runs `bash infra/scripts/uninstall.sh` and exits. Option 3 exits.

4. **Ask what to install** (only if no `--panel-only` / `--panel-and-node` flag):
   ```
   What would you like to install?
     1) Panel only         (control plane + web UI)
     2) Panel + Node       (also installs agent on this machine)
   ```
   Read choice. Store in `INSTALL_MODE=panel` or `INSTALL_MODE=panel_and_node`.

5. **Clone the repo** into `$VIVOX_INSTALL_DIR`:
   ```bash
   git clone --branch "$VIVOX_BRANCH" "$VIVOX_REPO_URL" "$VIVOX_INSTALL_DIR"
   cd "$VIVOX_INSTALL_DIR"
   ```

6. **Run the interactive setup script** to collect domain + admin credentials and write `.env`:
   ```bash
   bash infra/prod/setup.sh
   ```
   (This is the script from the previous Cursor prompt. It handles domain, secrets, admin user creation, and brings the stack up.)

7. **Install the auto-updater** (see section 4 below — `install_panel_autoupdater` function).

8. **If mode is `panel_and_node`**: After the stack is up, automatically register a local node and install the agent on this machine (see section 5 below — `install_local_node` function).

9. **Print success summary**:
   ```
   ✓ Vivox installed successfully!
   
   Panel URL : https://<DOMAIN>
   Install   : /opt/vivox
   Auto-update: every 5 minutes (vivox-updater.timer)
   
   Useful commands:
     Update now : bash /opt/vivox/infra/scripts/update.sh
     View logs  : docker compose -f /opt/vivox/infra/prod/docker-compose.yml logs -f
     Uninstall  : bash /opt/vivox/infra/scripts/uninstall.sh
   ```

---

### 2. `infra/scripts/update.sh` — Panel update script

**Invocation:** `bash infra/scripts/update.sh` (run from anywhere; it `cd`s to install dir)

**Behaviour:**

1. `cd "$VIVOX_INSTALL_DIR"` at the top.

2. **Back up `.env`** before doing anything:
   ```bash
   cp "$VIVOX_ENV_FILE" /tmp/vivox-env-backup-$(date +%s)
   ```

3. **Pull latest code**:
   ```bash
   git fetch origin "$VIVOX_BRANCH"
   LOCAL=$(git rev-parse HEAD)
   REMOTE=$(git rev-parse "origin/$VIVOX_BRANCH")
   if [[ "$LOCAL" == "$REMOTE" ]]; then
     echo "Already up to date. Nothing to do."
     exit 0
   fi
   git pull origin "$VIVOX_BRANCH"
   ```

4. **Restore `.env`** — git pull must never clobber it. After the pull, copy the backup back:
   ```bash
   # Restore env — git pull must never lose secrets
   LATEST_BACKUP=$(ls -t /tmp/vivox-env-backup-* 2>/dev/null | head -1)
   [[ -n "$LATEST_BACKUP" ]] && cp "$LATEST_BACKUP" "$VIVOX_ENV_FILE"
   ```

5. **Rebuild and restart**:
   ```bash
   docker compose -f "$VIVOX_COMPOSE_FILE" --env-file "$VIVOX_ENV_FILE" \
     up -d --build --remove-orphans
   ```

6. **Print the new version** (git short SHA + timestamp):
   ```bash
   echo "✓ Updated to $(git rev-parse --short HEAD) at $(date)"
   ```

---

### 3. `infra/scripts/uninstall.sh` — Panel uninstall

**Behaviour:**

1. Warn the user:
   ```
   ⚠ This will stop all Vivox containers and remove the installation.
   Your .env secrets will be shown so you can save them first.
   
   Current .env:
   <contents of infra/prod/.env>
   
   Type "yes" to confirm:
   ```
   Read input. Exit if not "yes".

2. Ask separately: `Remove all data volumes (postgres, redis)? [y/N]`. Store answer.

3. Stop containers:
   ```bash
   cd "$VIVOX_INSTALL_DIR"
   docker compose -f "$VIVOX_COMPOSE_FILE" --env-file "$VIVOX_ENV_FILE" down
   ```

4. If removing volumes: add `--volumes` to the down command.

5. Disable and remove auto-updater:
   ```bash
   systemctl stop vivox-updater.timer vivox-updater.service 2>/dev/null || true
   systemctl disable vivox-updater.timer 2>/dev/null || true
   rm -f /etc/systemd/system/vivox-updater.{service,timer}
   systemctl daemon-reload
   ```

6. Remove install directory:
   ```bash
   rm -rf "$VIVOX_INSTALL_DIR"
   ```

7. Print: `✓ Vivox uninstalled.`

---

### 4. Auto-updater: Systemd timer (panel machine)

**Function `install_panel_autoupdater`** — called from `install.sh`:

Create two systemd unit files and enable the timer.

**`/etc/systemd/system/vivox-updater.service`:**
```ini
[Unit]
Description=Vivox Panel Auto-Updater
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash /opt/vivox/infra/scripts/update.sh
StandardOutput=journal
StandardError=journal
```

**`/etc/systemd/system/vivox-updater.timer`:**
```ini
[Unit]
Description=Run Vivox panel updater every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
```

Then:
```bash
systemctl daemon-reload
systemctl enable --now vivox-updater.timer
```

---

### 5. `infra/scripts/install-node.sh` — Node-only one-command installer

**Invocation** (this is the command shown on the Nodes page — see section 7):
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/infra/scripts/install-node.sh) \
  --panel-url https://panel.example.com \
  --token TOKEN_HERE \
  --node-id NODE_UUID_HERE
```

**Behaviour:**

1. **Parse flags** at the top using a while loop:
   ```bash
   PANEL_URL=""
   AGENT_TOKEN=""
   NODE_ID=""
   while [[ $# -gt 0 ]]; do
     case "$1" in
       --panel-url) PANEL_URL="$2"; shift 2 ;;
       --token)     AGENT_TOKEN="$2"; shift 2 ;;
       --node-id)   NODE_ID="$2"; shift 2 ;;
       *) echo "Unknown flag: $1"; exit 1 ;;
     esac
   done
   ```
   Validate all three are non-empty; exit 1 with a clear message if any are missing.

2. **Detect existing installation**: Check if `/etc/vivox-agent/agent.env` exists. If so:
   ```
   ⚠ Vivox Agent is already installed.
   
   Options:
     1) Update to latest version
     2) Uninstall
     3) Exit
   ```
   Handle the same as the panel installer.

3. **Install dependencies**: Docker (same `get.docker.com` method), `git`.

4. **Install Go** if not present (needed to build the agent):
   ```bash
   if ! command -v go &>/dev/null; then
     curl -fsSL https://go.dev/dl/go1.25.0.linux-amd64.tar.gz -o /tmp/go.tar.gz
     tar -C /usr/local -xzf /tmp/go.tar.gz
     echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile.d/go.sh
     export PATH=$PATH:/usr/local/go/bin
   fi
   ```

5. **Clone the repo** into `/opt/vivox-agent`:
   ```bash
   AGENT_DIR="/opt/vivox-agent"
   git clone --branch "$VIVOX_BRANCH" "$VIVOX_REPO_URL" "$AGENT_DIR"
   ```

6. **Build the agent binary**:
   ```bash
   cd "$AGENT_DIR"
   CGO_ENABLED=0 go build -o /usr/local/bin/vivox-agent ./apps/agent/cmd/agent
   chmod +x /usr/local/bin/vivox-agent
   ```

7. **Write config** to `/etc/vivox-agent/agent.env`:
   ```bash
   mkdir -p /etc/vivox-agent
   cat > /etc/vivox-agent/agent.env << EOF
   NEXUS_CONTROL_ADDR=${PANEL_URL##*/}:9090   # strip https:// and append :9090
   NEXUS_AGENT_ID=${NODE_ID}
   NEXUS_AGENT_TOKEN=${AGENT_TOKEN}
   NEXUS_AGENT_INSECURE=true
   NEXUS_AGENT_HEALTH_ADDR=:8082
   VIVOX_PANEL_URL=${PANEL_URL}
   VIVOX_REPO_URL=${VIVOX_REPO_URL}
   VIVOX_BRANCH=${VIVOX_BRANCH}
   EOF
   chmod 600 /etc/vivox-agent/agent.env
   ```
   Note: `NEXUS_CONTROL_ADDR` must be `hostname:9090`. Strip `https://` from `PANEL_URL` to get the hostname, then append `:9090`. Use: `GRPC_HOST="${PANEL_URL#https://}"; GRPC_HOST="${GRPC_HOST#http://}"; NEXUS_CONTROL_ADDR="${GRPC_HOST}:9090"`

8. **Install systemd service** for the agent:
   ```
   /etc/systemd/system/vivox-agent.service
   ```
   ```ini
   [Unit]
   Description=Vivox Edge Agent
   After=docker.service network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   EnvironmentFile=/etc/vivox-agent/agent.env
   ExecStart=/usr/local/bin/vivox-agent \
     -addr ${NEXUS_CONTROL_ADDR} \
     -agent-id ${NEXUS_AGENT_ID} \
     -token ${NEXUS_AGENT_TOKEN} \
     -insecure
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   ```

9. **Install auto-updater for the agent** (see section 6 below).

10. **Start and verify**:
    ```bash
    systemctl daemon-reload
    systemctl enable --now vivox-agent
    sleep 3
    systemctl is-active vivox-agent && echo "✓ Agent running" || echo "✗ Agent failed to start — check: journalctl -u vivox-agent"
    ```

11. **Success message**:
    ```
    ✓ Vivox Agent installed!
    
    Panel URL  : https://<PANEL_URL>
    Node ID    : <NODE_ID>
    Auto-update: every 5 minutes (vivox-agent-updater.timer)
    
    Useful commands:
      Status    : systemctl status vivox-agent
      Logs      : journalctl -u vivox-agent -f
      Update now: bash /opt/vivox-agent/infra/scripts/update-node.sh
      Uninstall : bash /opt/vivox-agent/infra/scripts/uninstall-node.sh
    ```

---

### 6. `infra/scripts/update-node.sh` — Node agent update

**Behaviour:**

1. `cd /opt/vivox-agent`

2. Back up env:
   ```bash
   cp /etc/vivox-agent/agent.env /tmp/vivox-agent-env-backup-$(date +%s)
   ```

3. Check for new commits:
   ```bash
   git fetch origin "$VIVOX_BRANCH"
   LOCAL=$(git rev-parse HEAD)
   REMOTE=$(git rev-parse "origin/$VIVOX_BRANCH")
   [[ "$LOCAL" == "$REMOTE" ]] && echo "Already up to date." && exit 0
   git pull origin "$VIVOX_BRANCH"
   ```

4. **Restore env** (same pattern as panel):
   ```bash
   LATEST=$(ls -t /tmp/vivox-agent-env-backup-* 2>/dev/null | head -1)
   [[ -n "$LATEST" ]] && cp "$LATEST" /etc/vivox-agent/agent.env
   ```

5. **Rebuild binary**:
   ```bash
   CGO_ENABLED=0 go build -o /usr/local/bin/vivox-agent ./apps/agent/cmd/agent
   ```

6. **Restart service**:
   ```bash
   systemctl restart vivox-agent
   ```

7. Print: `✓ Agent updated to $(git rev-parse --short HEAD)`

**Auto-updater systemd units** (created by `install-node.sh`):

`/etc/systemd/system/vivox-agent-updater.service`:
```ini
[Unit]
Description=Vivox Agent Auto-Updater

[Service]
Type=oneshot
ExecStart=/bin/bash /opt/vivox-agent/infra/scripts/update-node.sh
```

`/etc/systemd/system/vivox-agent-updater.timer`:
```ini
[Unit]
Description=Run Vivox agent updater every 5 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
```

---

### 7. `infra/scripts/uninstall-node.sh` — Node agent uninstall

1. Warn user, show current env, ask "yes" to confirm.
2. Stop and disable services:
   ```bash
   systemctl stop vivox-agent vivox-agent-updater.timer 2>/dev/null || true
   systemctl disable vivox-agent vivox-agent-updater.timer 2>/dev/null || true
   rm -f /etc/systemd/system/vivox-agent.service
   rm -f /etc/systemd/system/vivox-agent-updater.{service,timer}
   systemctl daemon-reload
   ```
3. Remove binary and config:
   ```bash
   rm -f /usr/local/bin/vivox-agent
   rm -rf /etc/vivox-agent
   rm -rf /opt/vivox-agent
   ```
4. Print: `✓ Vivox Agent uninstalled.`

---

### 8. Frontend: Add "One Command" tab to `NodeSetupPanel`

**File:** `apps/web/src/components/NodeSetupPanel.tsx`

Currently has tabs: `docker | systemd | env`. Add a fourth tab: `quickinstall`.

Add `"quickinstall"` to `SetupTab` type:
```ts
type SetupTab = "docker" | "systemd" | "env" | "quickinstall";
```

Add a `GITHUB_RAW_URL` constant at the top of the component:
```ts
const GITHUB_RAW_URL =
  "https://raw.githubusercontent.com/OWNER/REPO/main";
```

Add `quickInstallContent` computed value alongside the others:
```ts
const quickInstallContent = useMemo(() => {
  const panelUrl =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}`
      : "https://your-panel-domain";
  return [
    `bash <(curl -fsSL ${GITHUB_RAW_URL}/infra/scripts/install-node.sh) \\`,
    `  --panel-url ${panelUrl} \\`,
    `  --token ${token} \\`,
    `  --node-id ${node.id}`,
  ].join("\n");
}, [token, node.id]);
```

Add it to `tabContent`:
```ts
const tabContent: Record<SetupTab, string> = {
  quickinstall: quickInstallContent,
  docker: dockerContent,
  systemd: systemdContent,
  env: envContent,
};
```

Add it to the `tabs` array — put it first so it's the default selected tab:
```ts
const tabs: { id: SetupTab; label: string }[] = [
  { id: "quickinstall", label: "⚡ Quick Install" },
  { id: "docker", label: "Docker" },
  { id: "systemd", label: "Systemd" },
  { id: "env", label: "Env File" },
];
```

Change the default tab to `"quickinstall"`:
```ts
const [tab, setTab] = useState<SetupTab>("quickinstall");
```

Add a helper text line below the tab content pre-block, visible only when `tab === "quickinstall"`:
```tsx
{tab === "quickinstall" && (
  <p className="text-xs text-zinc-500">
    Run this command on the edge node to install the agent and connect it to this panel.
    Requires: Docker, git. The script installs everything else automatically.
  </p>
)}
```

---

## File summary

| File | Action |
|---|---|
| `infra/scripts/install.sh` | Create — panel one-command installer |
| `infra/scripts/update.sh` | Create — panel update (safe, preserves .env) |
| `infra/scripts/uninstall.sh` | Create — panel uninstall |
| `infra/scripts/install-node.sh` | Create — node one-command installer (takes --panel-url, --token, --node-id) |
| `infra/scripts/update-node.sh` | Create — node agent update (safe, preserves /etc/vivox-agent/agent.env) |
| `infra/scripts/uninstall-node.sh` | Create — node agent uninstall |
| `apps/web/src/components/NodeSetupPanel.tsx` | Modify — add "⚡ Quick Install" tab as the default tab |

All scripts must be `chmod +x`-able (add `#!/usr/bin/env bash` shebang and `set -euo pipefail`). After creating them, add a note in `infra/prod/SETUP.md` pointing to the scripts.

---

## Key invariants — Cursor must not violate these

- **`.env` is never lost** — every update script backs it up before `git pull` and restores it after.
- **`/etc/vivox-agent/agent.env` is never lost** — same pattern for node updates.
- **Re-run safety** — both installers detect existing installs and offer update/uninstall/exit instead of re-installing on top.
- **No extra ports** — the auto-updater uses polling (systemd timer + git fetch), not an inbound webhook, so nothing new needs to be opened in the firewall.
- **Agent token appears exactly once** — the Quick Install tab in the UI already gets the token from the `NodeSetupPanel` props (passed in after `nodesApi.register()` returns). Do not fetch it again or store it anywhere else.
- **GRPC address** — when building `NEXUS_CONTROL_ADDR` in the node installer, strip `https://` / `http://` from the panel URL and append `:9090`. Never embed the port in a URL with a scheme.
