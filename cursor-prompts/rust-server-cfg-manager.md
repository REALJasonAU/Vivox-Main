# Vivox — Rust Server.cfg Manager

## Context

Vivox monorepo, same architecture as previous Rust prompts. `FileReadTask`, `FileWriteTask`, and `FileListTask` all work end-to-end through the gRPC stack. The existing `files.Handler` in the agent performs docker exec inside the service container. Service env vars are at `service.config.environment`.

### The cfg file

Rust server reads `/mnt/server/server/{SERVER_IDENTITY}/cfg/server.cfg` at startup.  
`SERVER_IDENTITY` comes from the template env var (default `"rust"` from rust.yaml).  
So the default path is **`/mnt/server/server/rust/cfg/server.cfg`**.

**Format — one setting per line, space-separated:**
```
server.hostname "My Rust Server"
server.maxplayers 100
fps.limit 60
decay.scale 0.5
server.stability true
// this is a comment
# this is also a comment
```

- No `=` signs. Space between key and value.
- String values with spaces must be quoted.
- Boolean: `true`/`false` or `1`/`0` (Rust accepts both; normalise to `true`/`false`).
- Comments: lines beginning with `//` or `#`.
- Blank lines preserved.

### Convars API (live, confirmed shape)

`GET https://api.carbonmod.gg/meta/rust/convars.json` — returns a JSON array (no auth, no key).

Each object:
```json
{
  "Name": "bradleyapc.maxHealth",
  "Help": "Max health of the Bradley APC",
  "Type": "float",
  "Saved": false,
  "ServerAdmin": true,
  "ServerUser": false,
  "Clientside": false,
  "Serverside": true,
  "DefaultValue": 1000.0
}
```

Types observed: `"bool"`, `"int"`, `"float"`, `"string"`, `"System.Int64"`, `"UnityEngine.Vector3"`.  
All 301 entries are `"ServerAdmin": true, "Serverside": true`.  
**Important:** The common vanilla admin convars (`server.hostname`, `fps.limit`, `decay.scale`, etc.) are **NOT in this API**. They must be hardcoded in a supplemental list (see Task 3).

---

## What to build

A **"Config" tab** on the Rust service detail page that lets the user:
- Read and visually edit `server.cfg`
- Browse all available convars grouped by category (prefix before the dot)
- Search convars by name or description
- See default values and highlight entries that differ from defaults
- Add any convar from a picker even if it's not currently in the file
- Edit values inline (toggle for bool, number input for int/float, text for string)
- See a "raw" text editor as a toggle
- Save writes the file back to the container via `FileWriteTask`
- Auto-detect the file path with fallback logic

---

## Task 1 — Go API: server.cfg endpoints

Add to `apps/api/cmd/api/` — new file `cfg_handlers.go`.

Register routes alongside service routes:
```go
svc.Get("/:id/cfg", cfgReadHandler)
svc.Put("/:id/cfg", cfgWriteHandler)
svc.Get("/:id/cfg/convars", cfgConvarsHandler)
```

All three routes must apply the same auth + service-ownership middleware as other service routes.

