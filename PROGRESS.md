# Vivox PROGRESS

## Completed (2026-06-25 — node agent updater)

### Node agent install/update scripts
- **`node-agent-lib.sh`**: shared `require_root`, `ensure_go` helpers
- **`update-node.sh`**: root check, Go install fallback, `agent.env` backup/restore around `git pull`, skip redundant restarts when creds unchanged, `chmod +x` after build
- **`install-node.sh`**: `--control-addr` flag; passes through to `write_agent_env` and re-install update path
- **`install.sh`**: co-located panel+node passes `--control-addr 127.0.0.1:9090`

## Completed (2026-06-25 — UI polish sprint)

### Admin server edit
- CPU limits shown/edited as **threads** (`cpuSharesToThreads` / `threadsToCpuShares`) matching deploy wizard
- Restyled page like node detail: header row, stat cards, bordered sections (removed `max-w-3xl` off-center layout)
- **Stop** + **Force stop** admin actions wired to `servicesApi.stop` / `servicesApi.forceStop`

### Force stop API
- `POST /services/:id/force-stop` → `Manager.ForceStopService` (SIGKILL via `TimeoutSeconds: 0`)
- Frontend `servicesApi.forceStop`

### Stopping phase — Kill button
- `ServiceControls`: after ~20s in `STOPPING`, shows **Kill** calling force-stop

### Stop button icon fix
- `animate-stop-implode` no longer uses `animation-fill-mode: forwards` (icon was permanently hidden)
- Button icon animation only runs after click (`animKey > 0`)

### Services → servers (UI copy)
- Dashboard, detail page, command palette, deploy wizard, admin nodes, schedule tab, console aria-label, control toasts

### File manager
- Name prompt modal replaces `window.prompt()` for new file/folder
- Drag-drop upload onto folder rows (list/tree/vscode)
- Drag-move files between folders via new `POST /files/move` + `POST /files/delete`
- Removed header subtitle

### Schedule tab
- Create task via modal with simple presets (hourly/daily/weekly) + advanced raw cron toggle

### Backups tab
- Create backup name modal; inline **Connecting…** state; apologetic failure popup
- Dismissible failed backup rows + notification bell entry on failure

### Settings / startup cleanup
- Removed Docker image edit from customer Settings tab (admin edit panel only)
- Removed startup tab env description paragraph

### Plugins loading
- Skeleton pulse rows instead of lone spinners in `plugin-manager.tsx` and `rust-plugin-manager.tsx`

### Node admin freeze fix
- `NodeSetupPanel` locks/unlocks `body.overflow` on mount/unmount
- Confirm dialog before re-register agent token rotate
- Node detail page clears setup modal state on unmount

## Completed (2026-06-25)

### Template startup env sync
- **`MergeTemplateEnvironment`** + **`FindTemplateForConfig`** in `apps/api/internal/service/templates.go`
- **`updateServiceEnv`** merges template defaults before persist
- **`buildStartupRows`**, **`templates-cache.ts`**, **`env-tab.tsx`** auto-persist

### Service page tab switching
- All tab panels mount persistently via `hidden` class

## Current task

None — node agent updater verified.

## Next actions

- Optional: persist backup display names in DB (`backups.name` column)
- Optional: directory move support in file manager drag-drop
