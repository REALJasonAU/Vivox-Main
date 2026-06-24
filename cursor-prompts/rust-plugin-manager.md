# Vivox — Rust Plugin Manager

## Context & confirmed API facts

Vivox monorepo, same architecture as Minecraft plugin manager (`cursor-prompts/minecraft-plugin-manager.md`). The DB migration `011_service_plugins.sql` already exists — Rust plugins reuse the same `service_plugins` table. `FileWriteTask` and `FileDeleteTask` (added by Minecraft prompt) already exist in proto. Existing `servicesApi.listPlugins`, `installPlugin`, `uninstallPlugin`, `updatePlugin`, `scanPlugins` API methods already exist.

### uMod API (verified live)

**Search:** `GET https://umod.org/plugins/search.json?query=QUERY&page=PAGE&sort=latest_release_at&sortdir=desc&filter=&categories%5B%5D=rust&author=`

Pagination fields: `current_page`, `last_page`, `per_page` (10), `total`, `data[]`

**Single plugin:** `GET https://umod.org/plugins/{slug}.json`

**Direct download:** `GET https://umod.org/plugins/{PluginName.cs}` — **no auth required, always free.**

Response shape (confirmed from live API):
```json
{
  "name": "GatherManager",
  "title": "Gather Manager",
  "slug": "gather-manager",
  "description": "Increases the amount of items gained from gathering resources",
  "downloads": 588091,
  "downloads_shortened": "588.1K",
  "icon_url": "https://assets.umod.org/images/icons/plugin/5b57e1dd5389c.png",
  "download_url": "https://umod.org/plugins/GatherManager.cs",
  "json_url": "https://umod.org/plugins/gather-manager.json",
  "url": "https://umod.org/plugins/gather-manager",
  "latest_release_version": "2.2.78",
  "latest_release_version_formatted": "v2.2.78",
  "latest_release_version_checksum": "dbe6685ec8b2cc99624c7302e3010dd1446aa478",
  "latest_release_at": "2022-08-06 12:25:08",
  "tags_all": "rust,mechanics,resources",
  "author": "Ryan",
  "author_id": "oXVgqegRaQ",
  "author_icon_url": "https://assets.umod.org/user/oXVgqegRaQ/ETR7PPCEM13VkhY.png",
  "category_tags": "rust",
  "status_detail": { "value": 1, "text": "Published" }
}
```