```go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "strings"
    "sync"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
    "github.com/nexus-control/apps/api/internal/commands"
    "github.com/nexus-control/apps/api/internal/db"
    filestrack "github.com/nexus-control/apps/api/internal/files"
    grpcsrv "github.com/nexus-control/apps/api/internal/grpc"
    gen "github.com/nexus-control/packages/proto/gen"
)

// ─── Convar cache ─────────────────────────────────────────────────────────────

type convarCache struct {
    mu      sync.RWMutex
    data    []byte
    fetchAt time.Time
    ttl     time.Duration
}

var globalConvarCache = &convarCache{ttl: time.Hour}

func (c *convarCache) get() ([]byte, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    if len(c.data) == 0 || time.Since(c.fetchAt) > c.ttl { return nil, false }
    return c.data, true
}
func (c *convarCache) set(data []byte) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data = data
    c.fetchAt = time.Now()
}

// cfgConvarsHandler proxies https://api.carbonmod.gg/meta/rust/convars.json with 1h cache.
func cfgConvarsHandler(c *fiber.Ctx) error {
    if cached, ok := globalConvarCache.get(); ok {
        c.Set("Content-Type", "application/json")
        return c.Send(cached)
    }
    resp, err := (&http.Client{Timeout: 10 * time.Second}).Get("https://api.carbonmod.gg/meta/rust/convars.json")
    if err != nil { return c.Status(502).JSON(fiber.Map{"error": "upstream unavailable"}) }
    defer resp.Body.Close()
    data, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
    if err != nil { return c.Status(502).JSON(fiber.Map{"error": "read failed"}) }
    globalConvarCache.set(data)
    c.Set("Content-Type", "application/json")
    return c.Send(data)
}

// ─── Path resolution ──────────────────────────────────────────────────────────

// candidateCfgPaths returns ordered candidate paths to try for server.cfg.
// identity comes from the service's SERVER_IDENTITY env var (default "rust").
func candidateCfgPaths(identity string) []string {
    if identity == "" { identity = "rust" }
    return []string{
        fmt.Sprintf("/mnt/server/server/%s/cfg/server.cfg", identity),
        "/mnt/server/server/rust/cfg/server.cfg",    // hardcoded fallback
        "/mnt/server/cfg/server.cfg",                // alternative layout
        "/mnt/server/server.cfg",                    // flat layout
    }
}

// readFileFromAgent sends a FileReadTask to the agent and waits for the result.
// Returns content bytes and nil error on success, or nil + error if file not found.
func readFileFromAgent(ctx context.Context, serviceID, nodeID, path string,
    reg *grpcsrv.Registry, files *filestrack.Tracker) ([]byte, error) {

    cmdID := uuid.New().String()
    err := reg.Send(nodeID, &gen.DownstreamEnvelope{
        CommandId: cmdID,
        Action: &gen.DownstreamEnvelope_ReadFile{ReadFile: &gen.FileReadTask{
            ServiceId: serviceID,
            Path:      path,
        }},
    })
    if err != nil { return nil, err }
    return files.WaitRead(ctx, cmdID)
}

// listDirFromAgent sends a FileListTask and waits for the result.
func listDirFromAgent(ctx context.Context, serviceID, nodeID, path string,
    reg *grpcsrv.Registry, files *filestrack.Tracker) ([]*gen.FileEntry, error) {

    cmdID := uuid.New().String()
    err := reg.Send(nodeID, &gen.DownstreamEnvelope{
        CommandId: cmdID,
        Action: &gen.DownstreamEnvelope_ListFiles{ListFiles: &gen.FileListTask{
            ServiceId: serviceID,
            Path:      path,
        }},
    })
    if err != nil { return nil, err }
    return files.WaitList(ctx, cmdID)
}

// ─── Read handler ─────────────────────────────────────────────────────────────

type CfgReadResponse struct {
    Path    string `json:"path"`
    Content string `json:"content"`
    Found   bool   `json:"found"`
}

func cfgReadHandler(c *fiber.Ctx, q *db.Queries, reg *grpcsrv.Registry, files *filestrack.Tracker) error {
    svcID, err := uuid.Parse(c.Params("id"))
    if err != nil { return fiber.ErrBadRequest }

    svc, err := q.GetService(c.Context(), svcID)
    if err != nil { return fiber.ErrNotFound }
    if svc.NodeID == "" { return c.Status(503).JSON(fiber.Map{"error": "service not assigned to a node"}) }

    identity := svc.Config.Environment["SERVER_IDENTITY"]
    candidates := candidateCfgPaths(identity)

    ctx, cancel := context.WithTimeout(c.Context(), 10*time.Second)
    defer cancel()

    // Try candidates in order
    for _, path := range candidates {
        data, err := readFileFromAgent(ctx, svcID.String(), svc.NodeID, path, reg, files)
        if err == nil {
            return c.JSON(CfgReadResponse{Path: path, Content: string(data), Found: true})
        }
    }

    // Not found anywhere — search /mnt/server/ tree (one level deep) for *.cfg files
    entries, err := listDirFromAgent(ctx, svcID.String(), svc.NodeID, "/mnt/server/server/", reg, files)
    if err == nil {
        for _, e := range entries {
            if e.IsDir {
                subEntries, err := listDirFromAgent(ctx, svcID.String(), svc.NodeID,
                    "/mnt/server/server/"+e.Name+"/cfg/", reg, files)
                if err == nil {
                    for _, f := range subEntries {
                        if f.Name == "server.cfg" {
                            path := "/mnt/server/server/" + e.Name + "/cfg/server.cfg"
                            data, err := readFileFromAgent(ctx, svcID.String(), svc.NodeID, path, reg, files)
                            if err == nil {
                                return c.JSON(CfgReadResponse{Path: path, Content: string(data), Found: true})
                            }
                        }
                    }
                }
            }
        }
    }

    // File not found anywhere — return default path so frontend knows where to create it
    defaultPath := fmt.Sprintf("/mnt/server/server/%s/cfg/server.cfg", func() string {
        if identity != "" { return identity }
        return "rust"
    }())
    return c.JSON(CfgReadResponse{Path: defaultPath, Content: "", Found: false})
}

// ─── Write handler ────────────────────────────────────────────────────────────

type CfgWriteRequest struct {
    Path    string `json:"path"`
    Content string `json:"content"`
}

func cfgWriteHandler(c *fiber.Ctx, q *db.Queries, reg *grpcsrv.Registry, tracker *commands.Tracker) error {
    svcID, err := uuid.Parse(c.Params("id"))
    if err != nil { return fiber.ErrBadRequest }

    var req CfgWriteRequest
    if err := c.BodyParser(&req); err != nil { return fiber.ErrBadRequest }
    if req.Path == "" || !strings.HasPrefix(req.Path, "/mnt/server/") {
        return c.Status(400).JSON(fiber.Map{"error": "invalid path"})
    }

    svc, err := q.GetService(c.Context(), svcID)
    if err != nil { return fiber.ErrNotFound }

    // Ensure parent directory exists by writing a .vivox-cfgdir marker first.
    // Actually: agent WriteFile should create parent dirs — check WriteFile in
    // apps/agent/internal/files/files.go. If it doesn't, add mkdir -p before the write:
    //
    //   dir := req.Path[:strings.LastIndex(req.Path, "/")]
    //   mkdirCmd := "mkdir -p " + dir
    //   _ run exec in container (use existing exec path or add a simple shell exec helper)
    //
    // For simplicity, the WriteFile implementation MUST be updated to create parent dirs:
    // In apps/agent/internal/files/files.go, WriteFile should run:
    //   "sh", "-c", fmt.Sprintf("mkdir -p '%s' && cat > '%s'", dir, path)
    // See Task 2 for details.

    cmdID := uuid.New().String()
    err = reg.Send(svc.NodeID, &gen.DownstreamEnvelope{
        CommandId: cmdID,
        Action: &gen.DownstreamEnvelope_WriteFile{WriteFile: &gen.FileWriteTask{
            ServiceId: svcID.String(),
            Path:      req.Path,
            Content:   []byte(req.Content),
        }},
    })
    if err != nil { return c.Status(503).JSON(fiber.Map{"error": "agent offline"}) }

    ctx, cancel := context.WithTimeout(c.Context(), 10*time.Second)
    defer cancel()
    if ok, errMsg := tracker.Wait(ctx, cmdID); !ok {
        return c.Status(502).JSON(fiber.Map{"error": "write failed: " + errMsg})
    }

    return c.JSON(fiber.Map{"path": req.Path, "ok": true})
}
```

