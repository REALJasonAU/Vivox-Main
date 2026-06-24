# Vivox — Minecraft Plugin & Mod Manager

## Context

Vivox monorepo (`go.work`: `apps/api`, `apps/agent`, `apps/web`, `packages/proto`). Agent communicates via a single bidirectional gRPC stream (`ConnectStream`). Downstream commands go through `Registry.Send(nodeID, *gen.DownstreamEnvelope)`. The agent's client switch handles each action type in `apps/agent/internal/client/client.go` (lines ~209–265). File operations already work end-to-end: `FileListTask`, `FileReadTask`, `FileWriteTask` are all live. The agent's `files.Handler` runs docker exec inside the service container.

Service detail page: `apps/web/src/app/(app)/services/[id]/page.tsx`. `TABS` is a `const` array at line ~57. The service object has `service.type: ServiceType`, `service.config.environment: Record<string,string>|undefined`, `service.node_id: string`.

Existing API methods in `servicesApi` (`apps/web/src/lib/api.ts`): `stop`, `start`, `restart`, `reinstall`, `updateEnv`, `createBackup`. `apiFetch` handles auth.

---

## What to build

A **Plugins / Mods tab** on the service detail page (only for game services with `FRAMEWORK` set) that lets users:
- Search Modrinth, SpigotMC (via Spiget), and CurseForge simultaneously
- Filter results by source and show only free content
- See only compatible results for the server's current MC version and framework
- One-click install (downloads JAR → writes to container via gRPC)
- One-click uninstall
- Auto-update detection with one-click update
- Detect plugins/mods the user manually uploaded (scan directory)
- Search installed plugins, filter by source, toggle "Installed only"

---

## Task 1 — Proto: Add `FileDeleteTask`

File: `packages/proto/agent.proto`

**Add message** (after `FileWriteTask`):
```proto
message FileDeleteTask { string service_id = 1; string path = 2; }
```

**Add field to `DownstreamEnvelope`**:
```proto
// existing fields 1–11 stay the same; add:
FileDeleteTask delete_file = 12;
```

**Regenerate Go code:**
```bash
cd packages/proto && buf generate
# or: protoc --go_out=gen --go-grpc_out=gen agent.proto
```

After regenerating, add the handler to **`apps/agent/internal/files/adapter.go`**:
```go
// DeleteFile implements client.FileHandler.
func (a *ClientAdapter) DeleteFile(ctx context.Context, t *gen.FileDeleteTask) error {
	return a.Handler.DeleteFile(ctx, t.GetServiceId(), t.GetPath())
}
```

Add `DeleteFile` to **`apps/agent/internal/files/files.go`**:
```go
// DeleteFile removes a file inside the service container via docker exec.
func (h *Handler) DeleteFile(ctx context.Context, serviceID, path string) error {
	_, err := h.exec(ctx, serviceID, "rm", "-f", "--", path)
	return err
}
```

Add `DeleteFile(ctx, *gen.FileDeleteTask) error` to the `FileHandler` interface in `apps/agent/internal/client/client.go`.

Add case to the switch in `client.go` (after `WriteFile` case ~line 249):
```go
case *gen.DownstreamEnvelope_DeleteFile:
    cmdID = env.GetCommandId()
    err := r.fileHandler.DeleteFile(ctx, action.DeleteFile)
    sendResponse(err)
```

---

## Task 2 — DB migration: `011_service_plugins.sql`

Create `infra/migrations/011_service_plugins.sql`:
```sql
CREATE TABLE IF NOT EXISTS service_plugins (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    source        TEXT NOT NULL CHECK (source IN ('modrinth','curseforge','spigot','manual')),
    external_id   TEXT NOT NULL,          -- plugin ID on the source platform (or jar hash for manual)
    name          TEXT NOT NULL,
    version       TEXT NOT NULL,          -- human-readable version string
    version_id    TEXT NOT NULL DEFAULT '',  -- platform-internal version identifier (for update checks)
    jar_filename  TEXT NOT NULL,          -- actual filename, e.g. "EssentialsX-2.20.1.jar"
    plugin_dir    TEXT NOT NULL DEFAULT 'plugins',  -- 'plugins' or 'mods'
    auto_update   BOOLEAN NOT NULL DEFAULT TRUE,
    installed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (service_id, jar_filename)
);

CREATE INDEX IF NOT EXISTS idx_service_plugins_service ON service_plugins(service_id);
```

---

## Task 3 — Go API: Config + plugin handlers

### 3a. Config (`apps/api/internal/config/config.go`)

Add field:
```go
CurseForgeAPIKey string // CURSEFORGE_API_KEY env var (optional; disables CurseForge if empty)
```

Load it with:
```go
CurseForgeAPIKey: os.Getenv("CURSEFORGE_API_KEY"),
```

### 3b. DB queries (`apps/api/internal/db/sprint15.go`)

```go
package db

import (
    "context"
    "time"
    "github.com/google/uuid"
)

type ServicePlugin struct {
    ID          uuid.UUID `json:"id"`
    ServiceID   uuid.UUID `json:"service_id"`
    Source      string    `json:"source"`
    ExternalID  string    `json:"external_id"`
    Name        string    `json:"name"`
    Version     string    `json:"version"`
    VersionID   string    `json:"version_id"`
    JarFilename string    `json:"jar_filename"`
    PluginDir   string    `json:"plugin_dir"`
    AutoUpdate  bool      `json:"auto_update"`
    InstalledAt time.Time `json:"installed_at"`
}

func (q *Queries) ListServicePlugins(ctx context.Context, serviceID uuid.UUID) ([]ServicePlugin, error) {
    rows, err := q.db.Query(ctx,
        `SELECT id,service_id,source,external_id,name,version,version_id,jar_filename,plugin_dir,auto_update,installed_at
         FROM service_plugins WHERE service_id=$1 ORDER BY installed_at DESC`, serviceID)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    var out []ServicePlugin
    for rows.Next() {
        var p ServicePlugin
        if err := rows.Scan(&p.ID,&p.ServiceID,&p.Source,&p.ExternalID,&p.Name,&p.Version,&p.VersionID,&p.JarFilename,&p.PluginDir,&p.AutoUpdate,&p.InstalledAt); err != nil {
            return nil, err
        }
        out = append(out, p)
    }
    return out, nil
}

func (q *Queries) UpsertServicePlugin(ctx context.Context, p ServicePlugin) (ServicePlugin, error) {
    var out ServicePlugin
    err := q.db.QueryRow(ctx,
        `INSERT INTO service_plugins (service_id,source,external_id,name,version,version_id,jar_filename,plugin_dir,auto_update)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (service_id,jar_filename)
         DO UPDATE SET source=EXCLUDED.source,external_id=EXCLUDED.external_id,name=EXCLUDED.name,
                       version=EXCLUDED.version,version_id=EXCLUDED.version_id,
                       plugin_dir=EXCLUDED.plugin_dir,auto_update=EXCLUDED.auto_update
         RETURNING id,service_id,source,external_id,name,version,version_id,jar_filename,plugin_dir,auto_update,installed_at`,
        p.ServiceID,p.Source,p.ExternalID,p.Name,p.Version,p.VersionID,p.JarFilename,p.PluginDir,p.AutoUpdate,
    ).Scan(&out.ID,&out.ServiceID,&out.Source,&out.ExternalID,&out.Name,&out.Version,&out.VersionID,&out.JarFilename,&out.PluginDir,&out.AutoUpdate,&out.InstalledAt)
    return out, err
}

func (q *Queries) DeleteServicePlugin(ctx context.Context, id uuid.UUID, serviceID uuid.UUID) error {
    _, err := q.db.Exec(ctx, `DELETE FROM service_plugins WHERE id=$1 AND service_id=$2`, id, serviceID)
    return err
}

func (q *Queries) GetServicePluginByFilename(ctx context.Context, serviceID uuid.UUID, filename string) (ServicePlugin, error) {
    var p ServicePlugin
    err := q.db.QueryRow(ctx,
        `SELECT id,service_id,source,external_id,name,version,version_id,jar_filename,plugin_dir,auto_update,installed_at
         FROM service_plugins WHERE service_id=$1 AND jar_filename=$2`, serviceID, filename,
    ).Scan(&p.ID,&p.ServiceID,&p.Source,&p.ExternalID,&p.Name,&p.Version,&p.VersionID,&p.JarFilename,&p.PluginDir,&p.AutoUpdate,&p.InstalledAt)
    return p, err
}
```

