# Vivox — All-Fixes Sprint

Implement every fix described below in a single pass. Read each section carefully before touching code — several fixes share DB migrations and API routes.

---

## Fix 1 — Backup fails: "No such image: busybox:latest"

**Root cause**: `apps/agent/internal/backup/backup.go` hard-codes `Image: "busybox"`. The `busybox` image is not present on the production Docker host.

**Fix**: Switch to `alpine:3` (far more commonly pre-pulled) and add an explicit `ImagePull` before `ContainerCreate` so the image is always available.

```go
// apps/agent/internal/backup/backup.go

import (
    "io"
    "github.com/docker/docker/api/types/image"
)

const backupImage = "alpine:3"

// In Run(), before ContainerCreate, add:
pullReader, pullErr := docker.ImagePull(ctx, backupImage, image.PullOptions{})
if pullErr == nil {
    _, _ = io.Copy(io.Discard, pullReader)
    pullReader.Close()
}

// Change the ContainerCreate call:
resp, err := docker.ContainerCreate(ctx, &container.Config{
    Image: backupImage,
    Cmd:   []string{"tar", "czf", "/backup/" + backupID + ".tar.gz", "-C", "/data", "."},
}, &container.HostConfig{
    VolumesFrom: []string{containerID},
    Binds:       []string{BackupDir + ":/backup"},
}, nil, nil, "")
```

---

## Fix 2 — Notification clearing must persist to DB

**Current state**: `apps/web/src/lib/notifications.ts` uses a module-level in-memory array (`_notifs`). On page refresh all notifications vanish. "Mark all read" only affects the current tab.

### 2a. DB migration

Create `infra/migrations/013_notifications.sql`:

```sql
CREATE TYPE notif_kind AS ENUM (
  'crash', 'running', 'stopped', 'deploy_ok', 'deploy_fail', 'alert'
);

CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  kind         notif_kind NOT NULL,
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  meta         JSONB
);

CREATE INDEX idx_notifs_user ON notifications(user_id, ts DESC);
CREATE INDEX idx_notifs_user_unread ON notifications(user_id) WHERE read = FALSE;
```

### 2b. DB queries

Create `apps/api/internal/db/notifications.go`:

```go
package db

import (
    "context"
    "encoding/json"
    "time"

    "github.com/jackc/pgx/v5/pgtype"
)

type Notification struct {
    ID          pgtype.UUID
    UserID      string
    ServiceID   pgtype.UUID
    ServiceName string
    Kind        string
    Ts          time.Time
    Read        bool
    Meta        []byte
}

func (q *Queries) CreateNotification(ctx context.Context, userID, serviceName, kind string, serviceID pgtype.UUID, meta interface{}) (Notification, error) {
    var metaJSON []byte
    if meta != nil {
        var err error
        metaJSON, err = json.Marshal(meta)
        if err != nil {
            metaJSON = nil
        }
    }
    row := q.db.QueryRow(ctx,
        `INSERT INTO notifications (user_id, service_id, service_name, kind, meta)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, service_id, service_name, kind, ts, read, meta`,
        userID, serviceID, serviceName, kind, metaJSON,
    )
    return scanNotification(row)
}

func (q *Queries) ListNotifications(ctx context.Context, userID string, limit int) ([]Notification, error) {
    rows, err := q.db.Query(ctx,
        `SELECT id, user_id, service_id, service_name, kind, ts, read, meta
         FROM notifications WHERE user_id=$1
         ORDER BY ts DESC LIMIT $2`,
        userID, limit,
    )
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    var out []Notification
    for rows.Next() {
        n, err := scanNotification(rows)
        if err != nil {
            return nil, err
        }
        out = append(out, n)
    }
    return out, rows.Err()
}

func (q *Queries) MarkAllNotificationsRead(ctx context.Context, userID string) error {
    _, err := q.db.Exec(ctx,
        `UPDATE notifications SET read=true WHERE user_id=$1 AND read=false`,
        userID,
    )
    return err
}

func scanNotification(row interface{ Scan(...any) error }) (Notification, error) {
    var n Notification
    err := row.Scan(&n.ID, &n.UserID, &n.ServiceID, &n.ServiceName, &n.Kind, &n.Ts, &n.Read, &n.Meta)
    return n, err
}
```

### 2c. API routes

In `apps/api/cmd/api/handlers.go` (route registration section), add:

```go
apiGroup.Get("/notifications", a.listNotifications)
apiGroup.Post("/notifications/read-all", a.markAllNotificationsRead)
```

In the appropriate handlers file (e.g. create `apps/api/cmd/api/notifications_handlers.go`):

```go
package main

import (
    "github.com/gofiber/fiber/v2"
    "github.com/nexus-control/apps/api/internal/auth"
    "github.com/nexus-control/apps/api/internal/service"
)

func (a *api) listNotifications(c *fiber.Ctx) error {
    userID := auth.MustUserID(c)
    rows, err := a.q.ListNotifications(c.UserContext(), userID, 50)
    if err != nil {
        return err
    }
    out := make([]fiber.Map, 0, len(rows))
    for _, n := range rows {
        out = append(out, fiber.Map{
            "id":           service.UUIDString(n.ID),
            "service_id":   service.UUIDString(n.ServiceID),
            "service_name": n.ServiceName,
            "kind":         n.Kind,
            "ts":           n.Ts.UnixMilli(),
            "read":         n.Read,
            "meta":         json.RawMessage(n.Meta),
        })
    }
    return c.JSON(out)
}

func (a *api) markAllNotificationsRead(c *fiber.Ctx) error {
    userID := auth.MustUserID(c)
    return a.q.MarkAllNotificationsRead(c.UserContext(), userID)
}
```

Also add a `PushNotification` helper so the API can create notifications when relevant events fire (crashes, deploy status changes) — wire it into wherever service status changes are published to WebSocket.

### 2d. Frontend — update notifications.ts

Replace `apps/web/src/lib/notifications.ts` with a version that:
1. On mount, fetches `/api/control/notifications` and populates `_notifs`
2. `markAllRead()` calls `POST /api/control/notifications/read-all`, then updates local state
3. `pushNotif()` still works for optimistic local additions (new events arrive via WebSocket), but on next fetch they'll be confirmed from DB
4. Add a `loadNotifications()` async function that the `NotifBell` component calls on open

In `apps/web/src/components/notif-bell.tsx`:
- On `setOpen(true)`, call `loadNotifications()` to refresh from API
- The "Mark all read" button should await the API call before updating state

---

## Fix 3 — Failed backup "dismiss" must persist to DB

**Current state**: `apps/web/src/components/backups-tab.tsx` uses `dismissedFailed` React state (`useState<Set<string>>`). Dismissed backups reappear on refresh.

### 3a. DB migration

Add to `infra/migrations/013_notifications.sql` (same file) or a separate `infra/migrations/013_backup_dismissed.sql`:

```sql
ALTER TABLE backups ADD COLUMN IF NOT EXISTS dismissed BOOLEAN NOT NULL DEFAULT FALSE;
```

### 3b. DB query

Add to the backup queries (in `apps/api/internal/db/sprint13.go` or wherever backup queries live):

```go
func (q *Queries) DismissBackup(ctx context.Context, backupID, serviceID pgtype.UUID) error {
    _, err := q.db.Exec(ctx,
        `UPDATE backups SET dismissed=true WHERE id=$1 AND service_id=$2`,
        backupID, serviceID,
    )
    return err
}
```

Update `ListBackupsForService` to filter out dismissed backups:

```sql
-- In the existing query, add: AND dismissed=false
SELECT ... FROM backups WHERE service_id=$1 AND dismissed=false ORDER BY created_at DESC
```

### 3c. API route

In the route registration section of `apps/api/cmd/api/handlers.go`, add:

```go
apiGroup.Post("/services/:id/backups/:backupId/dismiss", a.dismissBackup)
```

Handler (add alongside the other backup handlers in `handlers_sprint13.go`):

```go
func (a *api) dismissBackup(c *fiber.Ctx) error {
    svc, err := a.loadOwned(c)
    if err != nil {
        return err
    }
    backupID, err := service.ParseUUID(c.Params("backupId"))
    if err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "invalid backup id")
    }
    if err := a.q.DismissBackup(c.UserContext(), backupID, svc.ID); err != nil {
        return err
    }
    return c.SendStatus(fiber.StatusNoContent)
}
```

### 3d. Frontend — backups-tab.tsx

Replace the local `dismissedFailed` state with an API call:

```tsx
const dismissBackup = async (backupId: string) => {
    try {
        await servicesApi.dismissBackup(serviceId, backupId);
        void refetch(); // list will no longer include the dismissed backup
    } catch (e) {
        toast(e instanceof Error ? e.message : "Failed to dismiss", "error");
    }
};
```

Wire the `<X>` dismiss button to call `dismissBackup(b.id)` instead of updating local state.

Add `dismissBackup(serviceId: string, backupId: string)` to `servicesApi` in `apps/web/src/lib/api.ts`:

```ts
dismissBackup: (serviceId: string, backupId: string) =>
    apiFetch(`/services/${serviceId}/backups/${backupId}/dismiss`, { method: "POST" }),
```

Remove the `dismissedFailed` useState and the `visibleBackups` memo that depended on it — just use `list` directly (dismissed ones no longer come back from the API).

---

## Fix 4 — New game icons (Rust & Minecraft)

Replace the placeholder SVGs in `apps/web/src/components/service-logos.tsx` with accurate representations of the actual game branding.

```tsx
export function RustLogo({ className }: { className?: string }) {
  // Rust: red circle, gear-style crosshair (matches the in-game compass/map icon)
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-5", className)}
      aria-hidden
    >
      {/* Red circle background */}
      <circle cx="12" cy="12" r="11" fill="#CD422B" />
      {/* Outer gear ring */}
      <circle cx="12" cy="12" r="8" fill="none" stroke="#F5D48A" strokeWidth="1.6" />
      {/* Gear teeth — 8 rectangles rotated around center */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <rect
          key={deg}
          x="11.2"
          y="2.5"
          width="1.6"
          height="2.5"
          rx="0.4"
          fill="#F5D48A"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
      {/* Crosshair lines (gap in center) */}
      <line x1="12" y1="5.5" x2="12" y2="9.5" stroke="#F5D48A" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="12" y1="14.5" x2="12" y2="18.5" stroke="#F5D48A" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="5.5" y1="12" x2="9.5" y2="12" stroke="#F5D48A" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="14.5" y1="12" x2="18.5" y2="12" stroke="#F5D48A" strokeWidth="1.4" strokeLinecap="round" />
      {/* Inner ring */}
      <circle cx="12" cy="12" r="2.5" fill="none" stroke="#F5D48A" strokeWidth="1.4" />
      {/* Center dot */}
      <circle cx="12" cy="12" r="1" fill="#F5D48A" />
    </svg>
  );
}

export function MinecraftLogo({ className }: { className?: string }) {
  // Minecraft: iconic grass block — green top, brown sides with grass drape, dirt base
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-5", className)}
      aria-hidden
    >
      {/* Dirt base */}
      <rect x="2" y="2" width="20" height="20" rx="1.5" fill="#8B5A2B" />
      {/* Dirt texture (pixel squares) */}
      <rect x="4"  y="10" width="3" height="3" fill="#7A4F25" opacity="0.7" />
      <rect x="9"  y="13" width="3" height="3" fill="#7A4F25" opacity="0.7" />
      <rect x="14" y="10" width="3" height="3" fill="#7A4F25" opacity="0.7" />
      <rect x="6"  y="17" width="3" height="2" fill="#7A4F25" opacity="0.7" />
      <rect x="13" y="16" width="3" height="3" fill="#7A4F25" opacity="0.7" />
      {/* Grass top */}
      <rect x="2" y="2" width="20" height="6" rx="1.5" fill="#5C9A2C" />
      {/* Grass drape onto sides */}
      <rect x="2"  y="8" width="20" height="2" fill="#4E8A25" opacity="0.6" />
      {/* Grass texture (highlight pixels on top) */}
      <rect x="4"  y="3" width="3" height="3" fill="#6DB535" opacity="0.5" />
      <rect x="9"  y="4" width="3" height="2" fill="#6DB535" opacity="0.5" />
      <rect x="14" y="3" width="3" height="3" fill="#6DB535" opacity="0.5" />
      <rect x="18" y="4" width="2" height="2" fill="#6DB535" opacity="0.5" />
    </svg>
  );
}
```

If you have the actual Rust and Minecraft PNG files available, place them at `apps/web/public/icons/rust.png` and `apps/web/public/icons/minecraft.png` and replace the SVG components with:

```tsx
import Image from "next/image";

export function RustLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/icons/rust.png"
      alt="Rust"
      width={20}
      height={20}
      className={cn("size-5 object-contain", className)}
      unoptimized
    />
  );
}

export function MinecraftLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/icons/minecraft.png"
      alt="Minecraft"
      width={20}
      height={20}
      className={cn("size-5 object-contain", className)}
      unoptimized
    />
  );
}
```