---

## Task 2 — Agent: ensure `WriteFile` creates parent directories

File: `apps/agent/internal/files/files.go`

Check the current `WriteFile` implementation. If it uses a simple `docker exec ... cat > path` without a `mkdir -p`, update it to create parent directories first:

```go
// WriteFile writes content to path inside the service container.
// Creates parent directories if they don't exist.
func (h *Handler) WriteFile(ctx context.Context, serviceID, path string, content []byte) error {
    dir := path[:strings.LastIndex(path, "/")]
    if dir == "" { dir = "/" }
    
    // Step 1: ensure directory exists
    if _, err := h.exec(ctx, serviceID, "sh", "-c", fmt.Sprintf("mkdir -p '%s'", dir)); err != nil {
        return fmt.Errorf("mkdir: %w", err)
    }
    // Step 2: write file content via stdin pipe through docker exec
    // (check how the current implementation pipes content — adapt accordingly)
    // ...existing write logic, unchanged...
}
```

If the current implementation already creates parent dirs, skip this task.

---

## Task 3 — Frontend: types + API client additions

### 3a. Add to `apps/web/src/lib/types.ts`

```ts
export interface RustConvar {
  Name: string;
  Help: string | null;
  Type: "bool" | "int" | "float" | "string" | "System.Int64" | "UnityEngine.Vector3";
  Saved: boolean;
  ServerAdmin: boolean;
  ServerUser: boolean;
  Clientside: boolean;
  Serverside: boolean;
  DefaultValue: string | number | boolean | null;
}

export interface ServerCfgResponse {
  path: string;
  content: string;
  found: boolean;
}
```

### 3b. Add to `servicesApi` in `apps/web/src/lib/api.ts`

```ts
readServerCfg: (id: string) =>
  apiFetch<ServerCfgResponse>(`/services/${id}/cfg`),

writeServerCfg: (id: string, path: string, content: string) =>
  apiFetch<{ path: string; ok: boolean }>(`/services/${id}/cfg`, {
    method: "PUT",
    body: { path, content },
  }),

getConvars: (id: string) =>
  apiFetch<RustConvar[]>(`/services/${id}/cfg/convars`),
```

---

## Task 4 — Frontend: hardcoded vanilla convars

These are NOT in the Carbon API but are important for server administration. Create `apps/web/src/lib/rust-vanilla-convars.ts`:

```ts
import type { RustConvar } from "./types";

// Core Rust server convars not included in the Carbon API.
// These are the most commonly configured server settings.
export const VANILLA_CONVARS: RustConvar[] = [
  // ── Performance ────────────────────────────────────────────────────────────
  { Name: "fps.limit",            Help: "Server frame-rate cap. 30=saves CPU, 60=recommended, 256=max.",           Type: "int",   Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 60 },
  { Name: "server.compression",   Help: "Network packet compression level (0–6). Higher = less bandwidth, more CPU.", Type: "int",   Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 4 },
  { Name: "server.netcache",      Help: "Size of the server-side network object cache.",                             Type: "int",   Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 20 },
  // ── Persistence ───────────────────────────────────────────────────────────
  { Name: "server.saveinterval",  Help: "How often the world saves to disk (seconds).",                              Type: "int",   Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 600 },
  // ── Gameplay ──────────────────────────────────────────────────────────────
  { Name: "server.pve",           Help: "Enable PvE mode — players cannot damage other players.",                   Type: "bool",  Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: false },
  { Name: "server.stability",     Help: "Enable structural stability system for buildings.",                         Type: "bool",  Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: true },
  { Name: "server.radiation",     Help: "Enable radiation zones on the map.",                                        Type: "bool",  Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: true },
  { Name: "server.itemdespawn",   Help: "Seconds before dropped items despawn.",                                     Type: "float", Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 600 },
  { Name: "server.corpsedespawn", Help: "Seconds before player corpses despawn.",                                    Type: "float", Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 300 },
  { Name: "server.playerservertimeout", Help: "Seconds before an idle player is kicked.",                           Type: "float", Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 60 },
  // ── Decay ─────────────────────────────────────────────────────────────────
  { Name: "decay.scale",          Help: "Global decay multiplier. 0=off, 0.5=half speed, 1=normal, 2=double.",      Type: "float", Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 1.0 },
  { Name: "decay.upkeep",         Help: "Enable the building upkeep system (Tool Cupboard resources).",             Type: "bool",  Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: true },
  { Name: "decay.deploy_maxhealth_after_decay_sec", Help: "Seconds of decay before a building reaches max decay.",  Type: "float", Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 288000 },
  // ── Events ────────────────────────────────────────────────────────────────
  { Name: "server.events",        Help: "Enable in-game events such as helicopter and cargo ship.",                  Type: "bool",  Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: true },
  { Name: "server.airdropfrequency", Help: "Airdrop call frequency (lower = more frequent).",                       Type: "float", Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 2 },
  { Name: "server.airdropspeed",  Help: "Speed of the airdrop supply plane.",                                        Type: "float", Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 25 },
  // ── Chat ──────────────────────────────────────────────────────────────────
  { Name: "server.globalchat",    Help: "Enable global chat (all players see all messages).",                        Type: "bool",  Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: true },
  { Name: "chat.serverlog",       Help: "Log all player chat to the server console.",                                Type: "bool",  Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: true },
  // ── Anticheat ─────────────────────────────────────────────────────────────
  { Name: "antihack.enabled",     Help: "Enable the server-side anticheat system.",                                  Type: "bool",  Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: true },
  { Name: "antihack.speedhackdesync", Help: "Max speed desync (units/sec) allowed before flagging as speed hack.", Type: "float", Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 10 },
  { Name: "antihack.flyhack_protection", Help: "Fly-hack protection level (0=off, 6=strict).",                     Type: "int",   Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 6 },
  { Name: "antihack.noclip_protection", Help: "No-clip protection level (0=off, 4=strict).",                       Type: "int",   Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 4 },
  // ── Environment ───────────────────────────────────────────────────────────
  { Name: "env.time",             Help: "Current in-game time of day (0–24).",                                       Type: "float", Saved: false, ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 12 },
  { Name: "env.timescale",        Help: "Speed of time passing. 1=normal, 0.5=half speed.",                         Type: "float", Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: 1.0 },
  { Name: "env.progresstime",     Help: "Whether time progresses automatically.",                                    Type: "bool",  Saved: true,  ServerAdmin: true, ServerUser: false, Clientside: false, Serverside: true, DefaultValue: true },
];
```

---

## Task 5 — Frontend: cfg parser utilities

Create `apps/web/src/lib/rust-cfg-parser.ts`:

```ts
import type { RustConvar } from "./types";

export interface CfgEntry {
  key: string;
  value: string;
  rawLine: string;  // original line for round-trip fidelity
  isComment: boolean;
  isBlank: boolean;
}

/** Parse a server.cfg string into structured entries. */
export function parseCfg(content: string): CfgEntry[] {
  return content.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return { key: "", value: "", rawLine: line, isComment: false, isBlank: true };
    if (trimmed.startsWith("//") || trimmed.startsWith("#"))
      return { key: trimmed, value: "", rawLine: line, isComment: true, isBlank: false };
    // Split on first whitespace
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx === -1)
      return { key: trimmed, value: "", rawLine: line, isComment: false, isBlank: false };
    const key = trimmed.slice(0, spaceIdx);
    const value = trimmed.slice(spaceIdx + 1).trim();
    return { key, value, rawLine: line, isComment: false, isBlank: false };
  });
}

/** Serialise entries back to server.cfg string. */
export function serialiseCfg(entries: CfgEntry[]): string {
  return entries.map((e) => {
    if (e.isBlank) return "";
    if (e.isComment) return e.key;
    const v = e.value;
    // Quote strings that contain spaces and aren't already quoted
    const needsQuotes = typeof v === "string" && v.includes(" ") && !v.startsWith('"');
    return `${e.key} ${needsQuotes ? `"${v}"` : v}`;
  }).join("\n");
}

/** Merge an edited set of key→value pairs back into existing entries.
 *  Preserves existing comments and blank lines.
 *  Appends new keys at the end if they weren't already in the file. */
export function mergeEditsIntoCfg(
  entries: CfgEntry[],
  edits: Record<string, string>,
  deletedKeys: Set<string>,
): CfgEntry[] {
  const handled = new Set<string>();
  const result: CfgEntry[] = [];

  for (const entry of entries) {
    if (entry.isBlank || entry.isComment) { result.push(entry); continue; }
    if (deletedKeys.has(entry.key)) continue;
    if (entry.key in edits) {
      result.push({ ...entry, value: edits[entry.key], rawLine: `${entry.key} ${edits[entry.key]}` });
      handled.add(entry.key);
    } else {
      result.push(entry);
    }
  }

  // Append new keys not already present
  for (const [key, value] of Object.entries(edits)) {
    if (!handled.has(key)) {
      result.push({ key, value, rawLine: `${key} ${value}`, isComment: false, isBlank: false });
    }
  }

  return result;
}

/** Convert a convar's DefaultValue to a normalised string for comparison. */
export function defaultValueStr(convar: RustConvar): string {
  const v = convar.DefaultValue;
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/** Return true if value differs from convar default. */
export function isModified(value: string, convar: RustConvar): boolean {
  const def = defaultValueStr(convar);
  if (!def) return false;
  // Normalise booleans
  const normValue = value.toLowerCase() === "1" ? "true" : value.toLowerCase() === "0" ? "false" : value.toLowerCase();
  const normDef = def.toLowerCase();
  return normValue !== normDef;
}

/** Group convars by the prefix before the first dot. */
export function groupConvarsByCategory(convars: RustConvar[]): Record<string, RustConvar[]> {
  const groups: Record<string, RustConvar[]> = {};
  for (const cv of convars) {
    const dotIdx = cv.Name.indexOf(".");
    const category = dotIdx > -1 ? cv.Name.slice(0, dotIdx) : "misc";
    if (!groups[category]) groups[category] = [];
    groups[category].push(cv);
  }
  return groups;
}

/** Pretty-print a category key: "bradleyapc" → "Bradley APC" */
export function prettyCategoryName(key: string): string {
  const overrides: Record<string, string> = {
    bradleyapc: "Bradley APC",
    cargoship: "Cargo Ship",
    patrolhelicopterai: "Patrol Helicopter",
    npcvendingmachine: "NPC Vending Machine",
    hackablelockedcrate: "Hackable Crate",
    ioentity: "Electrical",
    hotairballoon: "Hot Air Balloon",
    motorrowboat: "Rowboat",
    basesubmarine: "Submarine",
    ridablehorse: "Horse",
    snowmobile: "Snowmobile",
    playerboat: "Player Boat",
    traincar: "Train",
    treemanager: "Trees",
    relationshipmanager: "Clans / Teams",
    wipetimer: "Wipe Timer",
    // vanilla
    fps: "Performance",
    server: "Server",
    decay: "Decay",
    env: "Environment",
    antihack: "Anti-Cheat",
    chat: "Chat",
  };
  if (key in overrides) return overrides[key];
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/([a-z])([A-Z])/g, "$1 $2");
}
```

---

## Task 6 — Frontend: `ServerCfgEditor` component

