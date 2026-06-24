# Vivox — Create First-Run Setup Script

Create a single bash script at `infra/prod/setup.sh` that handles the entire first-time deployment on a fresh VPS. It must be idempotent (safe to re-run) and require zero manual steps after it finishes.

---

## What the script must do, in order

1. **Collect configuration interactively** — ask the operator for:
   - Panel domain (e.g. `panel.example.com`) — no `https://`, just the hostname
   - Admin account name (display name)
   - Admin email
   - Admin password (input hidden with `-s`)

2. **Generate secrets** if they don't already exist in `infra/prod/.env`:
   - `BETTER_AUTH_SECRET` — `openssl rand -hex 32`
   - `POSTGRES_PASSWORD` — `openssl rand -hex 32`
   - `REDIS_PASSWORD` — `openssl rand -hex 32`

3. **Write `infra/prod/.env`** with all values (domain + secrets). If the file already exists, update only the keys that are not yet set (don't clobber existing secrets on re-run).

4. **Build and start the stack**:
   ```bash
   docker compose -f infra/prod/docker-compose.yml --env-file infra/prod/.env up -d --build
   ```

5. **Wait for the API to be healthy** — poll `http://localhost:8080/healthz` (or the web container at `http://localhost:3000`) every 2 seconds, up to 120 seconds. Print a spinner/dot each tick. Exit with a clear error if the stack doesn't come up in time.

6. **Register the admin user via the Better Auth sign-up endpoint**:
   ```bash
   curl -s -X POST "http://localhost:3000/api/auth/sign-up/email" \
     -H "Content-Type: application/json" \
     -d "{\"name\":\"$ADMIN_NAME\",\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
   ```
   Capture the HTTP response body. If it contains `"error"` or the curl exit code is non-zero, print the error and exit 1.

7. **Promote the user to admin** in Postgres:
   ```bash
   docker compose -f infra/prod/docker-compose.yml --env-file infra/prod/.env \
     exec -T postgres \
     psql -U vivox -d vivox \
     -c "UPDATE \"user\" SET role='admin' WHERE email='$ADMIN_EMAIL';"
   ```

8. **Print a success summary**:
   ```
   ✓ Vivox is running
   
   Panel URL : https://<DOMAIN>
   Admin     : <ADMIN_EMAIL>
   
   Next steps:
     • Point <DOMAIN> at this server's IP in Pangolin
     • Open https://<DOMAIN> and log in with the credentials above
     • Go to Nodes → Register node to add your first edge server
   ```

---

## Script requirements

- **Shebang**: `#!/usr/bin/env bash`
- **Strict mode**: `set -euo pipefail`
- **Must be run from the repo root** — all paths relative to repo root. Add a guard at the top:
  ```bash
  cd "$(dirname "$0")/../.."
  ```
- **Colour output** using ANSI codes — green for success `✓`, red for errors `✗`, yellow for prompts.
- **Idempotent**: if `.env` already has `POSTGRES_PASSWORD` set, skip secret generation for that key. If the admin email already exists in the database (the `UPDATE` returns 0 rows or the sign-up returns a "user already exists" error), print a warning and continue rather than exiting 1.
- **Dependency check** at the top — verify `docker`, `docker compose`, `curl`, `openssl` are available; print a friendly error and exit if any are missing.

---

## Helper function for `.env` writing

Use this pattern so existing keys are not clobbered:

```bash
set_env_var() {
  local key="$1"
  local value="$2"
  local file="infra/prod/.env"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    # Only overwrite if the current value is empty or the placeholder
    current=$(grep "^${key}=" "$file" | cut -d= -f2-)
    if [[ -z "$current" || "$current" == replace_with_* ]]; then
      sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    fi
  else
    echo "${key}=${value}" >> "$file"
  fi
}
```

---

## Waiting for readiness

Wait for the web container to respond (not just the API, since the API port 8080 is not exposed to host):

```bash
echo -n "Waiting for Vivox to start"
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000 > /dev/null 2>&1; then
    echo " ready!"
    break
  fi
  echo -n "."
  sleep 2
  if [[ $i -eq 60 ]]; then
    echo ""
    echo "✗ Timed out waiting for Vivox. Check logs:"
    echo "  docker compose -f infra/prod/docker-compose.yml logs"
    exit 1
  fi
done
```

---

## Make it executable

After creating the file, add a note in the script header comment:

```bash
# Run with: bash infra/prod/setup.sh
# Or first: chmod +x infra/prod/setup.sh && ./infra/prod/setup.sh
```

Also update `infra/prod/SETUP.md` — replace Steps 2 through 6 with a single step:

```markdown
## Step 2 — Run the setup script

```bash
bash infra/prod/setup.sh
```

The script will ask for your domain and admin credentials, generate all secrets, start the stack, and create your admin account automatically.
```

---

## What NOT to do

- Do not hardcode any secrets or credentials
- Do not require the user to run psql manually
- Do not assume the VPS has anything installed beyond Docker (which is confirmed present)
- Do not use Python or Node — pure bash + curl + standard Unix tools only
