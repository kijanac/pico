import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { commandLine, run, runStderr } from "./exec.ts";
import { picoHostPathsFromEnv, type PicoHostPaths } from "./paths.ts";

const MAC_LABEL = "dev.pico.host";
const LINUX_UNIT = "pico-host.service";
const DEFAULT_SYSTEM_USER = "pico-host";

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

export function installService(options: ServiceOptions): ServiceResult[] {
  validateServiceCommand(options.command);
  const paths = options.paths ?? picoHostPathsFromEnv();

  if (options.mode === "system") return installLinuxSystemService(options.command, paths, options);
  mkdirSync(paths.dataDir, { recursive: true });
  if (process.platform === "darwin") return installMacService(options.command, paths);
  if (process.platform === "linux") return installLinuxUserService(options.command, paths);
  return [{ level: "warn", message: `pico install is not implemented for ${process.platform}` }];
}

export function uninstallService(options: ServiceControlOptions = {}): ServiceResult[] {
  if (options.mode === "system") {
    if (process.platform !== "linux") return [{ level: "fail", message: "system services are only implemented for Linux/systemd" }];
    if (process.getuid?.() !== 0) return [{ level: "fail", message: "pico uninstall --system must run as root" }];
    const unit = serviceFilePath({ mode: "system" });
    const results: ServiceResult[] = [];
    results.push(runSystemctl(["disable", "--now", LINUX_UNIT], true));
    if (existsSync(unit)) rmSync(unit, { force: true });
    results.push(runSystemctl(["daemon-reload"], true));
    results.push({ level: "ok", message: "Removed system service", detail: unit });
    return results;
  }

  if (process.platform === "darwin") {
    const plist = serviceFilePath();
    const results = runLaunchctl(["bootout", `gui/${userInfo().uid}`, plist], true);
    if (existsSync(plist)) rmSync(plist, { force: true });
    return [...results, { level: "ok", message: "Removed LaunchAgent", detail: plist }];
  }
  if (process.platform === "linux") {
    const unit = serviceFilePath();
    const results: ServiceResult[] = [];
    results.push(runSystemctl(["--user", "disable", "--now", LINUX_UNIT], true));
    if (existsSync(unit)) rmSync(unit, { force: true });
    results.push(runSystemctl(["--user", "daemon-reload"], true));
    results.push({ level: "ok", message: "Removed systemd user unit", detail: unit });
    return results;
  }
  return [{ level: "warn", message: `pico uninstall is not implemented for ${process.platform}` }];
}

export function startService(options: ServiceControlOptions = {}): ServiceResult[] {
  if (options.mode === "system") {
    if (process.platform !== "linux") return [{ level: "fail", message: "system services are only implemented for Linux/systemd" }];
    if (process.getuid?.() !== 0) return [{ level: "fail", message: "pico start --system must run as root" }];
    return [runSystemctl(["start", LINUX_UNIT], false)];
  }
  if (process.platform === "darwin") {
    const plist = serviceFilePath();
    return [
      ...runLaunchctl(["bootstrap", `gui/${userInfo().uid}`, plist], true),
      ...runLaunchctl(["kickstart", "-k", `gui/${userInfo().uid}/${MAC_LABEL}`], false),
    ];
  }
  if (process.platform === "linux") return [runSystemctl(["--user", "start", LINUX_UNIT], false)];
  return [{ level: "warn", message: `pico start is not implemented for ${process.platform}` }];
}

export function stopService(options: ServiceControlOptions = {}): ServiceResult[] {
  if (options.mode === "system") {
    if (process.platform !== "linux") return [{ level: "fail", message: "system services are only implemented for Linux/systemd" }];
    if (process.getuid?.() !== 0) return [{ level: "fail", message: "pico stop --system must run as root" }];
    return [runSystemctl(["stop", LINUX_UNIT], false)];
  }
  if (process.platform === "darwin") return runLaunchctl(["bootout", `gui/${userInfo().uid}/${MAC_LABEL}`], true);
  if (process.platform === "linux") return [runSystemctl(["--user", "stop", LINUX_UNIT], false)];
  return [{ level: "warn", message: `pico stop is not implemented for ${process.platform}` }];
}

export function logsService(options: ServiceControlOptions = {}): void {
  if (options.mode === "system") {
    run("journalctl", ["-u", LINUX_UNIT, "-n", "80", "-f"], { stdio: "inherit" });
    return;
  }
  const paths = picoHostPathsFromEnv();
  if (process.platform === "darwin") {
    const logPath = join(paths.dataDir, "pico-host.log");
    run("tail", ["-n", "80", "-f", logPath], { stdio: "inherit" });
    return;
  }
  if (process.platform === "linux") {
    run("journalctl", ["--user", "-u", LINUX_UNIT, "-n", "80", "-f"], { stdio: "inherit" });
    return;
  }
  console.log(`pico logs is not implemented for ${process.platform}`);
}