---

## Fix 5 — File manager HTTP 500 when container is stopped

**Root cause chain**:
1. `apps/agent/internal/files/files.go` — `exec()` calls `ContainerExecCreate()` on a stopped container, Docker returns "container XYZ is not running"
2. The agent sends this error string back via gRPC
3. `apps/api/cmd/api/handlers_sprint6.go` line 111: `fiber.NewError(fiber.StatusInternalServerError, result.Error)` — returns HTTP 500
4. Frontend shows a generic error

### 5a. Agent — detect container-not-running

In `apps/agent/internal/files/files.go`, add a sentinel error and detect it in `exec()`:

```go
import "strings"

var ErrContainerNotRunning = errors.New("container is not running")

func (h *Handler) exec(ctx context.Context, serviceID string, cmd ...string) ([]byte, error) {
    id, err := h.findContainer(ctx, serviceID)
    if err != nil {
        return nil, err
    }
    if id == "" {
        return nil, fmt.Errorf("no container found for service %s", serviceID)
    }

    // Check container state before attempting exec
    info, err := h.cli.ContainerInspect(ctx, id)
    if err == nil && !info.State.Running {
        return nil, ErrContainerNotRunning
    }

    // ... rest of existing exec code unchanged
}
```

Update all callers (`ListFiles`, `ReadFile`, `WriteFile`, etc.) to propagate this error unchanged.

In the agent's gRPC handler that processes file commands and sends results back — when the error is (or wraps) `ErrContainerNotRunning`, send the error string `"container is not running"` so the API can detect it.

### 5b. API — map to 503

In `apps/api/cmd/api/handlers_sprint6.go`, update `dispatchFileCommandWithTimeout`:

```go
func (a *api) dispatchFileCommandWithTimeout(svc db.Service, env *gen.DownstreamEnvelope, timeout time.Duration) (filestrack.Result, error) {
    // ... existing node-offline checks unchanged ...

    result, ok := filestrack.Wait(ch, timeout)
    if !ok {
        a.fileTracker.Cancel(commandID)
        return filestrack.Result{}, fiber.NewError(fiber.StatusGatewayTimeout, "agent timeout")
    }
    if result.CommandResponse && !result.Success {
        // Detect container-not-running and surface a 503 instead of 500
        if strings.Contains(result.Error, "not running") || strings.Contains(result.Error, "container is not running") {
            return result, fiber.NewError(fiber.StatusServiceUnavailable, "server is not running — start it to use the file manager")
        }
        return result, fiber.NewError(fiber.StatusInternalServerError, result.Error)
    }
    // Also handle the non-command error path:
    if result.Error != "" {
        if strings.Contains(result.Error, "not running") {
            return result, fiber.NewError(fiber.StatusServiceUnavailable, "server is not running — start it to use the file manager")
        }
    }
    return result, nil
}
```

Add `"strings"` to the import if not already present.

Also update `listFiles` line 111:

```go
if result.Error != "" {
    if strings.Contains(result.Error, "not running") {
        return fiber.NewError(fiber.StatusServiceUnavailable, "server is not running — start it to use the file manager")
    }
    return fiber.NewError(fiber.StatusInternalServerError, result.Error)
}
```

### 5c. Frontend — FileManager graceful error

In `apps/web/src/components/FileManager.tsx`, check for 503 in the error handler and show a friendly message instead of the generic error banner:

```tsx
// When the file list fetch fails, check the status code or message:
if (error?.includes("server is not running") || statusCode === 503) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface py-12 text-center">
      <p className="text-sm font-medium text-foreground">Server is not running</p>
      <p className="text-xs text-muted">Start the server to use the file manager.</p>
    </div>
  );
}
```

Look at how FileManager currently handles errors and adapt accordingly. The check should apply to the directory listing fetch, not file reads/writes.

### 5d. Frontend — server.properties editor

`apps/web/src/components/server-properties-editor.tsx` reads `server.properties` via the file manager API. It currently shows "Could not load server.properties — start the server or check Files tab". This already has the right message; just ensure it catches the 503 gracefully (does not show a generic error banner). If it currently throws on non-200 responses, wrap the fetch and check for the 503/not-running message specifically, then display the existing friendly message.