### 3c. Plugin handlers (`apps/api/cmd/api/plugin_handlers.go`)

The handlers need access to: `cfg *config.Config`, `q *db.Queries`, `reg *grpc.Registry`, `tracker *commands.Tracker`.

These are already on the app struct / handler context — wire them the same way as existing handlers.

Register routes in your main router (where other service routes are registered):
```go
svc.Get("/:id/plugins", pluginListHandler)
svc.Get("/:id/plugins/search", pluginSearchHandler)
svc.Post("/:id/plugins/install", pluginInstallHandler)
svc.Delete("/:id/plugins/:pluginId", pluginUninstallHandler)
svc.Post("/:id/plugins/:pluginId/update", pluginUpdateHandler)
svc.Post("/:id/plugins/scan", pluginScanHandler)
```

All routes require the same auth middleware as existing service routes. Check that the requesting user owns the service (or is admin) — same ownership check pattern as in existing handlers.

```go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "net/url"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
    "github.com/nexus-control/apps/api/internal/commands"
    "github.com/nexus-control/apps/api/internal/config"
    "github.com/nexus-control/apps/api/internal/db"
    grpcsrv "github.com/nexus-control/apps/api/internal/grpc"
    gen "github.com/nexus-control/packages/proto/gen"
)

// ─── List installed plugins ──────────────────────────────────────────────────

func pluginListHandler(c *fiber.Ctx, q *db.Queries) error {
    svcID, err := uuid.Parse(c.Params("id"))
    if err != nil { return fiber.ErrBadRequest }
    plugins, err := q.ListServicePlugins(c.Context(), svcID)
    if err != nil { return err }
    if plugins == nil { plugins = []db.ServicePlugin{} }
    return c.JSON(plugins)
}

// ─── Search proxy ────────────────────────────────────────────────────────────

type PluginResult struct {
    ID           string   `json:"id"`
    Source       string   `json:"source"`
    Name         string   `json:"name"`
    Description  string   `json:"description"`
    IconURL      string   `json:"icon_url"`
    Downloads    int64    `json:"downloads"`
    Version      string   `json:"version"`   // latest compatible version string
    VersionID    string   `json:"version_id"` // platform version identifier
    DownloadURL  string   `json:"download_url"` // empty = cannot direct-download
    PageURL      string   `json:"page_url"`
    JarFilename  string   `json:"jar_filename"`
    IsPaid       bool     `json:"is_paid"`
}

// frameworkToModrinthLoaders maps FRAMEWORK env value to Modrinth loader facet values.
var frameworkToModrinthLoaders = map[string][]string{
    "Paper":    {"paper", "spigot", "bukkit"},
    "Purpur":   {"purpur", "paper", "spigot", "bukkit"},
    "Fabric":   {"fabric"},
    "Forge":    {"forge"},
    "NeoForge": {"neoforge", "forge"},
    "Quilt":    {"quilt", "fabric"},
    "Mohist":   {"mohist", "forge", "paper", "spigot", "bukkit"},
    "Arclight": {"fabric", "paper", "spigot", "bukkit"},
    "Vanilla":  {},
}

// frameworkProjectType returns Modrinth project_type facet for a framework.
// Returns "plugin" for Bukkit-based, "mod" for loader-based, "" for hybrid (search both).
func frameworkProjectType(fw string) string {
    switch fw {
    case "Paper", "Purpur": return "plugin"
    case "Fabric", "Forge", "NeoForge", "Quilt": return "mod"
    case "Mohist", "Arclight": return "" // hybrid: search both
    default: return "plugin"
    }
}

// frameworkPluginDir returns whether this framework uses "plugins" or "mods" dir.
func frameworkPluginDir(fw string) string {
    switch fw {
    case "Fabric", "Forge", "NeoForge", "Quilt": return "mods"
    default: return "plugins"
    }
}

func pluginSearchHandler(c *fiber.Ctx, cfg *config.Config) error {
    query   := c.Query("q", "")
    source  := c.Query("source", "all") // "all","modrinth","spigot","curseforge"
    mcVer   := c.Query("mc_version", "1.21.4")
    fw      := c.Query("framework", "Paper")
    page, _ := c.ParamsInt("page", 0) // offset multiplier

    var results []PluginResult

    if source == "all" || source == "modrinth" {
        r, err := searchModrinth(query, mcVer, fw, page)
        if err == nil { results = append(results, r...) }
    }
    if (source == "all" || source == "spigot") && isPluginFramework(fw) {
        r, err := searchSpiget(query, page)
        if err == nil { results = append(results, r...) }
    }
    if (source == "all" || source == "curseforge") && cfg.CurseForgeAPIKey != "" {
        r, err := searchCurseForge(query, mcVer, fw, page, cfg.CurseForgeAPIKey)
        if err == nil { results = append(results, r...) }
    }

    return c.JSON(fiber.Map{"results": results})
}

func isPluginFramework(fw string) bool {
    switch fw {
    case "Paper", "Purpur", "Mohist", "Arclight": return true
    default: return false
    }
}

// ─── Modrinth search ─────────────────────────────────────────────────────────

func searchModrinth(query, mcVer, fw string, page int) ([]PluginResult, error) {
    loaders := frameworkToModrinthLoaders[fw]
    if len(loaders) == 0 { return nil, nil }
    pt := frameworkProjectType(fw)

    // Build facets: version + loaders + optionally project_type
    facets := [][]string{
        {fmt.Sprintf("game_versions:%s", mcVer)},
    }
    loaderFacet := make([]string, len(loaders))
    for i, l := range loaders { loaderFacet[i] = fmt.Sprintf("loaders:%s", l) }
    facets = append(facets, loaderFacet)
    if pt != "" {
        facets = append(facets, []string{fmt.Sprintf("project_type:%s", pt)})
    }

    facetJSON, _ := json.Marshal(facets)
    u := fmt.Sprintf("https://api.modrinth.com/v2/search?query=%s&facets=%s&limit=20&offset=%d",
        url.QueryEscape(query), url.QueryEscape(string(facetJSON)), page*20)

    resp, err := httpGet(u, nil)
    if err != nil { return nil, err }

    var body struct {
        Hits []struct {
            ProjectID   string `json:"project_id"`
            Title       string `json:"title"`
            Description string `json:"description"`
            IconURL     string `json:"icon_url"`
            Downloads   int64  `json:"downloads"`
            Versions    []string `json:"versions"`
            Slug        string `json:"slug"`
        } `json:"hits"`
    }
    if err := json.Unmarshal(resp, &body); err != nil { return nil, err }

    var out []PluginResult
    for _, h := range body.Hits {
        // Fetch latest compatible version for this MC version + loaders
        ver, verID, dlURL, jarName := modrinthLatestVersion(h.ProjectID, mcVer, loaders)
        out = append(out, PluginResult{
            ID:          h.ProjectID,
            Source:      "modrinth",
            Name:        h.Title,
            Description: h.Description,
            IconURL:     h.IconURL,
            Downloads:   h.Downloads,
            Version:     ver,
            VersionID:   verID,
            DownloadURL: dlURL,
            PageURL:     fmt.Sprintf("https://modrinth.com/mod/%s", h.Slug),
            JarFilename: jarName,
        })
    }
    return out, nil
}

func modrinthLatestVersion(projectID, mcVer string, loaders []string) (ver, verID, dlURL, jarName string) {
    loaderJSON, _ := json.Marshal(loaders)
    mcJSON, _ := json.Marshal([]string{mcVer})
    u := fmt.Sprintf("https://api.modrinth.com/v2/project/%s/version?game_versions=%s&loaders=%s",
        projectID, url.QueryEscape(string(mcJSON)), url.QueryEscape(string(loaderJSON)))
    resp, err := httpGet(u, nil)
    if err != nil { return }
    var versions []struct {
        ID             string `json:"id"`
        VersionNumber  string `json:"version_number"`
        Files []struct {
            URL      string `json:"url"`
            Filename string `json:"filename"`
            Primary  bool   `json:"primary"`
        } `json:"files"`
    }
    if err := json.Unmarshal(resp, &versions); err != nil || len(versions) == 0 { return }
    v := versions[0]
    ver = v.VersionNumber
    verID = v.ID
    for _, f := range v.Files {
        if f.Primary || dlURL == "" {
            dlURL = f.URL
            jarName = f.Filename
        }
    }
    return
}

// ─── Spiget (SpigotMC) search ────────────────────────────────────────────────

func searchSpiget(query string, page int) ([]PluginResult, error) {
    var u string
    if query == "" {
        u = fmt.Sprintf("https://api.spiget.org/v2/resources/free?size=20&page=%d&sort=-downloads&fields=id,name,tag,downloads,rating,version,icon,external,links,premium,file", page)
    } else {
        u = fmt.Sprintf("https://api.spiget.org/v2/search/resources/%s?size=20&page=%d&sort=-downloads&fields=id,name,tag,downloads,rating,version,icon,external,links,premium,file",
            url.PathEscape(query), page)
    }

    resp, err := httpGet(u, map[string]string{"User-Agent": "Vivox-Panel/1.0"})
    if err != nil { return nil, err }

    var items []struct {
        ID       int    `json:"id"`
        Name     string `json:"name"`
        Tag      string `json:"tag"`
        Downloads int64 `json:"downloads"`
        Version  struct{ ID string `json:"id"` } `json:"version"`
        Icon     struct{ URL string `json:"url"` } `json:"icon"`
        External bool   `json:"external"`
        Premium  bool   `json:"premium"`
        Links    struct{ URL string `json:"url"` } `json:"links"`
        File     struct{ Type string `json:"type"`; URL string `json:"url"` } `json:"file"`
    }
    if err := json.Unmarshal(resp, &items); err != nil { return nil, err }

    var out []PluginResult
    for _, it := range items {
        if it.Premium { continue } // skip paid
        dlURL := ""
        jarName := fmt.Sprintf("%s.jar", sanitizeFilename(it.Name))
        // External resources (GitHub etc.) can be downloaded via Spiget
        if it.External {
            dlURL = fmt.Sprintf("https://api.spiget.org/v2/resources/%d/download", it.ID)
        }
        pageURL := fmt.Sprintf("https://www.spigotmc.org/resources/%d/", it.ID)
        iconURL := ""
        if it.Icon.URL != "" {
            iconURL = fmt.Sprintf("https://www.spigotmc.org/%s", it.Icon.URL)
        }
        out = append(out, PluginResult{
            ID:          fmt.Sprintf("%d", it.ID),
            Source:      "spigot",
            Name:        it.Name,
            Description: it.Tag,
            IconURL:     iconURL,
            Downloads:   it.Downloads,
            Version:     it.Version.ID,
            VersionID:   it.Version.ID,
            DownloadURL: dlURL, // empty if SpigotMC-hosted (requires manual download)
            PageURL:     pageURL,
            JarFilename: jarName,
        })
    }
    return out, nil
}

// ─── CurseForge search ───────────────────────────────────────────────────────

func searchCurseForge(query, mcVer, fw string, page int, apiKey string) ([]PluginResult, error) {
    classID := 6 // Mods
    if isPluginFramework(fw) { classID = 5 } // Bukkit Plugins

    u := fmt.Sprintf(
        "https://api.curseforge.com/v1/mods/search?gameId=432&classId=%d&searchFilter=%s&gameVersion=%s&index=%d&pageSize=20",
        classID, url.QueryEscape(query), mcVer, page*20)

    resp, err := httpGet(u, map[string]string{"x-api-key": apiKey})
    if err != nil { return nil, err }

    var body struct {
        Data []struct {
            ID    int    `json:"id"`
            Name  string `json:"name"`
            Summary string `json:"summary"`
            Links struct{ WebsiteURL string `json:"websiteUrl"` } `json:"links"`
            Logo  struct{ ThumbnailURL string `json:"thumbnailUrl"` } `json:"logo"`
            DownloadCount float64 `json:"downloadCount"`
            LatestFilesIndexes []struct {
                GameVersion string `json:"gameVersion"`
                FileID      int    `json:"fileId"`
                Filename    string `json:"filename"`
                ReleaseType int    `json:"releaseType"`
            } `json:"latestFilesIndexes"`
        } `json:"data"`
    }
    if err := json.Unmarshal(resp, &body); err != nil { return nil, err }

    var out []PluginResult
    for _, m := range body.Data {
        // Find best file for the requested MC version
        fileID, filename, ver := 0, "", ""
        for _, f := range m.LatestFilesIndexes {
            if f.GameVersion == mcVer && f.ReleaseType == 1 { // 1=Release
                fileID = f.FileID
                filename = f.Filename
                ver = f.Filename
                break
            }
        }
        // Fallback: any file
        if fileID == 0 && len(m.LatestFilesIndexes) > 0 {
            f := m.LatestFilesIndexes[0]
            fileID = f.FileID
            filename = f.Filename
            ver = f.Filename
        }
        dlURL := ""
        if fileID != 0 {
            // Fetch direct download URL from CurseForge
            dlResp, err := httpGet(
                fmt.Sprintf("https://api.curseforge.com/v1/mods/%d/files/%d/download-url", m.ID, fileID),
                map[string]string{"x-api-key": apiKey})
            if err == nil {
                var dlBody struct{ Data string `json:"data"` }
                if json.Unmarshal(dlResp, &dlBody) == nil { dlURL = dlBody.Data }
            }
        }
        out = append(out, PluginResult{
            ID:          fmt.Sprintf("%d", m.ID),
            Source:      "curseforge",
            Name:        m.Name,
            Description: m.Summary,
            IconURL:     m.Logo.ThumbnailURL,
            Downloads:   int64(m.DownloadCount),
            Version:     ver,
            VersionID:   fmt.Sprintf("%d", fileID),
            DownloadURL: dlURL,
            PageURL:     m.Links.WebsiteURL,
            JarFilename: filename,
        })
    }
    return out, nil
}

// ─── Install ─────────────────────────────────────────────────────────────────

type InstallPluginRequest struct {
    Source      string `json:"source"`
    ExternalID  string `json:"external_id"`
    Name        string `json:"name"`
    Version     string `json:"version"`
    VersionID   string `json:"version_id"`
    DownloadURL string `json:"download_url"`
    JarFilename string `json:"jar_filename"`
    AutoUpdate  bool   `json:"auto_update"`
}

func pluginInstallHandler(c *fiber.Ctx, q *db.Queries, reg *grpcsrv.Registry, tracker *commands.Tracker) error {
    svcID, err := uuid.Parse(c.Params("id"))
    if err != nil { return fiber.ErrBadRequest }

    var req InstallPluginRequest
    if err := c.BodyParser(&req); err != nil { return fiber.ErrBadRequest }
    if req.DownloadURL == "" {
        return c.Status(400).JSON(fiber.Map{"error": "no direct download URL available; install manually via Files tab"})
    }

    // Look up service to get node_id and framework
    svc, err := q.GetService(c.Context(), svcID)
    if err != nil { return fiber.ErrNotFound }

    // Download the JAR (with 60s timeout, max 200MB)
    jarBytes, err := downloadFile(req.DownloadURL, 200<<20)
    if err != nil { return c.Status(502).JSON(fiber.Map{"error": fmt.Sprintf("download failed: %v", err)}) }

    // Determine target directory
    fw := svc.Config.Environment["FRAMEWORK"]
    dir := frameworkPluginDir(fw)
    remotePath := fmt.Sprintf("/mnt/server/%s/%s", dir, sanitizeFilename(req.JarFilename))

    // Send FileWriteTask to agent
    cmdID := uuid.New().String()
    env := &gen.DownstreamEnvelope{
        CommandId: cmdID,
        Action: &gen.DownstreamEnvelope_WriteFile{
            WriteFile: &gen.FileWriteTask{
                ServiceId: svcID.String(),
                Path:      remotePath,
                Content:   jarBytes,
            },
        },
    }
    if err := reg.Send(svc.NodeID, env); err != nil {
        return c.Status(503).JSON(fiber.Map{"error": "agent offline"})
    }

    // Wait for command response (15s timeout)
    ctx, cancel := context.WithTimeout(c.Context(), 15*time.Second)
    defer cancel()
    if ok, errMsg := tracker.Wait(ctx, cmdID); !ok {
        return c.Status(502).JSON(fiber.Map{"error": "write failed: " + errMsg})
    }

    // Record in DB
    plugin, err := q.UpsertServicePlugin(c.Context(), db.ServicePlugin{
        ServiceID:   svcID,
        Source:      req.Source,
        ExternalID:  req.ExternalID,
        Name:        req.Name,
        Version:     req.Version,
        VersionID:   req.VersionID,
        JarFilename: sanitizeFilename(req.JarFilename),
        PluginDir:   dir,
        AutoUpdate:  req.AutoUpdate,
    })
    if err != nil { return err }
    return c.Status(201).JSON(plugin)
}

// ─── Uninstall ───────────────────────────────────────────────────────────────

func pluginUninstallHandler(c *fiber.Ctx, q *db.Queries, reg *grpcsrv.Registry, tracker *commands.Tracker) error {
    svcID, err := uuid.Parse(c.Params("id"))
    if err != nil { return fiber.ErrBadRequest }
    pluginID, err := uuid.Parse(c.Params("pluginId"))
    if err != nil { return fiber.ErrBadRequest }

    svc, err := q.GetService(c.Context(), svcID)
    if err != nil { return fiber.ErrNotFound }

    plugins, err := q.ListServicePlugins(c.Context(), svcID)
    if err != nil { return err }
    var target *db.ServicePlugin
    for _, p := range plugins {
        if p.ID == pluginID { pp := p; target = &pp; break }
    }
    if target == nil { return fiber.ErrNotFound }

    remotePath := fmt.Sprintf("/mnt/server/%s/%s", target.PluginDir, target.JarFilename)
    cmdID := uuid.New().String()
    env := &gen.DownstreamEnvelope{
        CommandId: cmdID,
        Action: &gen.DownstreamEnvelope_DeleteFile{
            DeleteFile: &gen.FileDeleteTask{
                ServiceId: svcID.String(),
                Path:      remotePath,
            },
        },
    }
    if err := reg.Send(svc.NodeID, env); err != nil {
        return c.Status(503).JSON(fiber.Map{"error": "agent offline"})
    }
    ctx, cancel := context.WithTimeout(c.Context(), 10*time.Second)
    defer cancel()
    if ok, errMsg := tracker.Wait(ctx, cmdID); !ok {
        return c.Status(502).JSON(fiber.Map{"error": "delete failed: " + errMsg})
    }

    if err := q.DeleteServicePlugin(c.Context(), pluginID, svcID); err != nil { return err }
    return c.SendStatus(204)
}

// ─── Update ──────────────────────────────────────────────────────────────────

func pluginUpdateHandler(c *fiber.Ctx, q *db.Queries, reg *grpcsrv.Registry, tracker *commands.Tracker, cfg *config.Config) error {
    // Same as install but for an existing plugin — delete old JAR, write new one.
    // The body is the same shape as InstallPluginRequest but also contains the DB plugin ID.
    svcID, err := uuid.Parse(c.Params("id"))
    if err != nil { return fiber.ErrBadRequest }
    pluginID, err := uuid.Parse(c.Params("pluginId"))
    if err != nil { return fiber.ErrBadRequest }

    var req InstallPluginRequest
    if err := c.BodyParser(&req); err != nil { return fiber.ErrBadRequest }
    if req.DownloadURL == "" { return c.Status(400).JSON(fiber.Map{"error": "no download URL"}) }

    svc, err := q.GetService(c.Context(), svcID)
    if err != nil { return fiber.ErrNotFound }

    // Find existing record
    plugins, err := q.ListServicePlugins(c.Context(), svcID)
    if err != nil { return err }
    var existing *db.ServicePlugin
    for _, p := range plugins {
        if p.ID == pluginID { pp := p; existing = &pp; break }
    }
    if existing == nil { return fiber.ErrNotFound }

    jarBytes, err := downloadFile(req.DownloadURL, 200<<20)
    if err != nil { return c.Status(502).JSON(fiber.Map{"error": fmt.Sprintf("download failed: %v", err)}) }

    fw := svc.Config.Environment["FRAMEWORK"]
    dir := frameworkPluginDir(fw)

    // Delete old if filename changed
    if existing.JarFilename != sanitizeFilename(req.JarFilename) {
        oldPath := fmt.Sprintf("/mnt/server/%s/%s", existing.PluginDir, existing.JarFilename)
        cmdID := uuid.New().String()
        _ = reg.Send(svc.NodeID, &gen.DownstreamEnvelope{
            CommandId: cmdID,
            Action: &gen.DownstreamEnvelope_DeleteFile{DeleteFile: &gen.FileDeleteTask{ServiceId: svcID.String(), Path: oldPath}},
        })
        ctx, cancel := context.WithTimeout(c.Context(), 5*time.Second)
        tracker.Wait(ctx, cmdID) // best-effort
        cancel()
    }

    remotePath := fmt.Sprintf("/mnt/server/%s/%s", dir, sanitizeFilename(req.JarFilename))
    cmdID := uuid.New().String()
    if err := reg.Send(svc.NodeID, &gen.DownstreamEnvelope{
        CommandId: cmdID,
        Action: &gen.DownstreamEnvelope_WriteFile{WriteFile: &gen.FileWriteTask{
            ServiceId: svcID.String(), Path: remotePath, Content: jarBytes,
        }},
    }); err != nil { return c.Status(503).JSON(fiber.Map{"error": "agent offline"}) }

    ctx, cancel := context.WithTimeout(c.Context(), 15*time.Second)
    defer cancel()
    if ok, errMsg := tracker.Wait(ctx, cmdID); !ok {
        return c.Status(502).JSON(fiber.Map{"error": "write failed: " + errMsg})
    }

    req.JarFilename = sanitizeFilename(req.JarFilename)
    plugin, err := q.UpsertServicePlugin(c.Context(), db.ServicePlugin{
        ID: pluginID, ServiceID: svcID, Source: req.Source, ExternalID: req.ExternalID,
        Name: req.Name, Version: req.Version, VersionID: req.VersionID,
        JarFilename: req.JarFilename, PluginDir: dir, AutoUpdate: req.AutoUpdate,
    })
    if err != nil { return err }
    return c.JSON(plugin)
}

// ─── Scan (detect manual installs) ──────────────────────────────────────────

func pluginScanHandler(c *fiber.Ctx, q *db.Queries, reg *grpcsrv.Registry, tracker *commands.Tracker) error {
    svcID, err := uuid.Parse(c.Params("id"))
    if err != nil { return fiber.ErrBadRequest }

    svc, err := q.GetService(c.Context(), svcID)
    if err != nil { return fiber.ErrNotFound }

    fw := svc.Config.Environment["FRAMEWORK"]
    dir := frameworkPluginDir(fw)

    // Send FileListTask
    cmdID := uuid.New().String()
    if err := reg.Send(svc.NodeID, &gen.DownstreamEnvelope{
        CommandId: cmdID,
        Action: &gen.DownstreamEnvelope_ListFiles{ListFiles: &gen.FileListTask{
            ServiceId: svcID.String(), Path: fmt.Sprintf("/mnt/server/%s/", dir),
        }},
    }); err != nil { return c.Status(503).JSON(fiber.Map{"error": "agent offline"}) }

    ctx, cancel := context.WithTimeout(c.Context(), 10*time.Second)
    defer cancel()
    entries, err := tracker.WaitFileList(ctx, cmdID)
    if err != nil { return c.Status(502).JSON(fiber.Map{"error": err.Error()}) }

    installed, _ := q.ListServicePlugins(c.Context(), svcID)
    knownFiles := map[string]bool{}
    for _, p := range installed { knownFiles[p.JarFilename] = true }

    // Register any JAR files not in DB as "manual" installs
    for _, e := range entries {
        if e.IsDir || !strings.HasSuffix(e.Name, ".jar") { continue }
        if knownFiles[e.Name] { continue }
        _, _ = q.UpsertServicePlugin(c.Context(), db.ServicePlugin{
            ServiceID: svcID, Source: "manual", ExternalID: e.Name,
            Name: strings.TrimSuffix(e.Name, ".jar"), Version: "unknown",
            VersionID: "", JarFilename: e.Name, PluginDir: dir, AutoUpdate: false,
        })
    }

    plugins, _ := q.ListServicePlugins(c.Context(), svcID)
    return c.JSON(plugins)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func httpGet(u string, headers map[string]string) ([]byte, error) {
    client := &http.Client{Timeout: 15 * time.Second}
    req, err := http.NewRequest("GET", u, nil)
    if err != nil { return nil, err }
    req.Header.Set("Accept", "application/json")
    for k, v := range headers { req.Header.Set(k, v) }
    resp, err := client.Do(req)
    if err != nil { return nil, err }
    defer resp.Body.Close()
    if resp.StatusCode >= 400 { return nil, fmt.Errorf("upstream %d", resp.StatusCode) }
    return io.ReadAll(io.LimitReader(resp.Body, 4<<20))
}

func downloadFile(u string, maxBytes int64) ([]byte, error) {
    client := &http.Client{Timeout: 60 * time.Second}
    req, err := http.NewRequest("GET", u, nil)
    if err != nil { return nil, err }
    req.Header.Set("User-Agent", "Vivox-Panel/1.0")
    resp, err := client.Do(req)
    if err != nil { return nil, err }
    defer resp.Body.Close()
    if resp.StatusCode >= 400 { return nil, fmt.Errorf("download %d", resp.StatusCode) }
    return io.ReadAll(io.LimitReader(resp.Body, maxBytes))
}

func sanitizeFilename(s string) string {
    s = strings.Map(func(r rune) rune {
        if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') ||
            r == '-' || r == '_' || r == '.' { return r }
        return '_'
    }, s)
    if !strings.HasSuffix(s, ".jar") { s += ".jar" }
    return s
}
```

