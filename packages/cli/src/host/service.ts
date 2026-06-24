import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { commandLine, run, runInherit } from "./exec.ts";
import { picoHostPathsFromEnv, releasePicoHostPaths, type PicoHostPaths, type PicoHostReleasePaths } from "./paths.ts";
import { ensureTailscaleServe } from "./tailscale.ts";

const MAC_LABEL = "dev.pico.host";
const LINUX_UNIT = "pico-host.service";
const DEFAULT_SYSTEM_USER = "pico-host";

const ENV_FILE_SEED = `# pico-host environment file (/etc/pico-host/env).
# The systemd unit owns host paths, listener, HOME, and NODE_ENV.
# Provider auth: run \`pi /login\` as the pico-host user, or set a key below.
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
# GEMINI_API_KEY=
`;

export type ServiceMode = "user" | "system";

export interface ServiceCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export interface ServiceOptions {
  readonly command: ServiceCommand;
  readonly paths?: PicoHostPaths;
  readonly mode?: ServiceMode;
  readonly systemUser?: string;
  readonly createSystemUser?: boolean;
  readonly tailscaleServe?: boolean;
  readonly autoUpdate?: boolean;
}

export interface ServiceControlOptions {
  readonly mode?: ServiceMode;
}

export interface ServiceResult {
  readonly level: "ok" | "warn" | "fail";
  readonly message: string;
  readonly detail?: string;
}

export function defaultServiceCommand(nodePath: string, picoScriptPath: string): ServiceCommand {
  return { executable: nodePath, args: [picoScriptPath, "serve"] };
}

export function validateServiceCommand(command: ServiceCommand): void {
  const script = command.args[0];
  if (script?.endsWith(".ts")) {
    throw new Error("pico install requires the built/npm CLI, not a tsx source entrypoint. Run the packaged `pico` binary or set PICO_SERVICE_COMMAND.");
  }
}

export function serviceFilePath(options: ServiceControlOptions = {}): string {
  if (options.mode === "system") return "/etc/systemd/system/pico-host.service";
  if (process.platform === "darwin") return join(homedir(), "Library/LaunchAgents", `${MAC_LABEL}.plist`);
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd/user", LINUX_UNIT);
}

export const installService = (options: ServiceOptions) =>
  Effect.gen(function* () {
    validateServiceCommand(options.command);
    const paths = options.paths ?? picoHostPathsFromEnv();

    const base = yield* (options.mode === "system"
      ? installLinuxSystemService(options.command, paths, options)
      : installUserService(options.command, paths));

    if (!options.tailscaleServe || base.some((r) => r.level === "fail")) return base;

    const ts = yield* ensureTailscaleServe(paths.port, { configure: true, inheritStdio: true });
    return [
      ...base,
      ts.serveUrl
        ? { level: "ok", message: "Tailscale Serve", detail: ts.serveUrl }
        : { level: "warn", message: "Tailscale Serve not configured", detail: `tailscale serve --bg --https=443 ${ts.serveTarget}` },
    ] satisfies ServiceResult[];
  });

const installUserService = (command: ServiceCommand, paths: PicoHostPaths) =>
  Effect.gen(function* () {
    yield* (yield* FileSystem.FileSystem).makeDirectory(paths.dataDir, { recursive: true });
    if (process.platform === "darwin") return yield* installMacService(command, paths);
    if (process.platform === "linux") return yield* installLinuxUserService(command, paths);
    return [{ level: "warn", message: `pico install is not implemented for ${process.platform}` }] satisfies ServiceResult[];
  });

export const uninstallService = (options: ServiceControlOptions = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (options.mode === "system") {
      if (process.platform !== "linux") return [{ level: "fail", message: "system services are only implemented for Linux/systemd" }] satisfies ServiceResult[];
      if (process.getuid?.() !== 0) return [{ level: "fail", message: "pico uninstall --system must run as root" }] satisfies ServiceResult[];
      const unit = serviceFilePath({ mode: "system" });
      const results: ServiceResult[] = [yield* runSystemctl(["disable", "--now", LINUX_UNIT], true)];
      for (const u of ["pico-host-update.timer", "pico-host-update.path", "pico-host-update.service"]) {
        yield* runSystemctl(["disable", "--now", u], true);
        yield* fs.remove(`/etc/systemd/system/${u}`, { force: true });
      }
      yield* fs.remove(unit, { force: true });
      yield* fs.remove(`${dirname(unit)}/pico-host.service.d`, { force: true, recursive: true });
      results.push(yield* runSystemctl(["daemon-reload"], true), { level: "ok", message: "Removed system service + update units", detail: unit });
      return results;
    }

    if (process.platform === "darwin") {
      const plist = serviceFilePath();
      const results = yield* runLaunchctl(["bootout", `gui/${userInfo().uid}`, plist], true);
      yield* fs.remove(plist, { force: true });
      return [...results, { level: "ok", message: "Removed LaunchAgent", detail: plist }] satisfies ServiceResult[];
    }
    if (process.platform === "linux") {
      const unit = serviceFilePath();
      const results: ServiceResult[] = [yield* runSystemctl(["--user", "disable", "--now", LINUX_UNIT], true)];
      yield* fs.remove(unit, { force: true });
      results.push(yield* runSystemctl(["--user", "daemon-reload"], true), { level: "ok", message: "Removed systemd user unit", detail: unit });
      return results;
    }
    return [{ level: "warn", message: `pico uninstall is not implemented for ${process.platform}` }] satisfies ServiceResult[];
  });