Notes:
- All uMod plugins are free. No filter needed.
- `latest_release_version_checksum` is SHA1 of the `.cs` file — use this for update detection (compare stored checksum vs current checksum without re-downloading).
- Download URL always ends in `.cs` (C# source code, compiled at runtime by Oxide/Carbon).
- `status_detail.value == 1` means published. Skip others.

### Codefling DB API (verified live)

**Base:** `GET https://www.codefling.com/db?category=CATEGORY_ID`

**Categories:**
- `2` — Plugins (Oxide-compatible, also works on Carbon)
- `21` — Carbon (Carbon-specific plugins)

**Key parameters (all verified from official docs):**
- `limit=N` — cap results
- `title=VALUE` — exact title match (not fuzzy search; use client-side filtering for search)
- `author=VALUE` — exact author match
- `tags=tag1,tag2` — comma-separated tags filter
- `filename=VALUE` — case-insensitive filename match (useful for detecting installed plugins)
- `paid` — presence flag: **shows ONLY paid items.** Do NOT include this param — omitting it returns all items (free + paid mixed)
- `id=N` — filter by specific file ID

**Free-only strategy:** Omit `paid` flag, then filter the response client-side. The response includes a field indicating price/paid status — probe the actual response and filter on `paid === false` or `price === 0` (whichever field exists). See implementation note below.

**Codefling downloads:** Require authentication. Codefling free plugins **cannot be downloaded server-side without a user session**. Therefore:
- Show Codefling results with a **"Visit Page"** button (opens `url` in new tab)
- Detect if the user manually installed a plugin by scanning the plugins directory
- For manually installed plugins, use the `filename=` parameter to look up metadata and track version + update availability
- When an update is available, show a badge + "Visit Page" button (user downloads manually, drops in Files tab)

**Note on response shape:** Fetch `https://www.codefling.com/db?category=21&limit=1` as the first step in implementation and log the response to see exact field names before writing the parser. The confirmed parameters suggest fields: `id`, `title`, `author`, `paid` (or `price`), `tags`, `rating`, `filename`, `compatibility`. The `url` field is likely the page URL. Adapt the struct to match the actual response.

---

## What to build

A **"Plugins" tab** on the Rust service detail page (only when `FRAMEWORK` is not `Vanilla`) with:
- Browse and search plugins from uMod (Oxide) and Codefling (Carbon/Oxide)
- Framework-aware: filter sources and install directory based on Oxide vs Carbon
- One-click install for uMod plugins (direct download → write to container)
- "Visit Page" button for Codefling plugins (cannot direct-download without auth)
- Auto-update for uMod plugins (checksum comparison)
- Update notification for Codefling plugins (version comparison, user installs manually)
- Detect manually installed plugins (scan `/mnt/server/oxide/plugins/` or `/mnt/server/carbon/plugins/`)
- Dependency detection: parse `[PluginReference]` from installed `.cs` files, show missing deps
- Installed filter, source filter, search

---

## Task 1 — Framework-to-directory mapping

In `apps/api/cmd/api/plugin_handlers.go`, add a Rust-aware plugin directory function:

```go
// rustPluginDir returns the plugins directory path (relative to /mnt/server)
// based on the FRAMEWORK env var from the Rust service template.
func rustPluginDir(fw string) string {
    switch strings.ToLower(fw) {
    case "oxide":
        return "oxide/plugins"
    case "carbon", "carbon-minimal":
        return "carbon/plugins"
    default:
        return "oxide/plugins" // fallback
    }
}

// isRustService returns true if this is a game service using the Rust template
// (detected by FRAMEWORK containing oxide/carbon rather than Paper/Fabric/etc.)
func isRustService(fw string) bool {
    fw = strings.ToLower(fw)
    return fw == "oxide" || fw == "carbon" || fw == "carbon-minimal" || fw == "vanilla"
}
```

The existing `pluginListHandler`, `pluginInstallHandler`, `pluginUninstallHandler`, `pluginUpdateHandler`, `pluginScanHandler` already work generically — the `plugin_dir` stored in `service_plugins` tells the agent where to put the file. The only change needed is that when a Rust service calls `pluginInstallHandler`, the handler uses `rustPluginDir(fw)` instead of `frameworkPluginDir(fw)`. 

**Fix:** In `pluginInstallHandler` and `pluginUpdateHandler`, before computing `dir`, add a branch:
```go
fw := svc.Config.Environment["FRAMEWORK"]
var dir string
if isRustService(fw) {
    dir = rustPluginDir(fw)
} else {
    dir = frameworkPluginDir(fw) // Minecraft handler (plugins or mods)
}
```

The remote path becomes `/mnt/server/oxide/plugins/PluginName.cs` or `/mnt/server/carbon/plugins/PluginName.cs`.

---

## Task 2 — uMod search handler

Add to `apps/api/cmd/api/plugin_handlers.go`:

```go
// searchUmod queries the uMod plugins API for Rust plugins.
// All uMod plugins are free; all are .cs files.
func searchUmod(query string, page int) ([]PluginResult, error) {
    u := fmt.Sprintf(
        "https://umod.org/plugins/search.json?query=%s&page=%d&sort=latest_release_at&sortdir=desc&filter=&categories%%5B%%5D=rust&author=",
        url.QueryEscape(query), page+1) // uMod is 1-indexed

    resp, err := httpGet(u, map[string]string{"User-Agent": "Vivox-Panel/1.0"})
    if err != nil { return nil, err }

    var body struct {
        Data []struct {
            Name                       string `json:"name"`
            Title                      string `json:"title"`
            Slug                       string `json:"slug"`
            Description                string `json:"description"`
            Downloads                  int64  `json:"downloads"`
            IconURL                    string `json:"icon_url"`
            DownloadURL                string `json:"download_url"`
            JSONURL                    string `json:"json_url"`
            URL                        string `json:"url"`
            LatestReleaseVersion       string `json:"latest_release_version"`
            LatestReleaseVersionChecksum string `json:"latest_release_version_checksum"`
            LatestReleaseAt            string `json:"latest_release_at"`
            Author                     string `json:"author"`
            AuthorIconURL              string `json:"author_icon_url"`
            StatusDetail               struct {
                Value int `json:"value"`
            } `json:"status_detail"`
        } `json:"data"`
    }
    if err := json.Unmarshal(resp, &body); err != nil { return nil, err }

    var out []PluginResult
    for _, p := range body.Data {
        if p.StatusDetail.Value != 1 { continue } // skip unpublished
        // VersionID stores the SHA1 checksum — enables update detection without re-downloading
        jarName := p.Name + ".cs"
        if p.DownloadURL != "" {
            parts := strings.Split(p.DownloadURL, "/")
            if len(parts) > 0 { jarName = parts[len(parts)-1] }
        }
        out = append(out, PluginResult{
            ID:          p.Slug,
            Source:      "umod",
            Name:        p.Title,
            Description: p.Description,
            IconURL:     p.IconURL,
            Downloads:   p.Downloads,
            Version:     p.LatestReleaseVersion,
            VersionID:   p.LatestReleaseVersionChecksum, // SHA1
            DownloadURL: p.DownloadURL,
            PageURL:     p.URL,
            JarFilename: jarName, // .cs extension
        })
    }
    return out, nil
}
```

---

## Task 3 — Codefling search handler

```go
// CodeflingPlugin represents one entry from the Codefling DB API.
// Field names are inferred from API docs; verify against live response before shipping.
// Fetch https://www.codefling.com/db?category=21&limit=1 and log to confirm fields.
type CodeflingPlugin struct {
    ID          interface{} `json:"id"`           // may be int or string
    Title       string      `json:"title"`
    Author      string      `json:"author"`
    Description string      `json:"description"`  // may be absent — check live response
    Filename    string      `json:"filename"`
    Tags        interface{} `json:"tags"`         // may be string or []string
    Rating      interface{} `json:"rating"`
    Paid        interface{} `json:"paid"`         // bool or int 0/1 — check live response
    Price       interface{} `json:"price"`        // alternative paid indicator
    URL         string      `json:"url"`
    Thumbnail   string      `json:"thumbnail"`   // or "icon" — check live response
    Downloads   int64       `json:"downloads"`
    Version     string      `json:"version"`
    UpdatedAt   string      `json:"updated_at"`  // or "date" — check live response
    Compatibility string    `json:"compatibility"`
}

func codeflingIsPaid(p CodeflingPlugin) bool {
    switch v := p.Paid.(type) {
    case bool: return v
    case float64: return v != 0
    case string: return v == "1" || strings.ToLower(v) == "true"
    }
    switch v := p.Price.(type) {
    case float64: return v > 0
    case string: f, err := strconv.ParseFloat(v, 64); return err == nil && f > 0
    }
    return false
}

func codeflingID(p CodeflingPlugin) string {
    switch v := p.ID.(type) {
    case float64: return fmt.Sprintf("%.0f", v)
    case string: return v
    default: return fmt.Sprintf("%v", v)
    }
}

// searchCodefling fetches from the Codefling DB API.
// categories: "2" for Oxide plugins, "2,21" for Carbon (Oxide + Carbon-specific)
func searchCodefling(query, categories string) ([]PluginResult, error) {
    u := fmt.Sprintf("https://www.codefling.com/db?category=%s", categories)

    resp, err := httpGet(u, map[string]string{
        "User-Agent": "Vivox-Panel/1.0",
        "Accept":     "application/json",
    })
    if err != nil { return nil, err }

    // The API returns an array directly (not wrapped in an object)
    var items []CodeflingPlugin
    if err := json.Unmarshal(resp, &items); err != nil {
        // Try wrapped form {"data": [...]} as fallback
        var wrapped struct { Data []CodeflingPlugin `json:"data"` }
        if err2 := json.Unmarshal(resp, &wrapped); err2 != nil { return nil, err }
        items = wrapped.Data
    }

    queryLower := strings.ToLower(query)
    var out []PluginResult
    for _, it := range items {
        if codeflingIsPaid(it) { continue } // free only
        // Client-side search filter
        if queryLower != "" &&
            !strings.Contains(strings.ToLower(it.Title), queryLower) &&
            !strings.Contains(strings.ToLower(it.Description), queryLower) {
            continue
        }
        icon := it.Thumbnail
        filename := it.Filename
        if filename == "" { filename = sanitizeFilename(it.Title) + ".cs" }
        if !strings.HasSuffix(filename, ".cs") { filename += ".cs" }

        pageURL := it.URL
        if pageURL == "" { pageURL = fmt.Sprintf("https://codefling.com/plugins/%s", strings.ToLower(strings.ReplaceAll(it.Title, " ", "-"))) }

        out = append(out, PluginResult{
            ID:          codeflingID(it),
            Source:      "codefling",
            Name:        it.Title,
            Description: it.Description,
            IconURL:     icon,
            Downloads:   it.Downloads,
            Version:     it.Version,
            VersionID:   it.Version, // use version string for update detection
            DownloadURL: "",          // cannot direct-download without auth
            PageURL:     pageURL,
            JarFilename: filename,
        })
    }
    return out, nil
}
```

---

## Task 4 — Rust-specific search endpoint

In the existing `pluginSearchHandler`, add a branch for Rust services:

```go
func pluginSearchHandler(c *fiber.Ctx, cfg *config.Config) error {
    query   := c.Query("q", "")
    source  := c.Query("source", "all")
    fw      := c.Query("framework", "Oxide")
    page, _ := c.ParamsInt("page", 0)

    // Rust path
    if isRustService(fw) && strings.ToLower(fw) != "vanilla" {
        var results []PluginResult
        if source == "all" || source == "umod" {
            r, err := searchUmod(query, page)
            if err == nil { results = append(results, r...) }
        }
        if source == "all" || source == "codefling" {
            // Carbon gets both Oxide plugins (cat 2) + Carbon-specific (cat 21)
            cats := "2"
            if strings.ToLower(fw) == "carbon" || strings.ToLower(fw) == "carbon-minimal" {
                cats = "2,21"
            }
            r, err := searchCodefling(query, cats)
            if err == nil { results = append(results, r...) }
        }
        return c.JSON(fiber.Map{"results": results})
    }

    // Minecraft path (existing code) ...
}
```

---

## Task 5 — Dependency detection in Go API

When a uMod plugin is installed, the Go API downloads the `.cs` file and sends it to the agent. Before sending, parse it for `[PluginReference]` attributes and store the dependency list in the DB.

Add to `apps/api/internal/db/sprint15.go`:
```go
// PluginDependency tracks detected [PluginReference] declarations for an installed plugin.
// These are computed from the .cs source at install time.
// Stored as a simple JSONB array on the service_plugins row.
// Implementation: add a `dependencies JSONB NOT NULL DEFAULT '[]'` column to service_plugins
// in a follow-up migration (012_plugin_deps.sql):
//   ALTER TABLE service_plugins ADD COLUMN IF NOT EXISTS dependencies JSONB NOT NULL DEFAULT '[]';

func (q *Queries) UpdatePluginDependencies(ctx context.Context, pluginID uuid.UUID, deps []string) error {
    depsJSON, _ := json.Marshal(deps)
    _, err := q.db.Exec(ctx,
        `UPDATE service_plugins SET dependencies=$1 WHERE id=$2`, depsJSON, pluginID)
    return err
}

func (q *Queries) GetPluginDependencies(ctx context.Context, pluginID uuid.UUID) ([]string, error) {
    var raw []byte
    err := q.db.QueryRow(ctx, `SELECT dependencies FROM service_plugins WHERE id=$1`, pluginID).Scan(&raw)
    if err != nil { return nil, err }
    var deps []string
    json.Unmarshal(raw, &deps)
    return deps, nil
}
```

Add helper to `plugin_handlers.go`:
```go
// parsePluginReferences extracts [PluginReference] dependency names from a Rust .cs plugin file.
// Handles two forms:
//   [PluginReference] private Plugin ImageLibrary;       → "ImageLibrary"
//   [PluginReference("BetterChat")] private Plugin chat; → "BetterChat"
func parsePluginReferences(src []byte) []string {
    // Form 1: named string attribute
    re1 := regexp.MustCompile(`\[PluginReference\("([^"]+)"\)\]`)
    // Form 2: typed field name
    re2 := regexp.MustCompile(`\[PluginReference\]\s*(?:private|public|protected|internal)?\s+Plugin\s+(\w+)`)
    
    seen := map[string]bool{}
    for _, m := range re1.FindAllSubmatch(src, -1) {
        name := string(m[1])
        if !seen[name] { seen[name] = true }
    }
    for _, m := range re2.FindAllSubmatch(src, -1) {
        name := string(m[1])
        if !seen[name] { seen[name] = true }
    }
    var out []string
    for name := range seen { out = append(out, name) }
    sort.Strings(out)
    return out
}
```

In `pluginInstallHandler`, after downloading the `.cs` bytes and before sending `FileWriteTask`:
```go
// Parse dependencies from .cs source
if strings.HasSuffix(req.JarFilename, ".cs") {
    deps := parsePluginReferences(jarBytes)
    // Store after upsert (update in the same handler after UpsertServicePlugin):
    // _ = q.UpdatePluginDependencies(c.Context(), plugin.ID, deps)
}
```

Wire it: after `q.UpsertServicePlugin(...)` returns `plugin`, call `q.UpdatePluginDependencies(c.Context(), plugin.ID, parsePluginReferences(jarBytes))`.

Also create migration `012_plugin_deps.sql`:
```sql
ALTER TABLE service_plugins ADD COLUMN IF NOT EXISTS dependencies JSONB NOT NULL DEFAULT '[]';
```

---

## Task 6 — Update `ServicePlugin` type to include dependencies

In `apps/web/src/lib/types.ts`, update `ServicePlugin`:
```ts
export interface ServicePlugin {
  id: string;
  service_id: string;
  source: "modrinth" | "curseforge" | "spigot" | "umod" | "codefling" | "manual";
  external_id: string;
  name: string;
  version: string;
  version_id: string;
  jar_filename: string;
  plugin_dir: string;  // "plugins", "mods", "oxide/plugins", "carbon/plugins"
  auto_update: boolean;
  installed_at: string;
  dependencies: string[];  // parsed from [PluginReference] — may be empty array
}
```

Also update the `source` union type in `PluginResult` to add `"umod" | "codefling"`.

---

## Task 7 — `RustPluginManager` component

Create `apps/web/src/components/rust-plugin-manager.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Package, Download, Trash2, RefreshCcw,
  ExternalLink, CheckCircle2, Loader2, AlertTriangle,
  SlidersHorizontal, ChevronDown, ChevronUp, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { servicesApi } from "@/lib/api";