### 3d. `commands.Tracker` — add `WaitFileList`

The existing `Tracker` handles `CommandResponse` acknowledgements. For `FileListTask` the response comes back as a `FileListResult` upstream message, which is handled in `grpc/server.go`. The tracker needs a way to surface file list results to callers.

Check how `grpc/server.go` currently handles `GetFileList()` upstream messages (look around line ~172). It likely publishes to a `files.Tracker`. Wire `tracker.WaitFileList` similarly to how `WaitFileRead` works in the files tracker — or if `files.Tracker` already provides this, use it instead of `commands.Tracker`.

If `files.Tracker` in `apps/api/internal/files/tracker.go` already has `WaitList(ctx, cmdID) ([]*gen.FileEntry, error)`, use that. Expose it on the handler struct and use it in `pluginScanHandler`.

---

## Task 4 — Frontend: types + API client

### 4a. Add to `apps/web/src/lib/types.ts`

```ts
export interface ServicePlugin {
  id: string;
  service_id: string;
  source: "modrinth" | "curseforge" | "spigot" | "manual";
  external_id: string;
  name: string;
  version: string;
  version_id: string;
  jar_filename: string;
  plugin_dir: "plugins" | "mods";
  auto_update: boolean;
  installed_at: string;
}

export interface PluginResult {
  id: string;
  source: "modrinth" | "curseforge" | "spigot";
  name: string;
  description: string;
  icon_url: string;
  downloads: number;
  version: string;
  version_id: string;
  download_url: string;  // empty = no direct download
  page_url: string;
  jar_filename: string;
  is_paid: boolean;
}
```

