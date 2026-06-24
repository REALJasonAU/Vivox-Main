#!/usr/bin/env node
/**
 * Vivox local file sync daemon.
 * Watches a local folder and syncs with the Vivox panel Files API.
 *
 * Usage:
 *   node vivox-file-sync.mjs --service-id <uuid> --token <jwt> [--api-base URL] [--local-dir ./vivox-server-files] [--pull] [--pull-interval 30]
 *
 * Environment:
 *   VIVOX_TOKEN, VIVOX_API_BASE, VIVOX_SERVICE_ID, VIVOX_LOCAL_DIR
 */

import fs from "node:fs";
import path from "node:path";

const SERVER_ROOT = "/mnt/server";
const META_DIR = ".vivox-sync";
const STATE_FILE = "state.json";
const DEFAULT_PULL_MS = 30_000;
const DEBOUNCE_MS = 400;

function parseArgs(argv) {
  const out = {
    serviceId: process.env.VIVOX_SERVICE_ID ?? "",
    token: process.env.VIVOX_TOKEN ?? "",
    apiBase: process.env.VIVOX_API_BASE ?? "http://localhost:3000/api/control",
    localDir: process.env.VIVOX_LOCAL_DIR ?? "./vivox-server-files",
    pull: false,
    pullInterval: DEFAULT_PULL_MS,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--service-id") out.serviceId = next();
    else if (a === "--token") out.token = next();
    else if (a === "--api-base") out.apiBase = next();
    else if (a === "--local-dir") out.localDir = next();
    else if (a === "--pull") out.pull = true;
    else if (a === "--pull-interval") out.pullInterval = Number(next()) * 1000;
    else if (a === "--help" || a === "-h") {
      console.log(`Vivox file sync — node vivox-file-sync.mjs [options]

Options:
  --service-id <id>     Service UUID (required)
  --token <jwt>         Bearer JWT (or VIVOX_TOKEN)
  --api-base <url>      Panel API base (default: http://localhost:3000/api/control)
  --local-dir <path>    Local sync folder (default: ./vivox-server-files)
  --pull                Initial full pull from server before watching
  --pull-interval <s>   Server poll interval in seconds (default: 30)
`);
      process.exit(0);
    }
  }
  return out;
}

function absLocal(p, localDir) {
  return path.resolve(localDir, p);
}

function relFromServer(absPath) {
  if (!absPath.startsWith(SERVER_ROOT)) {
    throw new Error(`Invalid server path: ${absPath}`);
  }
  const rel = absPath.slice(SERVER_ROOT.length).replace(/^\/+/, "");
  return rel;
}

function serverPathFromRel(rel) {
  return rel ? `${SERVER_ROOT}/${rel.replace(/^\/+/, "")}` : SERVER_ROOT;
}

function relFromLocal(filePath, localDir) {
  return path.relative(path.resolve(localDir), filePath).split(path.sep).join("/");
}

async function apiFetch(cfg, apiPath, options = {}) {
  const base = cfg.apiBase.replace(/\/$/, "");
  const url = `${base}${apiPath.startsWith("/") ? apiPath : `/${apiPath}`}`;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${cfg.token}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers ?? {}),
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${apiPath}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

async function listDir(cfg, serverPath) {
  return apiFetch(
    cfg,
    `/services/${cfg.serviceId}/files?path=${encodeURIComponent(serverPath)}`,
  );
}

async function readFile(cfg, serverPath) {
  const data = await apiFetch(
    cfg,
    `/services/${cfg.serviceId}/files/read?path=${encodeURIComponent(serverPath)}`,
  );
  if (data.encoding === "base64") {
    return Buffer.from(data.content, "base64");
  }
  return Buffer.from(data.content ?? "", "utf8");
}

async function writeFile(cfg, serverPath, buf) {
  await apiFetch(cfg, `/services/${cfg.serviceId}/files/write`, {
    method: "POST",
    body: JSON.stringify({
      path: serverPath,
      content: buf.toString("base64"),
    }),
  });
}

function loadState(localDir) {
  const fp = absLocal(path.join(META_DIR, STATE_FILE), localDir);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return { files: {} };
  }
}

function saveState(localDir, state) {
  const dir = absLocal(META_DIR, localDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absLocal(path.join(META_DIR, STATE_FILE), localDir), JSON.stringify(state, null, 2));
}

function isTextBuffer(buf) {
  return !buf.includes(0);
}