import type { Service, ServicePlugin, PluginResult } from "@/lib/types";

// ── Source config ─────────────────────────────────────────────────────────────

type RustSource = "all" | "umod" | "codefling";

const SOURCE_META: Record<RustSource, { label: string; activeClass: string }> = {
  all:        { label: "All Sources",  activeClass: "text-muted border-border" },
  umod:       { label: "uMod",         activeClass: "text-blue-400 border-blue-500/30 bg-blue-500/8" },
  codefling:  { label: "Codefling",    activeClass: "text-vivox-400 border-vivox-500/30 bg-vivox-500/8" },
};

const SOURCE_BADGE: Record<string, string> = {
  umod:       "text-blue-400 bg-blue-500/10 border-blue-500/20",
  codefling:  "text-vivox-400 bg-vivox-500/10 border-vivox-500/20",
  manual:     "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",
};

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props { service: Service; }

// ── Main component ────────────────────────────────────────────────────────────

export function RustPluginManager({ service }: Props) {
  const fw = service.config?.environment?.FRAMEWORK ?? "Oxide";
  const fwLabel = fw.toLowerCase().startsWith("carbon") ? "Carbon" : "Oxide";

  const [query, setQuery] = useState("");
  const [source, setSource] = useState<RustSource>("all");
  const [showInstalled, setShowInstalled] = useState(false);
  const [page, setPage] = useState(0);

  const [searchResults, setSearchResults] = useState<PluginResult[]>([]);
  const [installed, setInstalled] = useState<ServicePlugin[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingInstalled, setLoadingInstalled] = useState(true);
  const [scanning, setScanning] = useState(false);

  const [busyPlugins, setBusy] = useState<Record<string, string>>({});
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Installed ──────────────────────────────────────────────────────────────
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

  // ── Search ─────────────────────────────────────────────────────────────────
  const doSearch = useCallback(async (q: string, src: RustSource, pg: number) => {
    setSearching(true);
    try {
      const data = await servicesApi.searchPlugins(service.id, {
        q, source: src, mc_version: "", framework: fw, page: pg,
      });
      setSearchResults(data.results ?? []);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }, [service.id, fw]);

  useEffect(() => {
    if (showInstalled) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void doSearch(query, source, page), 400);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, source, page, showInstalled, doSearch]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const getInstalled = (r: PluginResult) =>
    installed.find((p) => p.external_id === r.id && p.source === r.source);

  const setBusyFor = (key: string, val: string | null) =>
    setBusy((prev) => { const n = { ...prev }; if (val) n[key] = val; else delete n[key]; return n; });

  // ── Missing dependencies ───────────────────────────────────────────────────
  const getMissingDeps = (plugin: ServicePlugin): string[] => {
    if (!plugin.dependencies?.length) return [];
    const installedNames = new Set(
      installed.map((p) => p.name.toLowerCase().replace(/\s/g, ""))
    );
    return plugin.dependencies.filter(
      (dep) => !installedNames.has(dep.toLowerCase().replace(/\s/g, ""))
    );
  };

  // ── Actions ────────────────────────────────────────────────────────────────
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
    } finally { setBusyFor(r.id, null); }
  };

  const handleUninstall = async (p: ServicePlugin) => {
    setBusyFor(p.id, "uninstall");
    try {
      await servicesApi.uninstallPlugin(service.id, p.id);
      toast(`${p.name} removed`, "success");
      setInstalled((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Uninstall failed", "error");
    } finally { setBusyFor(p.id, null); }
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
      toast(`${p.name} updated to v${r.version}`, "success");
      void loadInstalled();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Update failed", "error");
    } finally { setBusyFor(p.id, null); }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const data = await servicesApi.scanPlugins(service.id);
      setInstalled(data ?? []);
      toast("Plugin directory scanned", "success");
    } catch { toast("Scan failed", "error"); }
    finally { setScanning(false); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const filteredInstalled = installed
    .filter((p) => source === "all" || p.source === source)
    .filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              placeholder="Search Rust plugins..."
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
            )}>{installed.length}</span>
          </button>
          <Button size="sm" variant="ghost" loading={scanning} title="Scan for manually installed plugins"
            onClick={() => void handleScan()}>
            <SlidersHorizontal className="size-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          {(["all", "umod", "codefling"] as RustSource[]).map((s) => (
            <button key={s} onClick={() => { setSource(s); setPage(0); }}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                source === s ? SOURCE_META[s].activeClass + " border-current" : "border-border text-subtle hover:text-muted",
              )}>
              {SOURCE_META[s].label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-subtle">{fwLabel}</span>
        </div>
        {/* Codefling note */}
        <div className="flex items-start gap-2 rounded-lg border border-border bg-background/40 px-2.5 py-1.5">
          <Info className="mt-0.5 size-3 shrink-0 text-muted" />
          <p className="text-[10px] text-subtle leading-relaxed">
            <span className="text-vivox-400 font-medium">uMod</span> plugins install with one click.{" "}
            <span className="text-vivox-400 font-medium">Codefling</span> plugins require manual download — use the{" "}
            <span className="text-foreground">Visit</span> button, then upload the <code>.cs</code> file via the{" "}
            <span className="text-foreground">Files</span> tab. The panel will detect and track it automatically.
          </p>
        </div>
      </div>

      {/* Installed view */}
      <AnimatePresence>
        {showInstalled && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex flex-col gap-2">
              {loadingInstalled ? (
                <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted" /></div>
              ) : filteredInstalled.length === 0 ? (
                <div className="rounded-xl border border-border bg-surface py-10 text-center text-sm text-muted">
                  No plugins installed.
                  <p className="mt-1 text-xs text-subtle">Install from the search below or upload .cs files via Files tab.</p>
                </div>
              ) : (
                filteredInstalled.map((p) => {
                  const missingDeps = getMissingDeps(p);
                  return (
                    <InstalledPluginRow key={p.id} plugin={p} missingDeps={missingDeps}
                      busy={busyPlugins[p.id]} onUninstall={() => void handleUninstall(p)} />
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search results */}
      {!showInstalled && (
        <>
          {searching ? (
            <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted" /></div>
          ) : searchResults.length === 0 && query !== "" ? (
            <div className="rounded-xl border border-border bg-surface py-10 text-center text-sm text-muted">
              No results for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {searchResults.map((r) => {
                const inst = getInstalled(r);
                const hasUpdate = !!inst && inst.version_id !== r.version_id;
                return (
                  <RustPluginCard key={`${r.source}-${r.id}`} result={r} installed={inst}
                    hasUpdate={hasUpdate} busy={busyPlugins[inst?.id ?? r.id]}
                    onInstall={() => void handleInstall(r)}
                    onUninstall={inst ? () => void handleUninstall(inst) : undefined}
                    onUpdate={hasUpdate && inst ? () => void handleUpdate(inst, r) : undefined}
                  />
                );
              })}
            </div>
          )}
          {!searching && searchResults.length > 0 && (
            <div className="flex justify-center gap-2">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronUp className="size-3.5" /> Prev
              </Button>
              <span className="flex items-center px-2 text-xs text-muted">Page {page + 1}</span>
              <Button size="sm" variant="ghost" disabled={searchResults.length < 10} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronDown className="size-3.5" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── RustPluginCard ────────────────────────────────────────────────────────────

function RustPluginCard({ result, installed, hasUpdate, busy, onInstall, onUninstall, onUpdate }: {
  result: PluginResult;
  installed?: ServicePlugin;
  hasUpdate: boolean;
  busy?: string;
  onInstall: () => void;
  onUninstall?: () => void;
  onUpdate?: () => void;
}) {
  const canDirectInstall = result.source === "umod" && !!result.download_url;

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <div className="size-10 shrink-0 overflow-hidden rounded-lg border border-border bg-background">
          {result.icon_url ? (
            <img src={result.icon_url} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Package className="size-5 text-muted" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{result.name}</span>
            <span className={cn("rounded-full border px-1.5 py-px text-[9px] font-medium", SOURCE_BADGE[result.source])}>
              {result.source}
            </span>
            {!!installed && (
              <span className="rounded-full border border-vivox-500/30 bg-vivox-500/10 px-1.5 py-px text-[9px] font-medium text-vivox-400">
                installed v{installed.version}
              </span>
            )}
            {hasUpdate && (
              <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-px text-[9px] font-medium text-blue-400">
                update → v{result.version}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{result.description}</p>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-subtle">
            {result.downloads > 0 && <span>{fmtDownloads(result.downloads)} downloads</span>}
            <span>v{result.version}</span>
            {!canDirectInstall && <span className="text-amber-400/80">manual install only</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <a href={result.page_url} target="_blank" rel="noopener noreferrer"
            className="rounded-lg border border-border p-1.5 text-muted hover:text-foreground transition-colors" title="View on site">
            <ExternalLink className="size-3.5" />
          </a>
          {hasUpdate && onUpdate && (
            <Button size="sm" variant="secondary" actionType="restart"
              loading={busy === "update"} disabled={!!busy} onClick={onUpdate}>
              <RefreshCcw className="size-3.5" />
            </Button>
          )}
          {!!installed ? (
            <Button size="sm" variant="ghost" loading={busy === "uninstall"} disabled={!!busy}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={onUninstall}>
              <Trash2 className="size-3.5" />
            </Button>
          ) : (
            <Button size="sm" loading={busy === "install"} disabled={!!busy} onClick={onInstall}
              title={canDirectInstall ? `Install ${result.name}` : "Visit page to download"}>
              {canDirectInstall
                ? <><Download className="size-3.5" /> Install</>
                : <><ExternalLink className="size-3.5" /> Visit</>}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── InstalledPluginRow ────────────────────────────────────────────────────────

function InstalledPluginRow({ plugin, missingDeps, busy, onUninstall }: {
  plugin: ServicePlugin;
  missingDeps: string[];
  busy?: string;
  onUninstall: () => void;
}) {
  const [showDeps, setShowDeps] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
          <Package className="size-4 text-muted" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{plugin.name}</span>
            <span className={cn("rounded-full border px-1.5 py-px text-[9px] font-medium", SOURCE_BADGE[plugin.source])}>
              {plugin.source}
            </span>
            {missingDeps.length > 0 && (
              <button onClick={() => setShowDeps((v) => !v)}
                className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-medium text-amber-400 hover:bg-amber-500/15 transition-colors">
                <AlertTriangle className="size-2.5" />
                {missingDeps.length} missing dep{missingDeps.length > 1 ? "s" : ""}
              </button>
            )}
          </div>
          <p className="text-[10px] text-subtle">{plugin.jar_filename} · v{plugin.version}</p>
        </div>
        <Button size="sm" variant="ghost" loading={busy === "uninstall"} disabled={!!busy}
          className="text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={onUninstall}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <AnimatePresence>
        {showDeps && missingDeps.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t border-border px-3 py-2.5">
              <p className="text-[10px] font-medium text-amber-400 mb-1.5">Missing dependencies</p>
              <div className="flex flex-wrap gap-1.5">
                {missingDeps.map((dep) => (
                  <span key={dep} className="rounded-full border border-amber-500/25 bg-amber-500/8 px-2 py-0.5 text-[10px] text-amber-300">
                    {dep}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-subtle">
                Search for these plugins and install them to resolve dependency warnings.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

---

## Task 8 — Wire into service detail page

File: `apps/web/src/app/(app)/services/[id]/page.tsx`

### 8a. Import
```ts
import { RustPluginManager } from "@/components/rust-plugin-manager";
```

### 8b. Detect Rust service and add tab

The existing dynamic TABS logic (from `minecraft-plugin-manager.md` Task 6) shows "Plugins" or "Mods" for Minecraft. For Rust, use the same mechanism but detect the framework:

```tsx
const fw = service.config?.environment?.FRAMEWORK ?? "";
const fwLower = fw.toLowerCase();

// Rust: FRAMEWORK is Oxide, Carbon, Carbon-Minimal, Vanilla
const isRust = ["oxide", "carbon", "carbon-minimal", "vanilla"].includes(fwLower);
// Minecraft: FRAMEWORK is Paper, Purpur, Fabric, etc.
const isMinecraft = !isRust && !!fw;

const showRustPluginTab = service.type === "game" && isRust && fwLower !== "vanilla";
const showMcPluginTab = service.type === "game" && isMinecraft;
const pluginTabLabel = isRust ? "Plugins" :
  (["fabric","forge","neoforge","quilt"].includes(fwLower) ? "Mods" : "Plugins");

const TABS = [
  "Overview", "Console", "Terminal", "Logs",
  ...(showRustPluginTab || showMcPluginTab ? [pluginTabLabel as const] : []),
  "Env", "Schedule", "Deployments", "Backups", "Files", "Settings",
] as const;
```

### 8c. Render case
```tsx
{tab === pluginTabLabel && showRustPluginTab && (
  <RustPluginManager service={service} />
)}
{tab === pluginTabLabel && showMcPluginTab && (
  <PluginManager service={service} />
)}
```

---

## Task 9 — Migration file

Create `infra/migrations/012_plugin_deps.sql`:
```sql
ALTER TABLE service_plugins ADD COLUMN IF NOT EXISTS dependencies JSONB NOT NULL DEFAULT '[]';
```

---

## Task 10 — Build verification

```bash
cd apps/api && go build ./...
cd apps/web && npm run build
```

---

## Key constraints

1. **uMod plugins are always free.** No filter needed. All uMod Rust plugins are `.cs` files. Download is direct (`https://umod.org/plugins/PluginName.cs`) with no auth required.

2. **Codefling direct downloads require authentication.** Never attempt to download Codefling files server-side. Always show "Visit Page" (`ExternalLink`) button. Detect and track manually installed Codefling plugins via directory scan.

3. **File extension is `.cs`**, not `.jar`. `sanitizeFilename()` in the Go handler must NOT force-append `.jar` — check for `.cs` extension instead. Update `sanitizeFilename`:
   ```go
   func sanitizeFilenameWithExt(s, expectedExt string) string {
       // clean chars
       s = strings.Map(func(r rune) rune { /* same as before */ }, s)
       if !strings.HasSuffix(strings.ToLower(s), expectedExt) { s += expectedExt }
       return s
   }
   ```
   For Rust plugins, call `sanitizeFilenameWithExt(req.JarFilename, ".cs")`.

4. **Install directories differ by framework:**
   - `FRAMEWORK=Oxide` → `/mnt/server/oxide/plugins/`
   - `FRAMEWORK=Carbon` or `Carbon-Minimal` → `/mnt/server/carbon/plugins/`
   - `FRAMEWORK=Vanilla` → plugin tab is hidden, these endpoints are unreachable

5. **Codefling pagination:** The DB API returns all results for a category at once (no pagination parameter documented). Client-side filtering and limiting apply. The Codefling cache is fast and result sets are manageable (2,596 plugins total).

6. **Update detection for uMod:** Compare `version_id` (SHA1 checksum of the `.cs` file) stored in DB against current checksum from search/JSON API. SHA1 change = new version available, even if version string is unchanged.

7. **Update detection for Codefling:** Compare `version` string stored in DB against `version` from DB API. Show notification only (no auto-download).

8. **Dependency detection only works for uMod plugins** (since we download the .cs file). Codefling plugins installed manually will show empty dependency arrays unless the user also triggers a scan + we parse the file via `FileReadTask` — this is a future enhancement; skip it for now.

9. **Probe Codefling response shape first.** Before writing the full parser, add a log line in dev mode: `slog.Debug("codefling raw", "body", string(resp[:min(500, len(resp))]))`. The `CodeflingPlugin` struct uses `interface{}` for ambiguous fields — after seeing a live response, replace them with concrete types.

10. **`service_plugins` table is shared** between Minecraft and Rust services. The `plugin_dir` column disambiguates install path. No new table is needed.