Create `apps/web/src/components/server-cfg-editor.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileCode2, Save, Search, AlertCircle, CheckCircle2,
  ChevronDown, ChevronRight, Plus, Trash2, ToggleLeft,
  ToggleRight, Info, Eye, EyeOff, Loader2, RefreshCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { servicesApi } from "@/lib/api";
import type { Service, RustConvar } from "@/lib/types";
import { VANILLA_CONVARS } from "@/lib/rust-vanilla-convars";
import {
  parseCfg, serialiseCfg, mergeEditsIntoCfg, isModified,
  defaultValueStr, groupConvarsByCategory, prettyCategoryName,
  type CfgEntry,
} from "@/lib/rust-cfg-parser";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props { service: Service; }

// ── Main component ────────────────────────────────────────────────────────────

export function ServerCfgEditor({ service }: Props) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [cfgPath, setCfgPath]       = useState<string>("");
  const [entries, setEntries]       = useState<CfgEntry[]>([]);
  const [convars, setConvars]       = useState<RustConvar[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [rawMode, setRawMode]       = useState(false);
  const [rawContent, setRawContent] = useState("");
  const [dirty, setDirty]           = useState(false);
  const [search, setSearch]         = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["server", "fps", "decay", "env"]));
  const [addingConvar, setAddingConvar] = useState(false);
  const [addQuery, setAddQuery]     = useState("");

  // All convars = vanilla (hardcoded) + API convars
  const allConvars = useMemo(() => [...VANILLA_CONVARS, ...convars], [convars]);

  // Map name → convar for lookups
  const convarMap = useMemo(() => {
    const m: Record<string, RustConvar> = {};
    for (const cv of allConvars) m[cv.Name] = cv;
    return m;
  }, [allConvars]);

  // Map of current key → value from entries
  const currentValues = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of entries) if (!e.isComment && !e.isBlank) m[e.key] = e.value;
    return m;
  }, [entries]);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, convarsRes] = await Promise.all([
        servicesApi.readServerCfg(service.id),
        servicesApi.getConvars(service.id).catch(() => [] as RustConvar[]),
      ]);
      setCfgPath(cfgRes.path);
      const parsed = parseCfg(cfgRes.content);
      setEntries(parsed);
      setRawContent(cfgRes.content);
      // Only use API convars that are serverside + serveradmin; exclude duplicates of vanilla list
      const vanillaNames = new Set(VANILLA_CONVARS.map((v) => v.Name));
      setConvars((convarsRes ?? []).filter(
        (cv) => cv.Serverside && cv.ServerAdmin && !vanillaNames.has(cv.Name)
      ));
      setDirty(false);
    } catch (e) {
      toast("Failed to load server.cfg", "error");
    } finally {
      setLoading(false);
    }
  }, [service.id]);

  useEffect(() => { void load(); }, [load]);

  // ── Sync raw ↔ structured ─────────────────────────────────────────────────
  const switchToRaw = () => {
    setRawContent(serialiseCfg(entries));
    setRawMode(true);
  };
  const switchToVisual = () => {
    setEntries(parseCfg(rawContent));
    setRawMode(false);
  };

  // ── Edit handlers ─────────────────────────────────────────────────────────
  const handleValueChange = (key: string, value: string) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.key === key);
      if (idx === -1) {
        return [...prev, { key, value, rawLine: `${key} ${value}`, isComment: false, isBlank: false }];
      }
      return prev.map((e, i) =>
        i === idx ? { ...e, value, rawLine: `${key} ${value}` } : e
      );
    });
    setDirty(true);
  };

  const handleRemoveKey = (key: string) => {
    setEntries((prev) => prev.filter((e) => e.key !== key));
    setDirty(true);
  };

  const handleAddConvar = (cv: RustConvar) => {
    if (currentValues[cv.Name] !== undefined) {
      toast(`${cv.Name} is already in the config`, "info");
      setAddingConvar(false);
      return;
    }
    const defVal = defaultValueStr(cv) || "";
    setEntries((prev) => [
      ...prev,
      { key: cv.Name, value: defVal, rawLine: `${cv.Name} ${defVal}`, isComment: false, isBlank: false },
    ]);
    setDirty(true);
    setAddingConvar(false);
    setAddQuery("");
    // Expand the category this convar belongs to
    const cat = cv.Name.split(".")[0];
    setExpandedCategories((prev) => new Set([...prev, cat]));
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const content = rawMode ? rawContent : serialiseCfg(entries);
      await servicesApi.writeServerCfg(service.id, cfgPath, content);
      toast("server.cfg saved", "success");
      setDirty(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Categories for visual editor ──────────────────────────────────────────
  const grouped = useMemo(() => groupConvarsByCategory(allConvars), [allConvars]);

  // Which categories have entries currently in cfg or match search?
  const searchLower = search.toLowerCase();
  const activeCategories = useMemo(() => {
    return Object.entries(grouped).filter(([, cvs]) => {
      return cvs.some((cv) => {
        const inCfg = currentValues[cv.Name] !== undefined;
        const matchesSearch = !searchLower ||
          cv.Name.toLowerCase().includes(searchLower) ||
          (cv.Help ?? "").toLowerCase().includes(searchLower);
        return inCfg || matchesSearch;
      });
    });
  }, [grouped, currentValues, searchLower]);

  // Convars available to add (not already in cfg, matches add query)
  const addableConvars = useMemo(() => {
    const q = addQuery.toLowerCase();
    return allConvars.filter(
      (cv) => currentValues[cv.Name] === undefined &&
        (!q || cv.Name.toLowerCase().includes(q) || (cv.Help ?? "").toLowerCase().includes(q))
    ).slice(0, 40);
  }, [allConvars, currentValues, addQuery]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode2 className="size-4 shrink-0 text-muted" />
          <span className="truncate font-mono text-xs text-muted">{cfgPath}</span>
          {dirty && (
            <span className="ml-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-px text-[10px] text-amber-400">
              unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { if (rawMode) switchToVisual(); else switchToRaw(); }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
              rawMode
                ? "border-vivox-500/40 bg-vivox-500/15 text-vivox-400"
                : "border-border bg-background text-muted hover:text-foreground",
            )}
          >
            {rawMode ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            {rawMode ? "Visual" : "Raw"}
          </button>
          <Button size="sm" variant="ghost" loading={loading} onClick={() => void load()} title="Reload from server">
            <RefreshCcw className="size-3.5" />
          </Button>
          <Button size="sm" disabled={!dirty} loading={saving} onClick={() => void handleSave()}>
            <Save className="size-3.5" /> Save
          </Button>
        </div>
      </div>

      {/* ── Raw editor ─────────────────────────────────────────────────────── */}
      {rawMode && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="border-b border-border px-3 py-2 text-xs text-muted">
            Raw editor — one setting per line: <code className="text-foreground">key value</code>
          </div>
          <textarea
            value={rawContent}
            onChange={(e) => { setRawContent(e.target.value); setDirty(true); }}
            className="h-[500px] w-full resize-none bg-background p-3 font-mono text-xs text-foreground focus:outline-none"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      )}

      {/* ── Visual editor ──────────────────────────────────────────────────── */}
      {!rawMode && (
        <>
          {/* Search + Add */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search convars..."
                className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-subtle focus:border-vivox-500/50 focus:outline-none"
              />
            </div>
            <Button size="sm" variant="secondary" onClick={() => setAddingConvar((v) => !v)}>
              <Plus className="size-3.5" /> Add convar
            </Button>
          </div>

          {/* Add convar picker */}
          <AnimatePresence>
            {addingConvar && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="rounded-xl border border-border bg-surface p-3">
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
                    <input
                      autoFocus
                      value={addQuery}
                      onChange={(e) => setAddQuery(e.target.value)}
                      placeholder="Search all convars to add..."
                      className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-subtle focus:border-vivox-500/50 focus:outline-none"
                    />
                  </div>
                  <div className="max-h-64 overflow-y-auto flex flex-col gap-px">
                    {addableConvars.length === 0 && (
                      <p className="py-4 text-center text-xs text-muted">No matching convars</p>
                    )}
                    {addableConvars.map((cv) => (
                      <button
                        key={cv.Name}
                        onClick={() => handleAddConvar(cv)}
                        className="flex items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-background transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-xs font-medium text-foreground">{cv.Name}</p>
                          {cv.Help && <p className="mt-0.5 text-[10px] text-muted line-clamp-1">{cv.Help}</p>}
                        </div>
                        <span className="shrink-0 rounded border border-border px-1.5 py-px text-[9px] text-subtle">
                          {defaultValueStr(cv) || "—"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Category sections */}
          {activeCategories.length === 0 && search && (
            <div className="py-10 text-center text-sm text-muted">
              No convars match &ldquo;{search}&rdquo;.
            </div>
          )}
          {activeCategories.map(([category, cvs]) => {
            const isExpanded = expandedCategories.has(category);
            const inCfgCount = cvs.filter((cv) => currentValues[cv.Name] !== undefined).length;
            const modifiedCount = cvs.filter((cv) => {
              const v = currentValues[cv.Name];
              return v !== undefined && isModified(v, cv);
            }).length;

            // Filter cvs for display
            const displayCvs = cvs.filter((cv) => {
              const inCfg = currentValues[cv.Name] !== undefined;
              const matches = !searchLower ||
                cv.Name.toLowerCase().includes(searchLower) ||
                (cv.Help ?? "").toLowerCase().includes(searchLower);
              return inCfg || (searchLower && matches);
            });

            if (displayCvs.length === 0) return null;

            return (
              <div key={category} className="rounded-xl border border-border bg-surface overflow-hidden">
                {/* Category header */}
                <button
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-background/50 transition-colors"
                  onClick={() => setExpandedCategories((prev) => {
                    const next = new Set(prev);
                    if (next.has(category)) next.delete(category);
                    else next.add(category);
                    return next;
                  })}
                >
                  {isExpanded
                    ? <ChevronDown className="size-4 shrink-0 text-muted" />
                    : <ChevronRight className="size-4 shrink-0 text-muted" />}
                  <span className="font-medium text-sm text-foreground">{prettyCategoryName(category)}</span>
                  <span className="text-[10px] text-subtle">
                    {inCfgCount} / {cvs.length} set
                  </span>
                  {modifiedCount > 0 && (
                    <span className="rounded-full border border-amber-500/25 bg-amber-500/8 px-1.5 py-px text-[9px] text-amber-400">
                      {modifiedCount} modified
                    </span>
                  )}
                </button>

                {/* Convar rows */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-border">
                        {displayCvs.map((cv) => (
                          <ConvarRow
                            key={cv.Name}
                            convar={cv}
                            value={currentValues[cv.Name]}
                            onValueChange={(v) => handleValueChange(cv.Name, v)}
                            onRemove={() => handleRemoveKey(cv.Name)}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {/* Unrecognised entries (in cfg but not in convarMap) */}
          {(() => {
            const unknown = entries.filter(
              (e) => !e.isComment && !e.isBlank && !convarMap[e.key]
            );
            if (unknown.length === 0) return null;
            return (
              <div className="rounded-xl border border-border bg-surface overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <AlertCircle className="size-4 text-amber-400" />
                  <span className="text-sm font-medium text-foreground">Unknown / Custom</span>
                  <span className="text-[10px] text-subtle">{unknown.length} entries not in convar list</span>
                </div>
                {unknown.map((e) => (
                  <div key={e.key} className="flex items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
                    <span className="font-mono text-xs text-foreground flex-1">{e.key}</span>
                    <input
                      value={e.value}
                      onChange={(ev) => handleValueChange(e.key, ev.target.value)}
                      className="w-48 rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:border-vivox-500/50 focus:outline-none"
                    />
                    <button onClick={() => handleRemoveKey(e.key)}
                      className="text-muted hover:text-red-400 transition-colors">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

// ── ConvarRow ─────────────────────────────────────────────────────────────────

function ConvarRow({ convar, value, onValueChange, onRemove }: {
  convar: RustConvar;
  value: string | undefined;
  onValueChange: (v: string) => void;
  onRemove: () => void;
}) {
  const isSet = value !== undefined;
  const modified = isSet && isModified(value, convar);
  const defVal = defaultValueStr(convar);

  return (
    <div className={cn(
      "flex items-start gap-3 border-t border-border/60 px-4 py-2.5 first:border-t-0 transition-colors",
      modified ? "bg-amber-500/3" : "",
      !isSet ? "opacity-50" : "",
    )}>
      {/* Name + Help */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("font-mono text-xs font-medium", modified ? "text-amber-300" : "text-foreground")}>
            {convar.Name}
          </span>
          {modified && (
            <span className="text-[9px] text-amber-400/70">
              default: {defVal}
            </span>
          )}
        </div>
        {convar.Help && (
          <p className="mt-0.5 text-[10px] text-subtle leading-relaxed">{convar.Help}</p>
        )}
      </div>

      {/* Input */}
      <div className="flex shrink-0 items-center gap-2">
        {!isSet ? (
          <button
            onClick={() => onValueChange(defVal)}
            className="rounded border border-dashed border-border px-2 py-1 text-[10px] text-subtle hover:text-foreground hover:border-border/80 transition-colors"
          >
            + add
          </button>
        ) : convar.Type === "bool" ? (
          <button
            onClick={() => onValueChange(value === "true" || value === "1" ? "false" : "true")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors",
              (value === "true" || value === "1")
                ? "border-vivox-500/40 bg-vivox-500/15 text-vivox-400"
                : "border-border bg-background text-muted",
            )}
          >
            {(value === "true" || value === "1")
              ? <ToggleRight className="size-4" />
              : <ToggleLeft className="size-4" />}
            {(value === "true" || value === "1") ? "true" : "false"}
          </button>
        ) : convar.Type === "int" || convar.Type === "float" || convar.Type === "System.Int64" ? (
          <input
            type="number"
            value={value}
            step={convar.Type === "float" ? "0.1" : "1"}
            onChange={(e) => onValueChange(e.target.value)}
            className="w-28 rounded border border-border bg-background px-2 py-1 text-right font-mono text-xs text-foreground focus:border-vivox-500/50 focus:outline-none"
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            className="w-48 rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:border-vivox-500/50 focus:outline-none"
          />
        )}

        {isSet && (
          <button onClick={onRemove} title="Remove from cfg"
            className="text-muted hover:text-red-400 transition-colors">
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
```

