# Vivox — Advanced Minecraft Framework Switcher

## Context

You're in the Vivox monorepo (`go.work` workspace: `apps/api`, `apps/agent`, `apps/web`, `packages/proto`, `packages/domain`). Templates live in `/templates/*.yaml` and are loaded by `apps/api/internal/service/templates.go`. The agent runs `install_script` in a separate installer container that mounts `vivox-data-{serviceId}` at `/mnt/server`. A `.vivox-installed` marker prevents reinstall on normal start. The reinstall endpoint (`POST /services/:id/reinstall`) deletes the marker and re-dispatches the install job — the server JAR/framework files are wiped, but world data in `/mnt/server/world/` is untouched.

### Existing API shape (do not change these signatures)

`apps/web/src/lib/api.ts`:
```ts
servicesApi.stop(id)                               // POST /services/:id/actions { action: "stop" }
servicesApi.reinstall(id)                          // POST /services/:id/reinstall
servicesApi.createBackup(id)                       // POST /services/:id/backups
servicesApi.updateEnv(id, Record<string, string>)  // PATCH /services/:id/env  { environment: {...} }
```

`OverviewTab` is at line ~306 in `apps/web/src/app/(app)/services/[id]/page.tsx`. It already renders `<HealthIndicator>`, `<MetricsChart>`, `<AlertsSection>`, fact grid, `<PortCards>`, `<DomainsSection>`. Add the Minecraft switcher **after `<PortCards>`** and **before `<DomainsSection>`**.

The `service` object has `service.config.environment: Record<string, string> | undefined` and `service.config.image: string | undefined` and `service.type: "game" | "docker" | "database" | "static"`.

---

## Task 1 — Replace `templates/minecraft.yaml`

Replace the entire file with the template below. The current file uses `itzg/minecraft-server` which handles everything internally — this new version uses `eclipse-temurin:21-jre-alpine` as runtime and a proper Vivox install script so the framework switcher can reinstall with a different JAR.