---

## Fix 6 — Tab switching causes full page re-render

**Root cause**: `navigateTab` calls `router.push(buildServicePath(serviceId, nextTab))`, which triggers a Next.js navigation event. Even though the `[[...segments]]` page.tsx is the same file, Next.js App Router re-executes the server component and re-streams RSC, causing the client component to re-render from scratch (losing or flashing accumulated state).

**Fix**: Switch tab navigation to use `window.history.pushState` (no Next.js navigation event) + local React state for the active tab. The URL still updates for deep-linking and browser back/forward.

**Changes to `apps/web/src/components/service-detail-page.tsx`**:

1. Replace the `tab` derivation from props with a stable local state:

```tsx
// Remove:
const route = useMemo(() => parseServiceRoute(segments, tabs), [segments, tabs]);
const tab = route.tab;

// Replace with:
const [tab, setTab] = useState<string>(() => {
  const route = parseServiceRoute(segments, tabs);
  return route.tab;
});
const [fileDirRel, setFileDirRel] = useState<string | undefined>(() => {
  const route = parseServiceRoute(segments, tabs);
  if (route.tab !== "Files" || !route.fileRelPath) return undefined;
  if (route.selectedFileRel) {
    const parts = route.selectedFileRel.split("/");
    parts.pop();
    return parts.join("/");
  }
  return route.fileRelPath;
});
const [selectedFileAbs, setSelectedFileAbs] = useState<string | undefined>(() => {
  const route = parseServiceRoute(segments, tabs);
  return route.selectedFileRel ? fileRelToAbsolute(route.selectedFileRel) : undefined;
});
```

2. Replace `navigateTab`:

```tsx
const navigateTab = useCallback((nextTab: string) => {
  const path = buildServicePath(serviceId, nextTab);
  window.history.pushState(null, "", path);
  setTab(nextTab);
  // Reset file state when leaving Files tab
  if (nextTab !== "Files") {
    setFileDirRel(undefined);
    setSelectedFileAbs(undefined);
  }
}, [serviceId]);
```

3. Replace `navigateFiles`:

```tsx
const navigateFiles = useCallback(
  (absPath: string) => {
    const rel = absoluteToFileRel(absPath);
    const isFile = rel.split("/").pop()?.includes(".") ?? false;
    const nextPath = buildServicePath(serviceId, "Files", {
      selectedFileRel: isFile ? rel : undefined,
      fileDirRel: isFile ? rel.split("/").slice(0, -1).join("/") : rel,
    });
    window.history.pushState(null, "", nextPath);
    setTab("Files");
    setFileDirRel(isFile ? rel.split("/").slice(0, -1).join("/") : rel);
    setSelectedFileAbs(isFile ? absPath : undefined);
  },
  [serviceId],
);
```

4. Remove the `usePathname` import and usage (no longer needed).

5. Remove the `router` import from `next/navigation` — the router is no longer used for tab navigation. Keep the `useEffect` that does `router.replace(buildServicePath(serviceId, "Overview"))` when a tab is not in the available list — that one still needs `router` for the initial redirect.

6. Add a `popstate` listener so the browser back/forward buttons still work:

```tsx
useEffect(() => {
  const onPopState = () => {
    const path = window.location.pathname;
    // Extract segments from path: /services/{id}/{...segments}
    const match = path.match(/^\/services\/[^/]+\/(.*)/);
    const segs = match ? match[1].split("/").filter(Boolean) : [];
    const route = parseServiceRoute(segs.length ? segs : undefined, tabs);
    setTab(route.tab);
    if (route.tab === "Files") {
      setFileDirRel(route.fileRelPath);
      setSelectedFileAbs(route.selectedFileRel ? fileRelToAbsolute(route.selectedFileRel) : undefined);
    }
  };
  window.addEventListener("popstate", onPopState);
  return () => window.removeEventListener("popstate", onPopState);
}, [tabs]);
```

---

## Fix 7 — Server metrics stuck at "Waiting for metrics…"

**Context**: `apps/web/src/components/metrics-chart.tsx` subscribes to WebSocket topic `service:{serviceId}:metrics`. The "Waiting for metrics…" message shows when no payload has arrived yet.

The WebSocket itself is confirmed working (101 Switching Protocols). Metrics are produced by the agent when the service container is running.

**Fixes needed**:

### 7a. Better empty state

