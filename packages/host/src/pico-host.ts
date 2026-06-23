import { VERSION } from "@earendil-works/pi-coding-agent";

export interface PicoHostHandle {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  close: () => Promise<void>;
}

export interface StartPicoHostOptions {
  readonly dbPath: string;
  readonly workspacesDir: string;
  readonly pairingToken?: string;
  readonly host?: string;
  readonly port?: number;
  readonly nodeEnv?: string;
}

// The Pi SDK version bundled with this host, surfaced by `pico doctor`.
export const bundledPiSdkVersion: string = VERSION;

/**
 * Host internals read config from process env at module init, so env must be
 * populated before the host is imported.
 */
export async function startPicoHost(options: StartPicoHostOptions): Promise<PicoHostHandle> {
  process.env.PICO_HOST_DB = options.dbPath;
  process.env.PICO_WORKSPACES_DIR = options.workspacesDir;
  if (options.pairingToken) process.env.PICO_PAIRING_TOKEN = options.pairingToken;
  if (options.nodeEnv) process.env.NODE_ENV = options.nodeEnv;
  else if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

  const host = await import("./host.ts");
  return host.startPicoHost({ host: options.host, port: options.port });
}
