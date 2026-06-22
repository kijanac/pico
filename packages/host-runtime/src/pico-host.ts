import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

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

// Best-effort: reads the embedded Pi SDK's package.json. Any failure (resolution,
// missing file, bad JSON) degrades to undefined.
export const getBundledPiSdkVersion: Effect.Effect<string | undefined, never, FileSystem.FileSystem> =
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const packageJsonPath = yield* Effect.try(() => {
      const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
      return join(dirname(dirname(entry)), "package.json");
    });
    const raw = yield* fs.readFileString(packageJsonPath, "utf8");
    return yield* Effect.try(() => (JSON.parse(raw) as { version?: string }).version);
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

/**
 * Public host runner entrypoint for CLIs and future package extraction.
 *
 * Most host runtime internals still read configuration from process env at module
 * initialization time. This wrapper keeps that constraint out of callers:
 * pass explicit paths/tokens here, and it imports the configured host only
 * after the env has been populated.
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