export const startService = (options: ServiceControlOptions = {}) =>
  Effect.gen(function* () {
    if (options.mode === "system") {
      if (process.platform !== "linux") return [{ level: "fail", message: "system services are only implemented for Linux/systemd" }] satisfies ServiceResult[];
      if (process.getuid?.() !== 0) return [{ level: "fail", message: "pico start --system must run as root" }] satisfies ServiceResult[];
      return [yield* runSystemctl(["start", LINUX_UNIT], false)];
    }
    if (process.platform === "darwin") {
      const plist = serviceFilePath();
      return [
        ...(yield* runLaunchctl(["bootstrap", `gui/${userInfo().uid}`, plist], true)),
        ...(yield* runLaunchctl(["kickstart", "-k", `gui/${userInfo().uid}/${MAC_LABEL}`], false)),
      ];
    }
    if (process.platform === "linux") return [yield* runSystemctl(["--user", "start", LINUX_UNIT], false)];
    return [{ level: "warn", message: `pico start is not implemented for ${process.platform}` }] satisfies ServiceResult[];
  });

export const stopService = (options: ServiceControlOptions = {}) =>
  Effect.gen(function* () {
    if (options.mode === "system") {
      if (process.platform !== "linux") return [{ level: "fail", message: "system services are only implemented for Linux/systemd" }] satisfies ServiceResult[];
      if (process.getuid?.() !== 0) return [{ level: "fail", message: "pico stop --system must run as root" }] satisfies ServiceResult[];
      return [yield* runSystemctl(["stop", LINUX_UNIT], false)];
    }
    if (process.platform === "darwin") return yield* runLaunchctl(["bootout", `gui/${userInfo().uid}/${MAC_LABEL}`], true);
    if (process.platform === "linux") return [yield* runSystemctl(["--user", "stop", LINUX_UNIT], false)];
    return [{ level: "warn", message: `pico stop is not implemented for ${process.platform}` }] satisfies ServiceResult[];
  });

export const logsService = (options: ServiceControlOptions = {}) =>
  Effect.gen(function* () {
    if (options.mode === "system") {
      yield* runInherit("journalctl", ["-u", LINUX_UNIT, "-n", "80", "-f"]);
      return;
    }
    const paths = picoHostPathsFromEnv();
    if (process.platform === "darwin") {
      yield* runInherit("tail", ["-n", "80", "-f", join(paths.dataDir, "pico-host.log")]);
      return;
    }
    if (process.platform === "linux") {
      yield* runInherit("journalctl", ["--user", "-u", LINUX_UNIT, "-n", "80", "-f"]);
      return;
    }
    yield* Effect.sync(() => console.log(`pico logs is not implemented for ${process.platform}`));
  });

const installMacService = (command: ServiceCommand, paths: PicoHostPaths) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const plist = serviceFilePath();
    yield* fs.makeDirectory(dirname(plist), { recursive: true });
    const logPath = join(paths.dataDir, "pico-host.log");
    const errorPath = join(paths.dataDir, "pico-host.err.log");
    yield* fs.writeFileString(plist, macPlist(command, paths, logPath, errorPath));
    return [
      { level: "ok", message: "Wrote LaunchAgent", detail: plist },
      ...(yield* runLaunchctl(["bootout", `gui/${userInfo().uid}`, plist], true)),
      ...(yield* runLaunchctl(["bootstrap", `gui/${userInfo().uid}`, plist], false)),
      ...(yield* runLaunchctl(["enable", `gui/${userInfo().uid}/${MAC_LABEL}`], true)),
    ] satisfies ServiceResult[];
  });

const installLinuxUserService = (command: ServiceCommand, paths: PicoHostPaths) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const unit = serviceFilePath();
    yield* fs.makeDirectory(dirname(unit), { recursive: true });
    yield* fs.writeFileString(unit, linuxUserUnit(command, paths));
    return [
      { level: "ok", message: "Wrote systemd user unit", detail: unit },
      yield* runSystemctl(["--user", "daemon-reload"], false),
      yield* runSystemctl(["--user", "enable", "--now", LINUX_UNIT], false),
    ] satisfies ServiceResult[];
  });