```yaml
id: minecraft
name: Minecraft Server
description: |
  Java Edition Minecraft server with support for Paper, Purpur, Fabric, Forge, NeoForge, Quilt,
  Mohist, and Arclight. Switch frameworks at any time from the panel — world data is always preserved.
  Bukkit-based loaders (Paper, Purpur, Mohist, Arclight) support plugins. Mod loaders (Fabric, Forge,
  NeoForge, Quilt) support mods. Mohist and Arclight support both simultaneously.
type: game
image: eclipse-temurin:21-jre-alpine

ports:
  - container: 25565
    host: 25565
    protocol: tcp
    bind: "0.0.0.0"
    alias: game

startup_cmd: |
  /bin/sh -c '
  cd /mnt/server
  if [ -f server.jar ]; then
    exec java -Xmx${MEMORY}M -Xms${MEMORY}M ${JVM_FLAGS} -jar server.jar nogui
  elif ls forge-*-shim.jar 2>/dev/null | head -1 | grep -q .; then
    exec java -Xmx${MEMORY}M -Xms${MEMORY}M ${JVM_FLAGS} @user_jvm_args.txt @libraries/net/minecraftforge/forge/*/unix_args.txt nogui
  elif ls neoforge-*-shim.jar 2>/dev/null | head -1 | grep -q .; then
    exec java -Xmx${MEMORY}M -Xms${MEMORY}M ${JVM_FLAGS} @user_jvm_args.txt @libraries/net/neoforged/neoforge/*/unix_args.txt nogui
  else
    echo "[Vivox] ERROR: No server JAR found. Trigger a reinstall from the panel." >&2
    sleep 60
  fi'

install_script: |
  #!/bin/bash
  set -euo pipefail
  cd /mnt/server

  # Accept EULA
  echo "eula=true" > eula.txt

  MC_VERSION="${MC_VERSION:-1.21.4}"
  FRAMEWORK="${FRAMEWORK:-Paper}"
  FRAMEWORK_LC=$(echo "$FRAMEWORK" | tr '[:upper:]' '[:lower:]')

  # Remove old framework files (but never world/, plugins/, mods/, config/)
  rm -f server.jar forge-*-shim.jar neoforge-*-shim.jar fabric-server-launch.jar \
        quilt-server-launch.jar *.jar.bak run.sh user_jvm_args.txt 2>/dev/null || true
  rm -rf libraries/ versions/ .fabric/ .quilt/ 2>/dev/null || true

  # ── Paper ────────────────────────────────────────────────────────────────────
  install_paper() {
    echo "[Vivox] Fetching latest Paper build for ${MC_VERSION}..."
    BUILD=$(curl -fsSL "https://api.papermc.io/v2/projects/paper/versions/${MC_VERSION}/builds" \
      | python3 -c "import sys,json; builds=json.load(sys.stdin)['builds']; print(sorted(builds,key=lambda b:b['build'])[-1]['build'])")
    curl -fsSL "https://api.papermc.io/v2/projects/paper/versions/${MC_VERSION}/builds/${BUILD}/downloads/paper-${MC_VERSION}-${BUILD}.jar" \
      -o server.jar
    echo "[Vivox] Paper ${MC_VERSION} build ${BUILD} installed."
  }

  # ── Purpur ───────────────────────────────────────────────────────────────────
  install_purpur() {
    echo "[Vivox] Fetching Purpur ${MC_VERSION}..."
    curl -fsSL "https://api.purpurmc.org/v2/purpur/${MC_VERSION}/latest/download" -o server.jar
    echo "[Vivox] Purpur ${MC_VERSION} (latest build) installed."
  }

  # ── Vanilla ──────────────────────────────────────────────────────────────────
  install_vanilla() {
    echo "[Vivox] Fetching Vanilla ${MC_VERSION}..."
    MANIFEST=$(curl -fsSL "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json")
    VERSION_URL=$(echo "$MANIFEST" | python3 -c \
      "import sys,json; v=[x for x in json.load(sys.stdin)['versions'] if x['id']=='${MC_VERSION}']; \
       print(v[0]['url'] if v else exit(1))")
    SERVER_URL=$(curl -fsSL "$VERSION_URL" | python3 -c \
      "import sys,json; print(json.load(sys.stdin)['downloads']['server']['url'])")
    curl -fsSL "$SERVER_URL" -o server.jar
    echo "[Vivox] Vanilla ${MC_VERSION} installed."
  }

  # ── Fabric ───────────────────────────────────────────────────────────────────
  install_fabric() {
    FABRIC_LOADER="${FABRIC_LOADER_VERSION:-0.16.9}"
    echo "[Vivox] Installing Fabric loader ${FABRIC_LOADER} for MC ${MC_VERSION}..."
    # Use the Fabric meta API to get the installer URL
    INSTALLER_URL=$(curl -fsSL "https://meta.fabricmc.net/v2/versions/installer" \
      | python3 -c "import sys,json; v=json.load(sys.stdin); print(v[0]['url'])")
    curl -fsSL "$INSTALLER_URL" -o /tmp/fabric-installer.jar
    java -jar /tmp/fabric-installer.jar server \
      -mcversion "${MC_VERSION}" \
      -loader "${FABRIC_LOADER}" \
      -downloadMinecraft \
      -dir /mnt/server
    # fabric-server-launch.jar is the entrypoint; rename to server.jar for uniformity
    mv /mnt/server/fabric-server-launch.jar /mnt/server/server.jar 2>/dev/null || true
    rm -f /tmp/fabric-installer.jar
    echo "[Vivox] Fabric ${FABRIC_LOADER} for MC ${MC_VERSION} installed."
  }

  # ── Quilt ────────────────────────────────────────────────────────────────────
  install_quilt() {
    QUILT_LOADER="${QUILT_LOADER_VERSION:-0.27.1}"
    echo "[Vivox] Installing Quilt loader ${QUILT_LOADER} for MC ${MC_VERSION}..."
    INSTALLER_URL=$(curl -fsSL "https://meta.quiltmc.org/v3/versions/installer" \
      | python3 -c "import sys,json; v=json.load(sys.stdin); print(v[0]['url'])")
    curl -fsSL "$INSTALLER_URL" -o /tmp/quilt-installer.jar
    java -jar /tmp/quilt-installer.jar install server "${MC_VERSION}" \
      --loader-version "${QUILT_LOADER}" \
      --download-server \
      --install-dir /mnt/server
    mv /mnt/server/quilt-server-launch.jar /mnt/server/server.jar 2>/dev/null || true
    rm -f /tmp/quilt-installer.jar
    echo "[Vivox] Quilt ${QUILT_LOADER} for MC ${MC_VERSION} installed."
  }

  # ── Forge ────────────────────────────────────────────────────────────────────
  install_forge() {
    FORGE_VER="${FORGE_VERSION:-}"
    if [ -z "$FORGE_VER" ]; then
      echo "[Vivox] Looking up latest Forge for MC ${MC_VERSION}..."
      FORGE_VER=$(curl -fsSL "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json" \
        | python3 -c "
import sys,json
d=json.load(sys.stdin)['promos']
key='${MC_VERSION}-latest'
if key in d: print(d[key])
else:
  # fall back to recommended
  rkey='${MC_VERSION}-recommended'
  print(d.get(rkey, ''))
")
    fi
    if [ -z "$FORGE_VER" ]; then
      echo "[Vivox] ERROR: No Forge build found for MC ${MC_VERSION}. Try specifying FORGE_VERSION manually." >&2
      exit 1
    fi
    FULL="${MC_VERSION}-${FORGE_VER}"
    echo "[Vivox] Installing Forge ${FULL}..."
    INSTALLER_URL="https://maven.minecraftforge.net/net/minecraftforge/forge/${FULL}/forge-${FULL}-installer.jar"
    curl -fsSL "$INSTALLER_URL" -o /tmp/forge-installer.jar
    java -jar /tmp/forge-installer.jar --installServer /mnt/server
    rm -f /tmp/forge-installer.jar /mnt/server/forge-*-installer.jar 2>/dev/null || true
    # Write default user_jvm_args.txt if absent
    [ -f /mnt/server/user_jvm_args.txt ] || echo "-Xmx${MEMORY:-2048}M" > /mnt/server/user_jvm_args.txt
    # Create a shim marker so startup_cmd knows to use the @-file launch method
    touch /mnt/server/forge-${FULL}-shim.jar
    echo "[Vivox] Forge ${FULL} installed."
  }

  # ── NeoForge ─────────────────────────────────────────────────────────────────
  install_neoforge() {
    NEOFORGE_VER="${NEOFORGE_VERSION:-}"
    # NeoForge version scheme: major.minor.patch derived from MC minor.patch
    # e.g. MC 1.21.4 → NeoForge 21.4.x
    MC_MINOR=$(echo "$MC_VERSION" | cut -d. -f2,3)
    if [ -z "$NEOFORGE_VER" ]; then
      echo "[Vivox] Looking up latest NeoForge for MC ${MC_VERSION}..."
      NEOFORGE_VER=$(curl -fsSL "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml" \
        | grep -oP "<version>${MC_MINOR//./\\.}\.[0-9]+</version>" \
        | grep -oP '[0-9.]+' | sort -V | tail -1)
    fi
    if [ -z "$NEOFORGE_VER" ]; then
      echo "[Vivox] ERROR: No NeoForge build found for MC ${MC_VERSION}." >&2
      exit 1
    fi
    echo "[Vivox] Installing NeoForge ${NEOFORGE_VER}..."
    curl -fsSL "https://maven.neoforged.net/releases/net/neoforged/neoforge/${NEOFORGE_VER}/neoforge-${NEOFORGE_VER}-installer.jar" \
      -o /tmp/neoforge-installer.jar
    java -jar /tmp/neoforge-installer.jar --installServer /mnt/server
    rm -f /tmp/neoforge-installer.jar 2>/dev/null || true
    [ -f /mnt/server/user_jvm_args.txt ] || echo "-Xmx${MEMORY:-2048}M" > /mnt/server/user_jvm_args.txt
    touch /mnt/server/neoforge-${NEOFORGE_VER}-shim.jar
    echo "[Vivox] NeoForge ${NEOFORGE_VER} installed."
  }

  # ── Mohist (Paper + Forge hybrid) ────────────────────────────────────────────
  install_mohist() {
    echo "[Vivox] Fetching Mohist ${MC_VERSION}..."
    BUILD=$(curl -fsSL "https://mohistmc.com/api/v2/projects/mohist/${MC_VERSION}/builds" \
      | python3 -c "import sys,json; builds=json.load(sys.stdin).get('builds',[]); print(builds[-1]['number'] if builds else '')" 2>/dev/null || echo "")
    if [ -z "$BUILD" ]; then
      # fallback: direct latest
      curl -fsSL "https://mohistmc.com/api/v2/projects/mohist/${MC_VERSION}/builds/latest/download" -o server.jar
    else
      curl -fsSL "https://mohistmc.com/api/v2/projects/mohist/${MC_VERSION}/builds/${BUILD}/download" -o server.jar
    fi
    echo "[Vivox] Mohist ${MC_VERSION} installed."
  }

  # ── Arclight (Paper + Fabric hybrid) ─────────────────────────────────────────
  install_arclight() {
    echo "[Vivox] Fetching Arclight for MC ${MC_VERSION}..."
    # Arclight publishes per-MC-version release pages on GitHub
    # Format: arclight-forge-{MC}-{arclight_ver}.jar or arclight-fabric-{MC}-{ver}.jar
    # We prefer fabric variant on modern versions, forge on older
    ARCLIGHT_TYPE="${ARCLIGHT_TYPE:-fabric}"
    API_URL="https://api.github.com/repos/IzzelAliz/Arclight/releases"
    JAR_URL=$(curl -fsSL "$API_URL?per_page=20" \
      | python3 -c "
import sys,json,re
rels=json.load(sys.stdin)
mc='${MC_VERSION}'
typ='${ARCLIGHT_TYPE}'
for r in rels:
    for a in r.get('assets',[]):
        n=a['name']
        if re.search(rf'arclight-{re.escape(typ)}-{re.escape(mc)}', n, re.I):
            print(a['browser_download_url']); exit(0)
# fallback: any arclight jar matching mc version
for r in rels:
    for a in r.get('assets',[]):
        if '${MC_VERSION}' in a['name'] and a['name'].endswith('.jar'):
            print(a['browser_download_url']); exit(0)
exit(1)
")
    if [ -z "$JAR_URL" ]; then
      echo "[Vivox] ERROR: No Arclight release found for MC ${MC_VERSION}." >&2
      exit 1
    fi
    curl -fsSL "$JAR_URL" -o server.jar
    echo "[Vivox] Arclight (${ARCLIGHT_TYPE}) for MC ${MC_VERSION} installed."
  }

  # ── Dispatch ─────────────────────────────────────────────────────────────────
  case "$FRAMEWORK_LC" in
    paper)    install_paper ;;
    purpur)   install_purpur ;;
    vanilla)  install_vanilla ;;
    fabric)   install_fabric ;;
    quilt)    install_quilt ;;
    forge)    install_forge ;;
    neoforge) install_neoforge ;;
    mohist)   install_mohist ;;
    arclight) install_arclight ;;
    *)        echo "[Vivox] Unknown framework '${FRAMEWORK}', defaulting to Paper."; install_paper ;;
  esac

  # Write server.properties defaults (only if file doesn't exist — preserve existing config)
  if [ ! -f /mnt/server/server.properties ]; then
    cat > /mnt/server/server.properties <<PROPS
server-port=25565
motd=${MOTD:-A Vivox Minecraft Server}
max-players=${MAX_PLAYERS:-20}
difficulty=${DIFFICULTY:-normal}
gamemode=${GAMEMODE:-survival}
online-mode=${ONLINE_MODE:-true}
level-seed=${LEVEL_SEED:-}
view-distance=10
simulation-distance=8
PROPS
  fi

  # Framework marker — read by the panel switcher
  echo "$FRAMEWORK" > /mnt/server/.vivox-framework
  echo "MC_VERSION=${MC_VERSION}" >> /mnt/server/.vivox-framework

  echo "[Vivox] Minecraft install complete: ${FRAMEWORK} ${MC_VERSION}"

resources:
  memory_mb: 4096
  cpu_shares: 2048
  disk_gb: 30

configurable:
  - key: FRAMEWORK
    label: Server Framework
    env: FRAMEWORK
    default: "Paper"
    field_type: select
    options: "Paper, Purpur, Vanilla, Fabric, Quilt, Forge, NeoForge, Mohist, Arclight"
    description: "Bukkit-based (Paper/Purpur) = plugins. Mod loaders (Fabric/Forge/NeoForge/Quilt) = mods. Hybrids (Mohist/Arclight) = both."
    required: true

  - key: MC_VERSION
    label: Minecraft Version
    env: MC_VERSION
    default: "1.21.4"
    field_type: text
    description: "Minecraft version string, e.g. 1.21.4 or 1.20.1. Must be supported by your chosen framework."
    required: true

  - key: MEMORY
    label: Java Heap (MB)
    env: MEMORY
    default: "3072"
    field_type: number
    description: "JVM -Xmx/-Xms in megabytes. Min 1024. Use 4096+ for modpacks."
    required: true

  - key: JVM_FLAGS
    label: JVM Flags
    env: JVM_FLAGS
    default: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1"
    field_type: text
    description: "Aikar's JVM flags for optimal GC. Safe to leave as-is."

  - key: FABRIC_LOADER_VERSION
    label: Fabric Loader Version
    env: FABRIC_LOADER_VERSION
    default: "0.16.9"
    field_type: text
    description: "Fabric loader version. Check https://fabricmc.net/develop/ for the latest stable."

  - key: FORGE_VERSION
    label: Forge Version
    env: FORGE_VERSION
    default: ""
    field_type: text
    description: "Forge version (leave blank for latest recommended). e.g. 47.3.12"

  - key: NEOFORGE_VERSION
    label: NeoForge Version
    env: NEOFORGE_VERSION
    default: ""
    field_type: text
    description: "NeoForge version (leave blank for latest). e.g. 21.4.75"

  - key: QUILT_LOADER_VERSION
    label: Quilt Loader Version
    env: QUILT_LOADER_VERSION
    default: "0.27.1"
    field_type: text
    description: "Quilt loader version. Check https://quiltmc.org/en/usage/latest-versions/ for the latest."

  - key: ARCLIGHT_TYPE
    label: Arclight Variant
    env: ARCLIGHT_TYPE
    default: "fabric"
    field_type: select
    options: "fabric, forge"
    description: "Arclight variant: fabric (Paper + Fabric, modern MC) or forge (Paper + Forge, older MC)."

  - key: MOTD
    label: Server MOTD
    env: MOTD
    default: "A Vivox Minecraft Server"
    field_type: text
    description: "Message shown in the Minecraft server browser."

  - key: MAX_PLAYERS
    label: Max Players
    env: MAX_PLAYERS
    default: "20"
    field_type: number

  - key: DIFFICULTY
    label: Difficulty
    env: DIFFICULTY
    default: "normal"
    field_type: select
    options: "peaceful, easy, normal, hard"

  - key: GAMEMODE
    label: Default Gamemode
    env: GAMEMODE
    default: "survival"
    field_type: select
    options: "survival, creative, adventure, spectator"

  - key: ONLINE_MODE
    label: Online Mode
    env: ONLINE_MODE
    default: "true"
    field_type: select
    options: "true, false"
    description: "Set false for offline/cracked servers. Only disable if you know what you're doing."

  - key: LEVEL_SEED
    label: World Seed
    env: LEVEL_SEED
    default: ""
    field_type: text
    description: "Optional world generation seed. Leave blank for random."
```

