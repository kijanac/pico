// pico-host release updater. Runs as a standalone, dependency-free script from
// a stable path OUTSIDE /opt/pico-workspace/current, so the `current` symlink
// swap it performs never rewrites its own source. Node builtins only — it must
// not import anything from the release tree.
import { execFileSync } from "node:child_process";
import { createHash, createVerify } from "node:crypto";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = "/opt/pico-workspace";
const DATA_DIR = "/var/lib/pico-host";
const RELEASES_DIR = join(APP_DIR, "releases");
const CURRENT_LINK = join(APP_DIR, "current");
const UPDATER_PATH = join(APP_DIR, "host-update.mjs");
const STATE_FILE = join(DATA_DIR, "update-state.json");
const PUBLIC_KEY = "/etc/pico-host/update-public-key.pem";
const DB_PATH = join(DATA_DIR, "pico-host.db");
const REPO = "kijanac/pico";
const HEALTH_URL = "http://127.0.0.1:7777/healthz";
const HEALTH_ATTEMPTS = 30;
const HEALTH_DELAY_MS = 1000;
const UNITS = ["pico-host.service", "pico-host-update.service", "pico-host-update.timer", "pico-host-update.path"] as const;

const log = (msg: string): void => console.log(`[pico-host-update] ${msg}`);
const fatal = (msg: string): never => {
  console.error(`[pico-host-update] ERROR: ${msg}`);
  process.exit(1);
};
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ── pure helpers (exported for tests) ──────────────────────────────────────

export interface GithubAsset { readonly name: string; readonly browser_download_url: string }
export interface GithubRelease { readonly tag_name: string; readonly assets: readonly GithubAsset[] }
export interface Manifest { readonly version: string; readonly artifact: { readonly name: string; readonly sha256: string } }
export interface UpdateState {
  currentVersion?: string;
  lastSeenVersion?: string;
  lastSeenAt?: number;
  updatedAt?: number;
  failedAt?: number;
  failure?: { version: string; reason: string; at: number };
}
export type ReleaseResolution =
  | { readonly status: "no_update"; readonly version: string }
  | { readonly status: "update"; readonly version: string; readonly manifestUrl: string; readonly sigUrl: string };

// SemVer-lite precedence: numeric core, then prerelease (`-rc.1`) ranks BELOW
// its release so a box on `1.3.0-rc.1` still upgrades to `1.3.0`.
function parseVersion(version: string): { core: number[]; pre: string[] } {
  const v = version.replace(/^v/, "");
  const dash = v.indexOf("-");
  const core = (dash === -1 ? v : v.slice(0, dash)).split(".").map((n) => Number(n) || 0);
  const pre = dash === -1 ? [] : v.slice(dash + 1).split(".");
  return { core, pre };
}

export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < Math.max(va.core.length, vb.core.length); i += 1) {
    const diff = (va.core[i] ?? 0) - (vb.core[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (va.pre.length === 0 && vb.pre.length === 0) return 0;
  if (va.pre.length === 0) return 1; // a is the release, b a prerelease of it
  if (vb.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(va.pre.length, vb.pre.length); i += 1) {
    const x = va.pre[i];
    const y = vb.pre[i];
    if (x === undefined) return -1; // fewer prerelease fields ranks lower
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    const bothNumeric = String(nx) === x && String(ny) === y;
    const diff = bothNumeric ? nx - ny : x < y ? -1 : x > y ? 1 : 0;
    if (diff !== 0) return diff;
  }
  return 0;
}

export function assetUrl(release: GithubRelease, name: string): string {
  const asset = release.assets.find((entry) => entry.name === name);
  if (!asset) throw new Error(`${name} asset missing`);
  return asset.browser_download_url;
}

export function resolveRelease(release: GithubRelease, currentVersion: string, lastSeen: string): ReleaseResolution {
  const version = release.tag_name.replace(/^v/, "");
  if (!version) throw new Error("release tag_name did not contain a version");
  if (compareVersions(version, currentVersion) <= 0) return { status: "no_update", version };
  if (compareVersions(lastSeen, version) > 0) throw new Error(`refusing rollback from last seen ${lastSeen} to ${version}`);
  return {
    status: "update",
    version,
    manifestUrl: assetUrl(release, "pico-host-release.json"),
    sigUrl: assetUrl(release, "pico-host-release.json.sig"),
  };
}

export function checkManifest(manifest: Manifest, expectedVersion: string): void {
  if (manifest.version !== expectedVersion) {
    throw new Error(`manifest version ${manifest.version} does not match release ${expectedVersion}`);
  }
}

export function applyState(state: UpdateState, version: string, status: "seen" | "failed" | "updated", now: number, reason?: string): UpdateState {
  if (status === "seen") return { ...state, lastSeenVersion: version, lastSeenAt: now };
  if (status === "failed") return { ...state, failedAt: now, failure: { version, reason: reason ?? "unknown", at: now } };
  const { failure: _f, failedAt: _a, ...rest } = state;
  return { ...rest, currentVersion: version, lastSeenVersion: version, updatedAt: now };
}

// ── side effects ────────────────────────────────────────────────────────────

function readUpdateState(path: string): UpdateState {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as UpdateState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`invalid update state at ${path}: ${String(error)}`);
  }
}
const writeState = (state: UpdateState): void => writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
const setState = (version: string, status: "seen" | "failed" | "updated", reason?: string): void =>
  writeState(applyState(readUpdateState(STATE_FILE), version, status, Date.now(), reason));

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "user-agent": "pico-host-update", accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as T;
}
async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "user-agent": "pico-host-update" } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
function verifySignature(manifestPath: string, sigPath: string): boolean {
  const verifier = createVerify("sha256");
  verifier.update(readFileSync(manifestPath));
  verifier.end();
  return verifier.verify(readFileSync(PUBLIC_KEY, "utf8"), readFileSync(sigPath));
}
async function healthCheck(): Promise<boolean> {
  for (let i = 0; i < HEALTH_ATTEMPTS; i += 1) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(HEALTH_DELAY_MS);
  }
  return false;
}
function dumpDiagnostics(): void {
  for (const args of [["status", "pico-host", "--no-pager", "-l"]] as const) {
    try { execFileSync("systemctl", [...args], { stdio: "inherit" }); } catch { /* best effort */ }
  }
  try { execFileSync("journalctl", ["-u", "pico-host", "-n", "80", "--no-pager"], { stdio: "inherit" }); } catch { /* best effort */ }
}
function runReleaseMigrations(): void {
  const migration = join(CURRENT_LINK, "packages/host/deploy/migrate-message-usage-shape.mjs");
  if (!existsSync(migration)) return;
  log("running message usage migration");
  execFileSync("node", [migration, DB_PATH], { env: { ...process.env, PICO_HOST_DB: DB_PATH }, stdio: "inherit" });
}
// Refresh the updater (write-temp-then-rename, never truncate the running file
// in place) and the systemd units from the freshly-promoted release.
function syncDeployFiles(): void {
  const deploy = join(CURRENT_LINK, "packages/host/deploy");
  const newUpdater = join(deploy, "host-update.mjs");
  if (existsSync(newUpdater)) {
    const staged = `${UPDATER_PATH}.new`;
    copyFileSync(newUpdater, staged);
    renameSync(staged, UPDATER_PATH);
  }
  for (const unit of UNITS) {
    const src = join(deploy, unit);
    if (existsSync(src)) {
      try { execFileSync("install", ["-o", "root", "-g", "root", "-m", "0644", src, `/etc/systemd/system/${unit}`]); } catch { /* best effort */ }
    }
  }
  try { execFileSync("systemctl", ["daemon-reload"]); } catch { /* best effort */ }
  try { execFileSync("systemctl", ["enable", "--now", "pico-host-update.path"], { stdio: "ignore" }); } catch { /* best effort */ }
}

