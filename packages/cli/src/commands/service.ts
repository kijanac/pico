import { resolve } from "node:path";
import {
  defaultServiceCommand,
  installService,
  logsService,
  picoHostPathsFromEnv,
  serviceFilePath,
  startService,
  stopService,
  uninstallService,
  systemPicoHostPathsFromEnv,
  type ServiceMode,
} from "@pico/host";
import { printServiceResults } from "../lib/diagnostics.ts";

export interface ServiceCliOptions {
  readonly mode: ServiceMode;
  readonly systemUser?: string;
  readonly createSystemUser: boolean;
}

export function parseServiceCliOptions(args: readonly string[]): ServiceCliOptions {
  let mode: ServiceMode = "user";
  let systemUser: string | undefined;
  let createSystemUser = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--system") {
      mode = "system";
    } else if (arg === "--user") {
      const value = args[i + 1];
      if (!value) throw new Error("--user requires a service account name");
      systemUser = value;
      i += 1;
    } else if (arg === "--create-user") {
      createSystemUser = true;
    } else if (arg === "--help" || arg === "-h") {
      throw new Error(serviceUsage());
    } else {
      throw new Error(`Unknown service option: ${arg}`);
    }
  }

  if (mode === "user" && (systemUser || createSystemUser)) {
    throw new Error("--user and --create-user require --system");
  }

  return { mode, systemUser, createSystemUser };
}

function serviceUsage(): string {
  return `Service options:
  --system              Install/control a Linux system service instead of a per-user service
  --user <name>         Service account for --system (default: pico-host)
  --create-user         Create the --system service account if it does not exist
`;
}

function currentServiceCommand() {
  const override = process.env.PICO_SERVICE_COMMAND?.trim();
  if (override) {
    return { executable: "/bin/sh", args: ["-lc", `${override} serve`] };
  }
  return defaultServiceCommand(process.execPath, resolve(process.argv[1] ?? "pico"));
}

export function installCommand(options: ServiceCliOptions = { mode: "user", createSystemUser: false }): void {
  const paths = options.mode === "system"
    ? systemPicoHostPathsFromEnv(options.systemUser)
    : picoHostPathsFromEnv();
  const results = installService({
    command: currentServiceCommand(),
    paths,
    mode: options.mode,
    systemUser: options.systemUser,
    createSystemUser: options.createSystemUser,
  });
  if (printServiceResults(results)) return;
  console.log(`\nService file: ${serviceFilePath({ mode: options.mode })}`);
  if (options.mode === "system") {
    console.log("Run `pico status --system` or `pico logs --system` to inspect it.");
    console.log(`Expose it with: sudo tailscale serve --bg --https=443 http://localhost:${paths.port}`);
  } else {
    console.log("Run `pico status` or `pico logs` to inspect it.");
  }
}

export function uninstallCommand(options: ServiceCliOptions = { mode: "user", createSystemUser: false }): void {
  printServiceResults(uninstallService({ mode: options.mode }));
}

export function startCommand(options: ServiceCliOptions = { mode: "user", createSystemUser: false }): void {
  printServiceResults(startService({ mode: options.mode }));
}

export function stopCommand(options: ServiceCliOptions = { mode: "user", createSystemUser: false }): void {
  printServiceResults(stopService({ mode: options.mode }));
}

export function logsCommand(options: ServiceCliOptions = { mode: "user", createSystemUser: false }): void {
  logsService({ mode: options.mode });
}