---

## Task 7 — Wire tab into service detail page

File: `apps/web/src/app/(app)/services/[id]/page.tsx`

### 7a. Import
```ts
import { ServerCfgEditor } from "@/components/server-cfg-editor";
```

### 7b. Add "Config" tab for Rust services (add alongside existing TABS logic)

```tsx
// Add "Config" to TABS when it's a Rust game service
const TABS = [
  "Overview", "Console", "Terminal", "Logs",
  ...(showRustPluginTab ? ["Plugins" as const] : []),
  ...(showMcPluginTab ? [pluginTabLabel as const] : []),
  ...(isRust && fwLower !== "vanilla" ? ["Config" as const] : []),
  "Env", "Schedule", "Deployments", "Backups", "Files", "Settings",
] as const;
```

### 7c. Render case (add alongside other tab cases)
```tsx
{tab === "Config" && isRust && <ServerCfgEditor service={service} />}
```

---

## Task 8 — Build verification

```bash
cd apps/api && go build ./...
cd apps/web && npm run build
```

---

## Key constraints

1. **Path security:** In `cfgWriteHandler`, reject any path that doesn't start with `/mnt/server/`. Prevents path traversal.

2. **The convars API includes ~301 game-object convars but NOT vanilla server convars** (`fps.limit`, `decay.scale`, `server.pve`, etc.). The `VANILLA_CONVARS` list in Task 4 provides those. Both lists are merged in the component.