### 4b. Add to `servicesApi` in `apps/web/src/lib/api.ts`

```ts
// Plugin manager
listPlugins: (id: string) =>
  apiFetch<ServicePlugin[]>(`/services/${id}/plugins`),

searchPlugins: (id: string, params: { q?: string; source?: string; mc_version: string; framework: string; page?: number }) =>
  apiFetch<{ results: PluginResult[] }>(
    `/services/${id}/plugins/search?` + new URLSearchParams({
      q: params.q ?? "",
      source: params.source ?? "all",
      mc_version: params.mc_version,
      framework: params.framework,
      page: String(params.page ?? 0),
    })
  ),

installPlugin: (id: string, body: {
  source: string; external_id: string; name: string; version: string;
  version_id: string; download_url: string; jar_filename: string; auto_update: boolean;
}) => apiFetch<ServicePlugin>(`/services/${id}/plugins/install`, { method: "POST", body }),

uninstallPlugin: (id: string, pluginId: string) =>
  apiFetch<void>(`/services/${id}/plugins/${pluginId}`, { method: "DELETE", raw: true }),

updatePlugin: (id: string, pluginId: string, body: {
  source: string; external_id: string; name: string; version: string;
  version_id: string; download_url: string; jar_filename: string; auto_update: boolean;
}) => apiFetch<ServicePlugin>(`/services/${id}/plugins/${pluginId}/update`, { method: "POST", body }),

scanPlugins: (id: string) =>
  apiFetch<ServicePlugin[]>(`/services/${id}/plugins/scan`, { method: "POST" }),
```