const SYSTEM_UNITS = ["pico-host.service", "pico-host-update.service", "pico-host-update.timer", "pico-host-update.path"] as const;

const installLinuxSystemService = (_command: ServiceCommand, paths: PicoHostPaths, options: ServiceOptions) =>
  Effect.gen(function* () {
    if (process.platform !== "linux") return [{ level: "fail", message: "system services are only implemented for Linux/systemd" }] satisfies ServiceResult[];
    if (process.getuid?.() !== 0) return [{ level: "fail", message: "pico install --system must run as root" }] satisfies ServiceResult[];

    const systemUser = options.systemUser?.trim() || DEFAULT_SYSTEM_USER;
    const release = releasePicoHostPaths();
    const templates = deployTemplatesDir();
    const fs = yield* FileSystem.FileSystem;

    if (!(yield* fs.exists(join(templates, "pico-host.service")))) {
      return [{ level: "fail", message: "unit templates not found in release", detail: templates }] satisfies ServiceResult[];
    }

    const results: ServiceResult[] = yield* ensureSystemUser(systemUser, paths, Boolean(options.createSystemUser));
    if (results.some((result) => result.level === "fail")) return results;

    yield* fs.makeDirectory(paths.dataDir, { recursive: true });
    yield* fs.makeDirectory(paths.workspacesDir, { recursive: true });
    yield* fs.makeDirectory(release.etcDir, { recursive: true });
    const chown = yield* run("chown", ["-R", systemUser, paths.dataDir, paths.workspacesDir], { timeoutMs: 20_000 });
    results.push(chown.exitCode === 0
      ? { level: "ok", message: "Prepared service directories", detail: `${paths.dataDir}, ${paths.workspacesDir}` }
      : { level: "warn", message: "Could not chown service directories", detail: `ensure ${systemUser} can write ${paths.dataDir} and ${paths.workspacesDir}` });

    // Seed /etc/pico-host/env only when absent — never clobber existing secrets.
    if (yield* fs.exists(release.envFile)) {
      results.push({ level: "ok", message: "Env file preserved", detail: release.envFile });
    } else {
      yield* fs.writeFileString(release.envFile, ENV_FILE_SEED);
      yield* run("chown", [`root:${systemUser}`, release.envFile], { timeoutMs: 10_000 });
      yield* run("chmod", ["0640", release.envFile], { timeoutMs: 10_000 });
      results.push({ level: "ok", message: "Seeded env file", detail: release.envFile });
    }

    if (yield* fs.exists(join(templates, "update-public-key.pem"))) {
      yield* run("install", ["-o", "root", "-g", systemUser, "-m", "0640", join(templates, "update-public-key.pem"), release.updatePublicKey], { timeoutMs: 10_000 });
    }
    // The updater binary is a release artifact; absent before Phase 3, in which case auto-update stays inert.
    if (yield* fs.exists(join(templates, "host-update.mjs"))) {
      yield* run("install", ["-o", "root", "-g", "root", "-m", "0755", join(templates, "host-update.mjs"), release.updaterPath], { timeoutMs: 10_000 });
    } else {
      results.push({ level: "warn", message: "Updater binary not in release; auto-update inert until it ships", detail: release.updaterPath });
    }

    for (const name of SYSTEM_UNITS) {
      yield* run("install", ["-o", "root", "-g", "root", "-m", "0644", join(templates, name), `/etc/systemd/system/${name}`], { timeoutMs: 10_000 });
    }
    results.push({ level: "ok", message: "Installed systemd units", detail: SYSTEM_UNITS.join(", ") });

    const dropIn = join(dirname(serviceFilePath({ mode: "system" })), "pico-host.service.d", "override.conf");
    if (needsSystemDropIn(paths, systemUser, release)) {
      yield* fs.makeDirectory(dirname(dropIn), { recursive: true });
      yield* fs.writeFileString(dropIn, systemDropIn(paths, systemUser, release));
      results.push({ level: "ok", message: "Wrote unit drop-in", detail: dropIn });
    } else {
      yield* fs.remove(dropIn, { force: true });
    }

    results.push(
      yield* runSystemctl(["daemon-reload"], false),
      yield* runSystemctl(["enable", "--now", LINUX_UNIT], false),
      yield* runSystemctl(["enable", "--now", "pico-host-update.path"], true),
    );
    if (options.autoUpdate) {
      results.push(yield* runSystemctl(["enable", "--now", "pico-host-update.timer"], false));
    }
    return results;
  });