3. **`UnityEngine.Vector3` type:** Treat as `"string"` input in the UI — these are `x y z` space-separated values. Just show a plain text input.

4. **File not found → create path:** When `cfgReadHandler` returns `found: false`, the component starts with an empty config. On first save, `cfgWriteHandler` writes to the `defaultPath`. The agent's `WriteFile` **must create parent directories** (Task 2) — this is essential since `/mnt/server/server/rust/cfg/` may not exist on a fresh server.

5. **Round-trip fidelity:** The visual editor uses `serialiseCfg(entries)` which reconstructs the file from structured entries. Comments and blank lines in the original file are preserved as `isComment`/`isBlank` entries. When the user switches to raw mode and back, the raw text is re-parsed, so custom comments they added in raw mode are kept.

6. **Dirty state:** The `dirty` flag gates the Save button. It is set on any edit (visual or raw) and cleared on successful save or reload.

7. **Tab label:** The tab is called "Config" — distinct from "Env" (which edits environment variables for the container). Config = server.cfg inside the container. Env = container environment variables in the Vivox DB.

8. **Cache:** The convars proxy caches for 1 hour server-side. The response is also small enough (~90KB) to cache in the frontend's React state for the lifetime of the component — no need to re-fetch on every tab switch.

9. **`files.Tracker.WaitRead`:** The `cfgReadHandler` uses `files.WaitRead(ctx, cmdID)` — verify this method exists on `filestrack.Tracker` in `apps/api/internal/files/tracker.go`. If it's named differently (e.g., `WaitFileRead`), use the correct name. Look at how the existing file manager handlers read files for the correct call pattern.