function installMacService(command: ServiceCommand, paths: PicoHostPaths): ServiceResult[] {
  const plist = serviceFilePath();
  mkdirSync(dirname(plist), { recursive: true });
  const logPath = join(paths.dataDir, "pico-host.log");
  const errorPath = join(paths.dataDir, "pico-host.err.log");
  writeFileSync(plist, macPlist(command, paths, logPath, errorPath));

  return [
    { level: "ok", message: "Wrote LaunchAgent", detail: plist },
    ...runLaunchctl(["bootout", `gui/${userInfo().uid}`, plist], true),
    ...runLaunchctl(["bootstrap", `gui/${userInfo().uid}`, plist], false),
    ...runLaunchctl(["enable", `gui/${userInfo().uid}/${MAC_LABEL}`], true),
  ];
}

function installLinuxUserService(command: ServiceCommand, paths: PicoHostPaths): ServiceResult[] {
  const unit = serviceFilePath();
  mkdirSync(dirname(unit), { recursive: true });
  writeFileSync(unit, linuxUserUnit(command, paths));
  return [
    { level: "ok", message: "Wrote systemd user unit", detail: unit },
    runSystemctl(["--user", "daemon-reload"], false),
    runSystemctl(["--user", "enable", "--now", LINUX_UNIT], false),
  ];
}

function installLinuxSystemService(command: ServiceCommand, paths: PicoHostPaths, options: ServiceOptions): ServiceResult[] {
  if (process.platform !== "linux") return [{ level: "fail", message: "system services are only implemented for Linux/systemd" }];
  if (process.getuid?.() !== 0) return [{ level: "fail", message: "pico install --system must run as root" }];

  const systemUser = options.systemUser?.trim() || DEFAULT_SYSTEM_USER;
  const results = ensureSystemUser(systemUser, paths, Boolean(options.createSystemUser));
  if (results.some((result) => result.level === "fail")) return results;

  mkdirSync(dirname(serviceFilePath({ mode: "system" })), { recursive: true });
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.workspacesDir, { recursive: true });
  results.push(run("chown", ["-R", systemUser, paths.dataDir, paths.workspacesDir], { timeoutMs: 20_000 }).status === 0
    ? { level: "ok", message: "Prepared service directories", detail: `${paths.dataDir}, ${paths.workspacesDir}` }
    : { level: "warn", message: "Could not chown service directories", detail: `ensure ${systemUser} can write ${paths.dataDir} and ${paths.workspacesDir}` });

  const unit = serviceFilePath({ mode: "system" });
  writeFileSync(unit, linuxSystemUnit(command, paths, systemUser));
  results.push(
    { level: "ok", message: "Wrote system service", detail: unit },
    runSystemctl(["daemon-reload"], false),
    runSystemctl(["enable", "--now", LINUX_UNIT], false),
  );
  return results;
}

function ensureSystemUser(user: string, paths: PicoHostPaths, create: boolean): ServiceResult[] {
  if (run("id", ["-u", user], { timeoutMs: 5_000 }).status === 0) {
    return [{ level: "ok", message: "System service user exists", detail: user }];
  }

  if (!create) {
    return [{
      level: "fail",
      message: "System service user does not exist",
      detail: user,
      // extra property intentionally omitted from public shape; detail is enough for CLI output
    }];
  }

  const result = run("useradd", ["--system", "--home-dir", paths.dataDir, "--create-home", "--shell", "/usr/sbin/nologin", user], { timeoutMs: 20_000 });
  if (result.status === 0) return [{ level: "ok", message: "Created system service user", detail: user }];
  return [{ level: "fail", message: "Failed to create system service user", detail: runStderr(result).trim() || result.error?.message || user }];
}

function runLaunchctl(args: readonly string[], allowFailure: boolean): ServiceResult[] {
  const result = run("launchctl", args, { timeoutMs: 15_000 });
  if (result.status === 0) return [{ level: "ok", message: commandLine("launchctl", args) }];
  if (allowFailure) return [];
  return [{ level: "warn", message: `${commandLine("launchctl", args)} failed`, detail: runStderr(result).trim() || result.error?.message }];
}

function runSystemctl(args: readonly string[], allowFailure: boolean): ServiceResult {
  const result = run("systemctl", args, { timeoutMs: 20_000 });
  if (result.status === 0) return { level: "ok", message: commandLine("systemctl", args) };
  return {
    level: allowFailure ? "ok" : "warn",
    message: `${commandLine("systemctl", args)} ${allowFailure ? "was not active" : "failed"}`,
    detail: runStderr(result).trim() || result.error?.message,
  };
}

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

function linuxSystemUnit(command: ServiceCommand, paths: PicoHostPaths, systemUser: string): string {
  return `[Unit]
Description=Pico host
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${systemUser}
WorkingDirectory=${systemdQuote(paths.workspacesDir)}
ExecStart=${systemdQuote(command.executable)} ${command.args.map(systemdQuote).join(" ")}
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production
Environment=PICO_HOST_DATA_DIR=${systemdQuote(paths.dataDir)}
Environment=PICO_WORKSPACES_DIR=${systemdQuote(paths.workspacesDir)}
Environment=PICO_HOST_BIND=${systemdQuote(paths.host)}
Environment=PICO_HOST_PORT=${paths.port}
Environment=PICO_SKIP_TAILSCALE_SERVE=1
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`;
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function systemdQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