---

## Task 5 — Frontend: `PluginManager` component

Create `apps/web/src/components/plugin-manager.tsx`. Full implementation:

```tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Package, Download, Trash2, RefreshCcw,
  ExternalLink, CheckCircle2, AlertCircle, Loader2,
  SlidersHorizontal, ChevronDown, ChevronUp, Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { servicesApi } from "@/lib/api";
import type { Service, ServicePlugin, PluginResult } from "@/lib/types";

// ── Source config ─────────────────────────────────────────────────────────────

type Source = "all" | "modrinth" | "spigot" | "curseforge";

const SOURCE_META: Record<Source, { label: string; color: string }> = {
  all:        { label: "All Sources",  color: "text-muted border-border" },
  modrinth:   { label: "Modrinth",     color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/8" },
  spigot:     { label: "SpigotMC",     color: "text-amber-400 border-amber-500/30 bg-amber-500/8" },
  curseforge: { label: "CurseForge",   color: "text-orange-400 border-orange-500/30 bg-orange-500/8" },
};

const SOURCE_BADGE: Record<string, string> = {
  modrinth:   "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  spigot:     "text-amber-400 bg-amber-500/10 border-amber-500/20",
  curseforge: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  manual:     "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",
};

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  service: Service;
}

// ── Main component ────────────────────────────────────────────────────────────

export function PluginManager({ service }: Props) {
  const fw = service.config?.environment?.FRAMEWORK ?? "Paper";
  const mcVer = service.config?.environment?.MC_VERSION ?? "1.21.4";
  const isModFramework = ["Fabric", "Forge", "NeoForge", "Quilt"].includes(fw);
  const label = isModFramework ? "Mods" : "Plugins";

  // ── State ─────────────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Source>("all");
  const [showInstalled, setShowInstalled] = useState(false);
  const [page, setPage] = useState(0);

  const [searchResults, setSearchResults] = useState<PluginResult[]>([]);
  const [installed, setInstalled] = useState<ServicePlugin[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingInstalled, setLoadingInstalled] = useState(true);
  const [scanning, setScanning] = useState(false);

  // Per-plugin loading state: pluginId → "install" | "uninstall" | "update"
  const [busyPlugins, setBusy] = useState<Record<string, string>>({});

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load installed on mount ───────────────────────────────────────────────
  const loadInstalled = useCallback(async () => {
    setLoadingInstalled(true);
    try {
      const data = await servicesApi.listPlugins(service.id);
      setInstalled(data ?? []);
    } finally {
      setLoadingInstalled(false);
    }
  }, [service.id]);

  useEffect(() => { void loadInstalled(); }, [loadInstalled]);

  // ── Search ────────────────────────────────────────────────────────────────
  const doSearch = useCallback(async (q: string, src: Source, pg: number) => {
    setSearching(true);
    try {
      const data = await servicesApi.searchPlugins(service.id, {
        q, source: src, mc_version: mcVer, framework: fw, page: pg,
      });
      setSearchResults(data.results ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [service.id, mcVer, fw]);

  useEffect(() => {
    if (showInstalled) return;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => void doSearch(query, source, page), 400);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [query, source, page, showInstalled, doSearch]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getInstalled = (result: PluginResult) =>
    installed.find((p) => p.external_id === result.id && p.source === result.source);

  const setBusyFor = (key: string, state: string | null) =>
    setBusy((prev) => { const n = { ...prev }; if (state) n[key] = state; else delete n[key]; return n; });

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleInstall = async (r: PluginResult) => {
    if (!r.download_url) { window.open(r.page_url, "_blank"); return; }
    setBusyFor(r.id, "install");
    try {
      await servicesApi.installPlugin(service.id, {
        source: r.source, external_id: r.id, name: r.name,
        version: r.version, version_id: r.version_id,
        download_url: r.download_url, jar_filename: r.jar_filename,
        auto_update: true,
      });
      toast(`${r.name} installed`, "success");
      void loadInstalled();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Install failed", "error");
    } finally {
      setBusyFor(r.id, null);
    }
  };

  const handleUninstall = async (p: ServicePlugin) => {
    setBusyFor(p.id, "uninstall");
    try {
      await servicesApi.uninstallPlugin(service.id, p.id);
      toast(`${p.name} removed`, "success");
      setInstalled((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Uninstall failed", "error");
    } finally {
      setBusyFor(p.id, null);
    }
  };

  const handleUpdate = async (p: ServicePlugin, r: PluginResult) => {
    if (!r.download_url) { window.open(r.page_url, "_blank"); return; }
    setBusyFor(p.id, "update");
    try {
      await servicesApi.updatePlugin(service.id, p.id, {
        source: r.source, external_id: r.id, name: r.name,
        version: r.version, version_id: r.version_id,
        download_url: r.download_url, jar_filename: r.jar_filename,
        auto_update: p.auto_update,
      });
      toast(`${p.name} updated to ${r.version}`, "success");
      void loadInstalled();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Update failed", "error");
    } finally {
      setBusyFor(p.id, null);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const data = await servicesApi.scanPlugins(service.id);
      setInstalled(data ?? []);
      toast("Directory scanned — manually installed files detected", "success");
    } catch {
      toast("Scan failed", "error");
    } finally {
      setScanning(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const displayResults = showInstalled ? [] : searchResults;
  const displayInstalled = showInstalled
    ? installed.filter((p) =>
        query === "" ||
        p.name.toLowerCase().includes(query.toLowerCase())
      ).filter((p) => source === "all" || p.source === source)
    : installed;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
        {/* Search row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-subtle focus:border-vivox-500/50 focus:outline-none"
            />
          </div>
          <button
            onClick={() => setShowInstalled((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors",
              showInstalled
                ? "border-vivox-500/40 bg-vivox-500/15 text-vivox-400"
                : "border-border bg-background text-muted hover:text-foreground",
            )}
          >
            <CheckCircle2 className="size-3.5" />
            Installed
            <span className={cn(
              "rounded-full px-1.5 py-px text-[10px]",
              showInstalled ? "bg-vivox-500/20 text-vivox-300" : "bg-surface text-subtle"
            )}>
              {installed.length}
            </span>
          </button>
          <Button
            size="sm"
            variant="ghost"
            loading={scanning}
            title="Scan server directory for manually installed files"
            onClick={() => void handleScan()}
          >
            <SlidersHorizontal className="size-3.5" />
          </Button>
        </div>

        {/* Source filter pills */}
        <div className="flex items-center gap-1.5">
          {(["all", "modrinth", "spigot", "curseforge"] as Source[]).map((s) => (
            <button
              key={s}
              onClick={() => { setSource(s); setPage(0); }}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                source === s
                  ? SOURCE_META[s].color + " border-current"
                  : "border-border text-subtle hover:text-muted",
              )}
            >
              {SOURCE_META[s].label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-subtle">
            {mcVer} · {fw}
          </span>
        </div>
      </div>

      {/* ── Installed list (when toggled) ────────────────────────────────── */}
      <AnimatePresence>
        {showInstalled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2">
              {loadingInstalled ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted" />
                </div>
              ) : displayInstalled.length === 0 ? (
                <div className="rounded-xl border border-border bg-surface py-10 text-center text-sm text-muted">
                  No {label.toLowerCase()} installed yet.
                  <p className="mt-1 text-xs text-subtle">
                    Use the search below or upload files via the Files tab.
                  </p>
                </div>
              ) : (
                displayInstalled.map((p) => (
                  <InstalledRow
                    key={p.id}
                    plugin={p}
                    busy={busyPlugins[p.id]}
                    onUninstall={() => void handleUninstall(p)}
                  />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Search results ───────────────────────────────────────────────── */}
      {!showInstalled && (
        <>
          {searching ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted" />
            </div>
          ) : displayResults.length === 0 && query !== "" ? (
            <div className="rounded-xl border border-border bg-surface py-10 text-center text-sm text-muted">
              No results found for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {displayResults.map((r) => {
                const inst = getInstalled(r);
                return (
                  <PluginCard
                    key={`${r.source}-${r.id}`}
                    result={r}
                    installed={inst}
                    busy={busyPlugins[inst?.id ?? r.id]}
                    onInstall={() => void handleInstall(r)}
                    onUninstall={inst ? () => void handleUninstall(inst) : undefined}
                    onUpdate={inst && inst.version_id !== r.version_id
                      ? () => void handleUpdate(inst, r) : undefined}
                  />
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {!searching && displayResults.length > 0 && (
            <div className="flex justify-center gap-2">
              <Button size="sm" variant="ghost" disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronUp className="size-3.5" /> Prev
              </Button>
              <span className="flex items-center px-2 text-xs text-muted">Page {page + 1}</span>
              <Button size="sm" variant="ghost" disabled={displayResults.length < 20}
                onClick={() => setPage((p) => p + 1)}>
                Next <ChevronDown className="size-3.5" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── PluginCard ────────────────────────────────────────────────────────────────

function PluginCard({
  result, installed, busy, onInstall, onUninstall, onUpdate,
}: {
  result: PluginResult;
  installed?: ServicePlugin;
  busy?: string;
  onInstall: () => void;
  onUninstall?: () => void;
  onUpdate?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isInstalled = !!installed;
  const hasUpdate = !!onUpdate;

  return (
    <motion.div
      layout
      className="rounded-xl border border-border bg-surface overflow-hidden"
    >
      <div className="flex items-start gap-3 p-3">
        {/* Icon */}
        <div className="size-10 shrink-0 overflow-hidden rounded-lg border border-border bg-background">
          {result.icon_url ? (
            <img src={result.icon_url} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Package className="size-5 text-muted" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="truncate text-sm font-semibold text-foreground">{result.name}</span>
            <span className={cn("rounded-full border px-1.5 py-px text-[9px] font-medium", SOURCE_BADGE[result.source])}>
              {result.source}
            </span>
            {isInstalled && (
              <span className="rounded-full border border-vivox-500/30 bg-vivox-500/10 px-1.5 py-px text-[9px] font-medium text-vivox-400">
                installed {installed.version}
              </span>
            )}
            {hasUpdate && (
              <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-px text-[9px] font-medium text-blue-400">
                update → {result.version}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{result.description}</p>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-subtle">
            <span>{formatDownloads(result.downloads)} downloads</span>
            <span>v{result.version}</span>
            {!result.download_url && (
              <span className="text-amber-400">manual install only</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          <a href={result.page_url} target="_blank" rel="noopener noreferrer"
            className="rounded-lg border border-border p-1.5 text-muted hover:text-foreground transition-colors">
            <ExternalLink className="size-3.5" />
          </a>

          {hasUpdate && (
            <Button size="sm" variant="secondary" actionType="restart"
              loading={busy === "update"} disabled={!!busy}
              onClick={onUpdate} title={`Update to ${result.version}`}>
              <RefreshCcw className="size-3.5" />
            </Button>
          )}

          {isInstalled ? (
            <Button size="sm" variant="ghost"
              loading={busy === "uninstall"} disabled={!!busy}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
              onClick={onUninstall}>
              <Trash2 className="size-3.5" />
            </Button>
          ) : (
            <Button size="sm"
              loading={busy === "install"} disabled={!!busy}
              onClick={onInstall}
              title={result.download_url ? `Install ${result.name}` : "Visit page to install manually"}>
              {result.download_url
                ? <><Download className="size-3.5" /> Install</>
                : <><ExternalLink className="size-3.5" /> Visit</>}
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── InstalledRow ──────────────────────────────────────────────────────────────

function InstalledRow({ plugin, busy, onUninstall }: {
  plugin: ServicePlugin;
  busy?: string;
  onUninstall: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
        <Package className="size-4 text-muted" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{plugin.name}</span>
          <span className={cn("rounded-full border px-1.5 py-px text-[9px] font-medium", SOURCE_BADGE[plugin.source])}>
            {plugin.source}
          </span>
        </div>
        <p className="text-[10px] text-subtle">{plugin.jar_filename} · v{plugin.version}</p>
      </div>
      <Button size="sm" variant="ghost"
        loading={busy === "uninstall"} disabled={!!busy}
        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
        onClick={onUninstall}>
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
```