async function pullTree(cfg, localDir, state, serverPath = SERVER_ROOT) {
  const entries = await listDir(cfg, serverPath);
  for (const entry of entries) {
    const childServer = `${serverPath.replace(/\/$/, "")}/${entry.name}`;
    const rel = relFromServer(childServer);
    const localPath = absLocal(rel, localDir);

    if (entry.is_dir) {
      fs.mkdirSync(localPath, { recursive: true });
      await pullTree(cfg, localDir, state, childServer);
      continue;
    }

    try {
      const remote = await readFile(cfg, childServer);
      const remoteMtime = Number(entry.modified) || Date.now() / 1000;
      const key = rel;
      const prev = state.files[key];
      const localExists = fs.existsSync(localPath);

      if (!localExists || !prev || remoteMtime > prev.remoteMtime) {
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, remote);
        state.files[key] = {
          remoteMtime,
          localMtime: fs.statSync(localPath).mtimeMs,
        };
        console.log(`↓ pulled ${rel}`);
      }
    } catch (e) {
      if (isTextBuffer(Buffer.from("")) || true) {
        console.warn(`skip ${rel}: ${e.message}`);
      }
    }
  }
  saveState(localDir, state);
}

const pushQueue = new Map();
let pushTimer = null;

function schedulePush(cfg, localDir, state, filePath) {
  const key = relFromLocal(filePath, localDir);
  if (key.startsWith(META_DIR)) return;
  if (pushQueue.has(key)) clearTimeout(pushQueue.get(key));
  pushQueue.set(
    key,
    setTimeout(() => {
      pushQueue.delete(key);
      void pushLocalFile(cfg, localDir, state, filePath, key);
    }, DEBOUNCE_MS),
  );
}

async function pushLocalFile(cfg, localDir, state, filePath, key) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return;
    const buf = fs.readFileSync(filePath);
    if (!isTextBuffer(buf)) {
      console.warn(`skip push (binary): ${key}`);
      return;
    }
    const serverPath = serverPathFromRel(key);
    await writeFile(cfg, serverPath, buf);
    state.files[key] = {
      remoteMtime: stat.mtimeMs / 1000,
      localMtime: stat.mtimeMs,
    };
    saveState(localDir, state);
    console.log(`↑ pushed ${key}`);
  } catch (e) {
    console.error(`push failed ${key}: ${e.message}`);
  }
}

function watchLocal(cfg, localDir, state) {
  fs.mkdirSync(localDir, { recursive: true });
  try {
    const watcher = fs.watch(localDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const norm = filename.split(path.sep).join("/");
      if (norm.startsWith(META_DIR)) return;
      const fp = absLocal(norm, localDir);
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        schedulePush(cfg, localDir, state, fp);
      }
    });
    return watcher;
  } catch {
    console.warn("Recursive watch unavailable — using poll fallback every 2s");
    return setInterval(() => {
      walkLocal(cfg, localDir, state, localDir);
    }, 2000);
  }
}

function walkLocal(cfg, localDir, state, dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name === META_DIR) continue;
    const fp = path.join(dir, name);
    const st = fs.statSync(fp);
    if (st.isDirectory()) {
      walkLocal(cfg, localDir, state, fp);
    } else if (st.isFile()) {
      const key = relFromLocal(fp, localDir);
      const prev = state.files[key];
      if (!prev || st.mtimeMs > prev.localMtime) {
        schedulePush(cfg, localDir, state, fp);
      }
    }
  }
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (!cfg.serviceId || !cfg.token) {
    console.error("Error: --service-id and --token (or env vars) are required.");
    process.exit(1);
  }

  const localDir = path.resolve(cfg.localDir);
  fs.mkdirSync(localDir, { recursive: true });
  const state = loadState(localDir);

  console.log(`Vivox sync started`);
  console.log(`  service: ${cfg.serviceId}`);
  console.log(`  api:     ${cfg.apiBase}`);
  console.log(`  local:   ${localDir}`);

  if (cfg.pull) {
    console.log("Pulling from server…");
    await pullTree(cfg, localDir, state);
    console.log("Initial pull complete.");
  }

  const handle = watchLocal(cfg, localDir, state);

  const poll = setInterval(async () => {
    try {
      await pullTree(cfg, localDir, state);
    } catch (e) {
      console.error(`pull error: ${e.message}`);
    }
  }, cfg.pullInterval);

  process.on("SIGINT", () => {
    clearInterval(poll);
    if (handle && typeof handle.close === "function") handle.close();
    else if (handle) clearInterval(handle);
    console.log("\nSync stopped.");
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
