import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DEFAULT_PICO_HOST_PORT = 7777;
export const DEFAULT_PICO_HOST_BIND = "127.0.0.1";

export interface PicoHostPaths {
  readonly dataDir: string;
  readonly workspacesDir: string;
  readonly dbPath: string;
  readonly host: string;
  readonly port: number;
}

export function defaultPicoHostDataDir(): string {
  if (process.platform === "darwin") return join(homedir(), "Library/Application Support/Pico/Host");
  const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
  return join(xdgDataHome || join(homedir(), ".local/share"), "pico/host");
}

export function picoHostPathsFromEnv(env: NodeJS.ProcessEnv = process.env): PicoHostPaths {
  const dataDir = resolve(env.PICO_HOST_DATA_DIR || defaultPicoHostDataDir());
  const workspacesDir = resolve(env.PICO_WORKSPACES_DIR || env.INIT_CWD || process.cwd());
  return picoHostPaths({ dataDir, workspacesDir, env });
}

export function systemPicoHostPathsFromEnv(systemUser = "pico-host", env: NodeJS.ProcessEnv = process.env): PicoHostPaths {
  const defaultDataDir = join("/var/lib", systemUser || "pico-host");
  const dataDir = resolve(env.PICO_HOST_DATA_DIR || defaultDataDir);
  const workspacesDir = resolve(env.PICO_WORKSPACES_DIR || join(dataDir, "workspaces"));
  return picoHostPaths({ dataDir, workspacesDir, env });
}

function picoHostPaths(options: { readonly dataDir: string; readonly workspacesDir: string; readonly env: NodeJS.ProcessEnv }): PicoHostPaths {
  const port = Number(options.env.PICO_HOST_PORT || DEFAULT_PICO_HOST_PORT);
  const host = options.env.PICO_HOST_BIND || DEFAULT_PICO_HOST_BIND;
  return {
    dataDir: options.dataDir,
    workspacesDir: options.workspacesDir,
    dbPath: join(options.dataDir, "pico-host.db"),
    host,
    port,
  };
}