---

## Task 6 — Wire tab into service detail page

File: `apps/web/src/app/(app)/services/[id]/page.tsx`

### 6a. Import
```ts
import { PluginManager } from "@/components/plugin-manager";
```

### 6b. Make TABS dynamic based on service

Replace the current const:
```ts
// BEFORE:
const TABS = ["Overview", "Console", "Terminal", "Logs", "Env", "Schedule", "Deployments", "Backups", "Files", "Settings"] as const;
type Tab = (typeof TABS)[number];
```

With a computed array (inside the component, before state):
```tsx
// Determine label: "Plugins" for plugin frameworks, "Mods" for mod frameworks
const fw = service.config?.environment?.FRAMEWORK;
const showPluginTab = service.type === "game" && !!fw && fw !== "Vanilla";
const pluginTabLabel = ["Fabric", "Forge", "NeoForge", "Quilt"].includes(fw ?? "")
  ? "Mods" : "Plugins";

const TABS = [
  "Overview", "Console", "Terminal", "Logs",
  ...(showPluginTab ? [pluginTabLabel as const] : []),
  "Env", "Schedule", "Deployments", "Backups", "Files", "Settings",
] as const;
type Tab = (typeof TABS)[number];
```

> **Note:** TypeScript will widen the `as const` type — you may need `type Tab = string` or cast appropriately if the type system complains. Alternatively keep `Tab = string` and use string comparison.