In `apps/web/src/components/metrics-chart.tsx`, check the service status before showing "Waiting for metrics…":

```tsx
// MetricsChart receives the service or its status as a prop — if not already, add:
// initialStatus?: ServiceStatus

// In the component:
if (points.length === 0) {
  const isRunning = initialStatus === "RUNNING";
  return (
    <div className="...existing wrapper classes...">
      <p className="text-sm text-muted">
        {isRunning
          ? "Waiting for metrics…"
          : "Start the server to see metrics."}
      </p>
    </div>
  );
}
```

Update `OverviewTab` in `service-detail-page.tsx` to pass `service.status` to `MetricsChart`:

```tsx
<MetricsChart
  serviceId={service.id}
  memoryLimitMb={service.resource_limits.memory_mb}
  diskLimitGb={service.resource_limits.disk_gb}
  initialStatus={service.status}
/>
```

### 7b. Real-time status tracking for MetricsChart

`MetricsChart` also subscribes to `service:{serviceId}:status` so its empty-state message updates live when the server starts/stops, without needing a page refresh.

```tsx
const [liveStatus, setLiveStatus] = useState(initialStatus);
useTopic<StatusPayload>(`service:${serviceId}:status`, (p) => {
  if (p?.status) setLiveStatus(p.status);
});
```

### 7c. Agent connectivity check

If metrics still don't arrive when the server is running, the issue is likely that the agent isn't connected. Add a visible node-offline indicator in `OverviewTab`:

In `apps/web/src/components/service-detail-page.tsx`, read `service.node_id` and if the HealthIndicator shows offline, display a banner above MetricsChart explaining that the agent is not connected.

---

## Migration numbering note

Fixes 2 and 3 both require DB migrations. Use:
- `infra/migrations/013_notifications.sql` — notifications table
- `infra/migrations/014_backup_dismissed.sql` — adds `dismissed` column to backups

The migrations run in numeric order via the existing `migrate` package. Double-check the latest migration number in `infra/migrations/` first (`012_plugin_deps.sql` is the current last one).

---

## Implementation order

1. DB migrations (013, 014) — needed by everything else
2. DB queries (notifications.go, dismiss backup query, update listBackups filter)
3. API routes (notifications endpoints, dismiss backup endpoint)
4. Agent backup fix (busybox → alpine:3)
5. Agent files fix (container-not-running detection)
6. API files handler fix (503 mapping)
7. Frontend — icons (service-logos.tsx)
8. Frontend — file manager error state
9. Frontend — notifications persistence
10. Frontend — backup dismiss via API
11. Frontend — tab switching (window.history.pushState)
12. Frontend — metrics empty state

---

## Files touched summary

| File | Change |
|------|--------|
| `infra/migrations/013_notifications.sql` | CREATE TABLE notifications |
| `infra/migrations/014_backup_dismissed.sql` | ALTER TABLE backups ADD COLUMN dismissed |
| `apps/api/internal/db/notifications.go` | New — notification DB queries |
| `apps/api/cmd/api/notifications_handlers.go` | New — list + mark-all-read handlers |
| `apps/api/cmd/api/handlers.go` | Register notification + dismiss routes |
| `apps/api/cmd/api/handlers_sprint13.go` | Add dismissBackup handler |
| `apps/agent/internal/backup/backup.go` | busybox → alpine:3 + ImagePull |
| `apps/agent/internal/files/files.go` | ErrContainerNotRunning sentinel + pre-exec inspect |
| `apps/api/cmd/api/handlers_sprint6.go` | Map not-running error to 503 |
| `apps/web/src/lib/notifications.ts` | Persist to API |
| `apps/web/src/lib/api.ts` | Add dismissBackup + notifications API methods |
| `apps/web/src/components/notif-bell.tsx` | Fetch from API, API mark-all-read |
| `apps/web/src/components/backups-tab.tsx` | Dismiss via API, remove local dismiss state |
| `apps/web/src/components/service-logos.tsx` | Replace SVGs with accurate game icons |
| `apps/web/src/components/FileManager.tsx` | Graceful 503 error state |
| `apps/web/src/components/server-properties-editor.tsx` | Handle 503 gracefully |
| `apps/web/src/components/service-detail-page.tsx` | Tab nav via history.pushState + metrics status prop |
| `apps/web/src/components/metrics-chart.tsx` | Status-aware empty state |