async function main(): Promise<void> {
  mkdirSync(RELEASES_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });

  const currentVersion = existsSync(join(CURRENT_LINK, "VERSION"))
    ? readFileSync(join(CURRENT_LINK, "VERSION"), "utf8").trim()
    : "0.0.0";
  const lastSeen = readUpdateState(STATE_FILE).lastSeenVersion ?? currentVersion;
  log(`current=${currentVersion} lastSeen=${lastSeen} repo=${REPO}`);

  const tmp = mkdtempSync(join(tmpdir(), "pico-host-update-"));
  try {
    const release = await fetchJson<GithubRelease>(`https://api.github.com/repos/${REPO}/releases/latest`);
    const resolution = resolveRelease(release, currentVersion, lastSeen);
    if (resolution.status === "no_update") {
      log(`no newer release (${resolution.version})`);
      return;
    }
    const { version, manifestUrl, sigUrl } = resolution;

    const manifestPath = join(tmp, "pico-host-release.json");
    const sigPath = `${manifestPath}.sig`;
    await download(manifestUrl, manifestPath);
    await download(sigUrl, sigPath);
    if (!existsSync(PUBLIC_KEY)) fatal(`manifest signature present but public key not found: ${PUBLIC_KEY}`);
    if (!verifySignature(manifestPath, sigPath)) fatal("manifest signature verification failed");
    log("manifest signature verified");

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    checkManifest(manifest, version);
    const artifactUrl = assetUrl(release, manifest.artifact.name);
    setState(version, "seen");

    const archive = join(tmp, manifest.artifact.name);
    await download(artifactUrl, archive);
    if (sha256(archive) !== manifest.artifact.sha256) fatal("artifact checksum failed");
    log("artifact checksum verified");

    const target = join(RELEASES_DIR, version);
    rmSync(`${target}.tmp`, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
    mkdirSync(`${target}.tmp`, { recursive: true });
    execFileSync("tar", ["-C", `${target}.tmp`, "--strip-components=1", "-xzf", archive]);
    execFileSync("pnpm", ["--filter", "@pico/cli...", "install", "--prod", "--frozen-lockfile"], { cwd: `${target}.tmp`, stdio: "inherit" });
    execFileSync("chown", ["-R", "pico-host:pico-host", `${target}.tmp`]);
    renameSync(`${target}.tmp`, target);

    const previous = existsSync(CURRENT_LINK) ? realpathSync(CURRENT_LINK) : "";
    execFileSync("ln", ["-sfn", target, CURRENT_LINK]);

    const rollback = (reason: string): void => {
      setState(version, "failed", reason);
      if (previous && previous !== target) {
        log(`rolling back to ${previous}`);
        execFileSync("ln", ["-sfn", previous, CURRENT_LINK]);
        try { execFileSync("systemctl", ["restart", "pico-host"]); } catch { /* best effort */ }
      }
    };

    runReleaseMigrations();

    log(`restarting pico-host on ${version}`);
    try {
      execFileSync("systemctl", ["restart", "pico-host"]);
    } catch {
      dumpDiagnostics();
      rollback("restart_failed");
      fatal("restart failed");
    }

    log(`waiting for health check at ${HEALTH_URL}`);
    if (!(await healthCheck())) {
      dumpDiagnostics();
      rollback("health_check_failed");
      fatal("health check failed");
    }

    syncDeployFiles();
    setState(version, "updated");
    log(`updated to ${version}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => fatal(error instanceof Error ? error.message : String(error)));
}