const ensureSystemUser = (user: string, paths: PicoHostPaths, create: boolean) =>
  Effect.gen(function* () {
    if ((yield* run("id", ["-u", user], { timeoutMs: 5_000 })).exitCode === 0) {
      return [{ level: "ok", message: "System service user exists", detail: user }] satisfies ServiceResult[];
    }
    if (!create) {
      return [{ level: "fail", message: "System service user does not exist", detail: user }] satisfies ServiceResult[];
    }
    const result = yield* run("useradd", ["--system", "--home-dir", paths.dataDir, "--create-home", "--shell", "/usr/sbin/nologin", user], { timeoutMs: 20_000 });
    if (result.exitCode === 0) return [{ level: "ok", message: "Created system service user", detail: user }] satisfies ServiceResult[];
    return [{ level: "fail", message: "Failed to create system service user", detail: result.stderr.trim() || user }] satisfies ServiceResult[];
  });

const runLaunchctl = (args: readonly string[], allowFailure: boolean) =>
  run("launchctl", args, { timeoutMs: 15_000 }).pipe(
    Effect.map((result): ServiceResult[] => {
      if (result.exitCode === 0) return [{ level: "ok", message: commandLine("launchctl", args) }];
      if (allowFailure) return [];
      return [{ level: "warn", message: `${commandLine("launchctl", args)} failed`, detail: result.stderr.trim() || undefined }];
    }),
  );

const runSystemctl = (args: readonly string[], allowFailure: boolean) =>
  run("systemctl", args, { timeoutMs: 20_000 }).pipe(
    Effect.map((result): ServiceResult =>
      result.exitCode === 0
        ? { level: "ok", message: commandLine("systemctl", args) }
        : {
            level: allowFailure ? "ok" : "warn",
            message: `${commandLine("systemctl", args)} ${allowFailure ? "was not active" : "failed"}`,
            detail: result.stderr.trim() || undefined,
          },
    ),
  );

function macPlist(command: ServiceCommand, paths: PicoHostPaths, logPath: string, errorPath: string): string {
  const args = [command.executable, ...command.args];
  const argXml = args.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PICO_HOST_DATA_DIR</key><string>${xmlEscape(paths.dataDir)}</string>
    <key>PICO_WORKSPACES_DIR</key><string>${xmlEscape(paths.workspacesDir)}</string>
    <key>PICO_HOST_BIND</key><string>${xmlEscape(paths.host)}</string>
    <key>PICO_HOST_PORT</key><string>${paths.port}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>${xmlEscape(paths.workspacesDir)}</string>
  <key>StandardOutPath</key><string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(errorPath)}</string>
</dict>
</plist>
`;
}

function linuxUserUnit(command: ServiceCommand, paths: PicoHostPaths): string {
  return `[Unit]
Description=Pico host
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdQuote(paths.workspacesDir)}
ExecStart=${systemdQuote(command.executable)} ${command.args.map(systemdQuote).join(" ")}
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production
Environment=PICO_HOST_DATA_DIR=${systemdQuote(paths.dataDir)}
Environment=PICO_WORKSPACES_DIR=${systemdQuote(paths.workspacesDir)}
Environment=PICO_HOST_BIND=${systemdQuote(paths.host)}
Environment=PICO_HOST_PORT=${paths.port}

[Install]
WantedBy=default.target
`;
}

// ../../../host/deploy resolves correctly from both src/host (tsx) and dist/host (prod).
function deployTemplatesDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../host/deploy");
}

function needsSystemDropIn(paths: PicoHostPaths, systemUser: string, release: PicoHostReleasePaths): boolean {
  return (
    systemUser !== DEFAULT_SYSTEM_USER ||
    paths.dataDir !== "/var/lib/pico-host" ||
    paths.workspacesDir !== "/var/lib/pico-host/workspaces" ||
    paths.host !== "127.0.0.1" ||
    paths.port !== 7777 ||
    release.installDir !== "/opt/pico-workspace"
  );
}

// Empty `ReadWritePaths=`/`ExecStart=` reset the base unit's values before re-setting (systemd drop-in semantics).
function systemDropIn(paths: PicoHostPaths, systemUser: string, release: PicoHostReleasePaths): string {
  const cli = `${release.currentLink}/packages/cli/dist/index.js`;
  return `[Service]
User=${systemUser}
Group=${systemUser}
WorkingDirectory=${systemdQuote(release.currentLink)}
Environment=HOME=${systemdQuote(paths.dataDir)}
Environment=PICO_HOST_DATA_DIR=${systemdQuote(paths.dataDir)}
Environment=PICO_WORKSPACES_DIR=${systemdQuote(paths.workspacesDir)}
Environment=PICO_HOST_BIND=${systemdQuote(paths.host)}
Environment=PICO_HOST_PORT=${paths.port}
ReadWritePaths=
ReadWritePaths=${systemdQuote(paths.dataDir)}
ExecStart=
ExecStart=/usr/bin/node --max-old-space-size=512 ${systemdQuote(cli)} serve
`;
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function systemdQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