### 6c. Add render case in the AnimatePresence block:
```tsx
{tab === pluginTabLabel && showPluginTab && (
  <PluginManager service={service} />
)}
```

---

## Task 7 — Environment variable

Add `CURSEFORGE_API_KEY` to `infra/prod/docker-compose.yml` under the `api` service environment (leave blank if not using CurseForge):
```yaml
CURSEFORGE_API_KEY: ${CURSEFORGE_API_KEY:-}
```

---

## Task 8 — Build verification

```bash
# Regenerate proto (required for FileDeleteTask)
cd packages/proto && buf generate

# Go build
cd apps/api && go build ./...
cd apps/agent && go build ./...

# TypeScript
cd apps/web && npm run build
```

---

## Key constraints — do not violate

1. **No paid plugins.** Spiget: skip items where `premium=true`. CurseForge: all content is free; items without a download URL are skipped silently. Modrinth: all free.

2. **SpigotMC direct download is only available for resources marked `external=true`** in the Spiget API. For non-external resources, `download_url` is left empty and the UI shows a "Visit" button.

3. **JAR filenames are sanitised** before being used as file paths. Use `sanitizeFilename()` on all user-supplied and API-supplied filenames.

4. **No JAR is ever written outside `/mnt/server/plugins/` or `/mnt/server/mods/`.** Validate the `dir` variable before constructing the remote path.

5. **The scan endpoint only registers files — it never deletes.** If a JAR is in the DB but not in the directory, it stays in the DB (the user may have deleted it via the terminal).

6. **Commands Tracker.** The `tracker.Wait(ctx, cmdID)` pattern is already used for `FileWriteTask` in other handlers — follow the same pattern. If `WaitFileList` doesn't exist on `commands.Tracker`, find how `grpc/server.go` routes `FileListResult` back to callers (look at `files.Tracker`) and use that mechanism instead.

7. **CurseForge API key is optional.** If `cfg.CurseForgeAPIKey == ""`, skip CurseForge entirely in all search handlers. Never error when it's absent.