---

## Task 2 — Create `apps/web/src/components/minecraft-switcher.tsx`

Create this file from scratch:

```tsx
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gamepad2, AlertTriangle, ChevronRight, RefreshCcw, Package, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { servicesApi } from "@/lib/api";
import type { Service } from "@/lib/types";

// ────────────────────────────────────────────────────────────────────────────
// Framework definitions
// ────────────────────────────────────────────────────────────────────────────

type FrameworkCategory = "plugins" | "mods" | "hybrid" | "vanilla";

interface Framework {
  id: string;
  category: FrameworkCategory;
  short: string;   // one-line description
  detail: string;  // shown in the expanded card
  minMC?: string;  // minimum supported MC version (informational)
}

const FRAMEWORKS: Framework[] = [
  {
    id: "Paper",
    category: "plugins",
    short: "High-performance Spigot fork",
    detail:
      "The most widely used server software. Supports all Bukkit/Spigot plugins. Excellent performance, huge ecosystem. Recommended for plugin servers.",
    minMC: "1.8",
  },
  {
    id: "Purpur",
    category: "plugins",
    short: "Paper fork with extra configuration",
    detail:
      "Drops in as a Paper replacement. Every vanilla and Paper behaviour is configurable per-mob, per-item, per-world. Plugin compatible with Paper.",
    minMC: "1.14",
  },
  {
    id: "Vanilla",
    category: "vanilla",
    short: "Official Mojang server — no mods",
    detail:
      "The unmodified Mojang server. No plugins, no mods. Useful for vanilla events, vanilla testing, or SMP servers that want no modifications.",
  },
  {
    id: "Fabric",
    category: "mods",
    short: "Lightweight modern mod loader",
    detail:
      "Fast-updating, lightweight modding platform. Most popular for technical/performance mods. Mods targeting Fabric API are incompatible with Forge/NeoForge.",
    minMC: "1.14",
  },
  {
    id: "Forge",
    category: "mods",
    short: "Classic mod loader — huge modpack ecosystem",
    detail:
      "The original Minecraft modding framework. Best-in-class for large modpacks (FTB, CurseForge). Dominant for 1.20.1 and older. Being superseded by NeoForge on 1.20.2+.",
    minMC: "1.1",
  },
  {
    id: "NeoForge",
    category: "mods",
    short: "Forge successor for 1.20.2+",
    detail:
      "Community fork of Forge with a modernised API. The preferred mod loader for 1.20.2 and newer. Not all Forge mods are compatible without porting.",
    minMC: "1.20.2",
  },
  {
    id: "Quilt",
    category: "mods",
    short: "Fabric fork — compatible with most Fabric mods",
    detail:
      "Built on Fabric's toolchain but with additional hooks and better library support. Compatible with the vast majority of Fabric mods. Smaller ecosystem than Fabric.",
    minMC: "1.18.2",
  },
  {
    id: "Mohist",
    category: "hybrid",
    short: "Forge + Paper hybrid",
    detail:
      "Run Forge mods AND Bukkit/Spigot plugins simultaneously. Useful for modpacks that still need essential plugins (EssentialsX, LuckPerms, etc.). Expect some compatibility issues with cutting-edge mods.",
    minMC: "1.12.2",
  },
  {
    id: "Arclight",
    category: "hybrid",
    short: "Fabric (or Forge) + Paper hybrid",
    detail:
      "Combines Paper's plugin API with Fabric (modern MC) or Forge (older MC). Good for servers that want Fabric performance mods alongside plugins. Less tested than Mohist.",
    minMC: "1.16.5",
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Compatibility warnings — shown when switching between incompatible categories
// ────────────────────────────────────────────────────────────────────────────

function getCompatWarning(from: string, to: string): string | null {
  const fromFw = FRAMEWORKS.find((f) => f.id === from);
  const toFw = FRAMEWORKS.find((f) => f.id === to);
  if (!fromFw || !toFw) return null;
  if (fromFw.category === toFw.category) return null;
  if (fromFw.category === "vanilla" || toFw.category === "vanilla") return null;

  if (fromFw.category === "plugins" && toFw.category === "mods") {
    return `Your plugin JARs (in plugins/) will not load on ${to}. They won't be deleted — just ignored. World data is fully compatible.`;
  }
  if (fromFw.category === "mods" && toFw.category === "plugins") {
    return `Your mod JARs (in mods/) will not load on ${to}. Mods that added blocks/items to your world may cause missing-content errors. Back up first.`;
  }
  if (fromFw.category === "plugins" && toFw.category === "hybrid") {
    return `${to} loads plugins AND mods. Your existing plugins folder is compatible. Consider whether you need to re-add your mod JARs.`;
  }
  if (fromFw.category === "mods" && toFw.category === "hybrid") {
    return `${to} loads mods AND plugins. Your existing mods folder carries over. Expect minor incompatibilities — ${to} lags behind pure mod loaders on API coverage.`;
  }
  if (fromFw.category === "hybrid" && toFw.category === "plugins") {
    return `Switching to a plugin-only loader. Mod JARs will be ignored. Mods that placed blocks/entities in the world may cause chunk errors.`;
  }
  if (fromFw.category === "hybrid" && toFw.category === "mods") {
    return `Switching to a mod-only loader. Plugin JARs will be ignored. World data is compatible.`;
  }
  if (fromFw.category === "mods" && toFw.category === "mods") {
    // Fabric ↔ Forge incompatibility
    const fabricFamily = ["Fabric", "Quilt"];
    const forgeFamily = ["Forge", "NeoForge"];
    const fromFabric = fabricFamily.includes(from);
    const toFabric = fabricFamily.includes(to);
    if (fromFabric !== toFabric) {
      return `${from} mods are NOT compatible with ${to}. The mods/ folder carries over but none of your current mods will load. Install ${to}-compatible mods after switching.`;
    }
    // Forge ↔ NeoForge — partial compat
    if (from === "Forge" && to === "NeoForge") {
      return `Many Forge mods work on NeoForge without changes. Some may need the NeoForge port. World data is compatible.`;
    }
    if (from === "NeoForge" && to === "Forge") {
      return `NeoForge-specific APIs are not available in Forge. Some mods may not load. World data is compatible.`;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Colour scheme by category
// ────────────────────────────────────────────────────────────────────────────

const CATEGORY_STYLE: Record<FrameworkCategory, string> = {
  plugins: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
  vanilla: "text-zinc-400 bg-zinc-500/10 border-zinc-500/25",
  mods:    "text-blue-400 bg-blue-500/10 border-blue-500/25",
  hybrid:  "text-amber-400 bg-amber-500/10 border-amber-500/25",
};

const CATEGORY_LABEL: Record<FrameworkCategory, string> = {
  plugins: "plugins",
  vanilla: "vanilla",
  mods:    "mods",
  hybrid:  "hybrid",
};

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

interface Props {
  service: Service;
  onSwitched: () => void;
}

export function MinecraftSwitcher({ service, onSwitched }: Props) {
  const currentFramework =
    service.config?.environment?.FRAMEWORK ?? "Paper";

  const [selected, setSelected] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [backupFirst, setBackupFirst] = useState(true);
  const [busy, setBusy] = useState(false);

  const target = selected === currentFramework ? null : selected;
  const warning = target ? getCompatWarning(currentFramework, target) : null;
  const targetFw = FRAMEWORKS.find((f) => f.id === target);

  const handleSwitch = async () => {
    if (!target) return;
    setBusy(true);
    try {
      // 1. Backup world if requested
      if (backupFirst) {
        await servicesApi.createBackup(service.id);
        toast("World backup queued before framework switch", "info");
      }

      // 2. Stop if running
      const running = ["RUNNING", "STARTING"].includes(service.status);
      if (running) {
        await servicesApi.stop(service.id);
        // Give the agent a moment to stop
        await new Promise((r) => setTimeout(r, 2500));
      }

      // 3. Write new FRAMEWORK env var
      const nextEnv: Record<string, string> = {
        ...(service.config?.environment ?? {}),
        FRAMEWORK: target,
      };
      await servicesApi.updateEnv(service.id, nextEnv);

      // 4. Trigger reinstall (wipes JARs, runs install_script with new FRAMEWORK)
      await servicesApi.reinstall(service.id);

      toast(`Switching to ${target} — reinstall started`, "success");
      setSelected(null);
      setShowConfirm(false);
      onSwitched();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Framework switch failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <Gamepad2 className="size-4 text-muted" />
        <h3 className="text-sm font-semibold text-foreground">Framework Switcher</h3>
        <span
          className={cn(
            "ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium",
            CATEGORY_STYLE[
              (FRAMEWORKS.find((f) => f.id === currentFramework)?.category ?? "vanilla")
            ],
          )}
        >
          {currentFramework}
        </span>
      </div>

      {/* Framework grid */}
      <div className="grid grid-cols-3 gap-2">
        {FRAMEWORKS.map((fw) => {
          const isCurrent = fw.id === currentFramework;
          const isSelected = selected === fw.id && !isCurrent;
          return (
            <motion.button
              key={fw.id}
              type="button"
              whileTap={{ scale: 0.97 }}
              disabled={isCurrent}
              onClick={() => {
                setSelected(isSelected ? null : fw.id);
                setShowConfirm(false);
              }}
              className={cn(
                "rounded-lg border p-3 text-left text-xs transition-colors",
                isCurrent
                  ? "cursor-default border-vivox-500/40 bg-vivox-500/10 text-vivox-400"
                  : isSelected
                    ? "border-vivox-500/60 bg-vivox-500/15 text-foreground shadow-[0_0_0_1px_theme(colors.vivox.500/0.3)]"
                    : "border-border bg-background text-muted hover:border-border/80 hover:text-foreground",
              )}
            >
              <p className="font-semibold">{fw.id}</p>
              <span
                className={cn(
                  "mt-1 inline-block rounded-full border px-1.5 py-px text-[9px]",
                  CATEGORY_STYLE[fw.category],
                )}
              >
                {CATEGORY_LABEL[fw.category]}
              </span>
              {isCurrent && (
                <p className="mt-1 text-[9px] text-vivox-400/70">active</p>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Expanded panel for selected framework */}
      <AnimatePresence>
        {target && targetFw && (
          <motion.div
            key={target}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 overflow-hidden"
          >
            {/* Framework description */}
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-start gap-2">
                <Package className="mt-0.5 size-3.5 shrink-0 text-muted" />
                <div>
                  <p className="text-xs font-medium text-foreground">{targetFw.id}</p>
                  <p className="mt-0.5 text-xs text-muted">{targetFw.detail}</p>
                  {targetFw.minMC && (
                    <p className="mt-1 text-[10px] text-subtle">
                      Min MC version: {targetFw.minMC}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Compatibility warning */}
            {warning && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 p-3"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                <p className="text-xs text-amber-300">{warning}</p>
              </motion.div>
            )}

            {/* World-preservation note */}
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-border bg-background/50 p-3">
              <Cpu className="mt-0.5 size-3.5 shrink-0 text-muted" />
              <p className="text-xs text-muted">
                World data in <code className="text-foreground">/mnt/server/world/</code> is{" "}
                <span className="text-emerald-400">always preserved</span>. Only the server JAR,
                framework files, and library folders are replaced.
              </p>
            </div>

            {/* Backup option */}
            <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-xs text-muted">
              <input
                type="checkbox"
                checked={backupFirst}
                onChange={(e) => setBackupFirst(e.target.checked)}
                className="rounded border-border"
              />
              Create a world backup before switching
            </label>

            {/* Action */}
            {!showConfirm ? (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() => setShowConfirm(true)}
              >
                Switch to {target}
                <ChevronRight className="size-3.5" />
              </Button>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/8 p-3"
              >
                <p className="text-xs text-amber-300">
                  This will{" "}
                  <strong className="text-amber-200">
                    stop the server, wipe framework files, and reinstall with {target}
                  </strong>
                  . The server will come back online after the install finishes.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    actionType="restart"
                    loading={busy}
                    onClick={() => void handleSwitch()}
                  >
                    <RefreshCcw className="size-3.5" />
                    Confirm — switch to {target}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setShowConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

---

## Task 3 — Wire `MinecraftSwitcher` into `OverviewTab`

File: `apps/web/src/app/(app)/services/[id]/page.tsx`

1. Add import at the top of the file (with other component imports):
   ```ts
   import { MinecraftSwitcher } from "@/components/minecraft-switcher";
   ```

2. The `OverviewTab` function signature needs a `refetch` callback. Change:
   ```ts
   // BEFORE:
   function OverviewTab({ service }: { service: Service }) {
   
   // AFTER:
   function OverviewTab({ service, refetch }: { service: Service; refetch: () => void }) {
   ```

3. Pass `refetch` from the parent. In the parent component find where `OverviewTab` is rendered:
   ```tsx
   // BEFORE:
   {tab === "Overview" && <OverviewTab service={service} />}
   
   // AFTER:
   {tab === "Overview" && <OverviewTab service={service} refetch={refetch} />}
   ```
   Where `refetch` is from `useApi(...)` — check how the parent fetches `service` and grab its `refetch`.
   If the parent uses `const [service, setService] = useState(...)` (without `useApi`), the `onSwitched` 
   callback should just re-fetch by navigating to the same page or calling the API manually. In that case:
   ```tsx
   const handleOverviewRefetch = useCallback(() => {
     servicesApi.get(serviceId).then(setService).catch(() => {});
   }, [serviceId]);
   // then pass:
   {tab === "Overview" && <OverviewTab service={service} refetch={handleOverviewRefetch} />}
   ```

4. Inside `OverviewTab`, after the `<PortCards>` line and before `<DomainsSection>`:
   ```tsx
   {/* Minecraft framework switcher — shown when FRAMEWORK env var is set */}
   {service.type === "game" &&
     service.config?.environment?.FRAMEWORK !== undefined && (
       <MinecraftSwitcher service={service} onSwitched={refetch} />
     )}
   ```

---

## Task 4 — Build verification

```bash
# TypeScript
cd apps/web && npm run build

# Go (template changes don't affect Go compilation but run anyway)
cd apps/api && go build ./...
```

Fix any TypeScript errors before finishing.

---

## Key invariants — do not violate these

1. **World data is never deleted.** `rm -rf` in `install_script` only targets JAR files and framework library directories (`libraries/`, `versions/`, `.fabric/`, `.quilt/`). Never `rm -rf /mnt/server/world` or similar.

2. **`server.properties` is only created if it doesn't exist.** Use `if [ ! -f server.properties ]` so player customisations survive reinstalls.

3. **Plugins and mods folders are preserved.** The install script never touches `plugins/` or `mods/`.

4. **`updateEnv` takes `Record<string, string>`.** Do NOT pass an array. The existing signature in `api.ts` is `updateEnv(id: string, environment: Record<string, string>)`.

5. **`FRAMEWORK` env var must be written before `reinstall` is called.** The install script reads `$FRAMEWORK` from the container environment, which comes from `config.environment` in the DB. The sequence is: `updateEnv` → `reinstall`.

6. **Installer container uses `eclipse-temurin:21-jdk-alpine`** (JDK, not JRE — needed to run installer JARs). The runtime container uses `eclipse-temurin:21-jre-alpine`. This is controlled by the agent's `lifecycle.go` — the installer image should already be configurable; check `apps/agent/internal/docker/lifecycle.go` and ensure `JAVA_INSTALLER_IMAGE` or a hardcoded `eclipse-temurin:21-jdk-alpine` is used for the installer step. If the agent currently uses the same image for installer and runtime, update it to use `eclipse-temurin:21-jdk-alpine` as the installer image when the service image is `eclipse-temurin:21-jre-alpine`.

7. **Forge/NeoForge shim markers.** The install scripts create empty `forge-*-shim.jar` / `neoforge-*-shim.jar` files so `startup_cmd` can detect which `@unix_args.txt` path to use without hard-coding version strings. Do not delete these in future installs (they are removed at the top of `install_script` before reinstalling the correct framework).
