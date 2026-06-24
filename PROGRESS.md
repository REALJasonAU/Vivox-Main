# Vivox PROGRESS

## Completed (2026-06-24)

### File Manager — multi-mode + local sync
- **List / Tree / VS Code** view modes with per-service `localStorage` persistence
- **Tree mode**: recursive explorer + Monaco editor
- **VS Code mode**: activity bar, explorer, tabs, dark Monaco layout, status bar, Ctrl+S save
- **Open in Local VS Code / IDE**: modal with setup steps, workspace download, sync script download
- **`GET /api/services/:id/files/local-sync`**: Next.js manifest route (api_base, endpoints)
- **`public/vivox-sync/vivox-file-sync.mjs`**: Node 18+ bi-directional sync daemon (watch + pull)

## Current task

None — file manager MVP complete.

## Next actions

- Optional: wire Upload to files API when backend supports it
- Optional: Go API `local-sync` handler if manifest should not live on Next.js
