import { mkdirSync } from "node:fs";
import { Effect } from "effect";
import type { PicoHostHandle, StartPicoHostOptions } from "@pico/host-runtime/host";
import { startPicoHost } from "@pico/host-runtime/host";
import { getLocalAdminPairing, rotateLocalAdminPairingToken, type LocalAdminPairing } from "./admin.ts";
import { PicoSetupError, type Diagnostic } from "./errors.ts";
import { healthcheckEffect, portIsOpenEffect } from "./network.ts";
import { getOrCreatePairingToken, readPairingToken, rotatePairingToken } from "./pairing.ts";
import { picoHostPathsFromEnv, type PicoHostPaths } from "./paths.ts";
import { ensureTailscaleServeEffect } from "./tailscale.ts";

export interface PreparePairingOptions {
  readonly paths?: PicoHostPaths;
  readonly rotate?: boolean;
  readonly startHost?: boolean;
  readonly configureServe?: boolean;
  readonly inheritTailscaleStdio?: boolean;
}

export interface PairingPlan {
  readonly existing: boolean;
  readonly foregroundHostStarted: boolean;
  readonly host?: PicoHostHandle;
  readonly hostUrl?: string;
  readonly token?: string;
  readonly workspacesDir: string;
  readonly dataDir: string;
  readonly port: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly rotationUnavailable: boolean;
}

export function ensurePicoHostDirectoriesEffect(paths: PicoHostPaths): Effect.Effect<void, PicoSetupError> {
  return Effect.try({
    try: () => {
      mkdirSync(paths.dataDir, { recursive: true });
      mkdirSync(paths.workspacesDir, { recursive: true });
    },
    catch: (cause) => new PicoSetupError({
      code: "path_not_writable",
      message: "Could not prepare Pico host directories",
      detail: cause instanceof Error ? cause.message : String(cause),
      fix: "Check directory permissions or set PICO_HOST_DATA_DIR/PICO_WORKSPACES_DIR.",
      cause,
    }),
  });
}

export function preparePairingEffect(options: PreparePairingOptions = {}): Effect.Effect<PairingPlan, PicoSetupError> {
  return Effect.gen(function* () {
    const paths = options.paths ?? picoHostPathsFromEnv();
    const diagnostics: Diagnostic[] = [];
    yield* ensurePicoHostDirectoriesEffect(paths);

    const existing = yield* hostPortIsOpenEffect(paths);
    const adminPairing = existing ? yield* readRunningHostPairing(paths, Boolean(options.rotate), diagnostics) : undefined;
    const token = yield* pairingTokenForPlan(paths, existing, adminPairing, Boolean(options.rotate));

    let host: PicoHostHandle | undefined;
    let foregroundHostStarted = false;
    if (!existing && options.startHost) {
      host = yield* startPicoHostEffect({
        dbPath: paths.dbPath,
        workspacesDir: paths.workspacesDir,
        pairingToken: token,
        host: paths.host,
        port: paths.port,
        nodeEnv: process.env.NODE_ENV || "production",
      });
      foregroundHostStarted = true;
      const health = yield* waitForPicoHostHealthEffect(paths).pipe(Effect.either);
      if (health._tag === "Left") {
        yield* closePicoHostEffect(host);
        return yield* Effect.fail(health.left);
      }
    }

    const tailscale = yield* ensureTailscaleServeEffect(paths.port, {
      configure: Boolean(options.configureServe),
      inheritStdio: options.inheritTailscaleStdio,
    });
    diagnostics.push(...tailscale.diagnostics.filter((diagnostic) => diagnostic.level !== "ok"));

    return {
      existing,
      foregroundHostStarted,
      host,
      hostUrl: tailscale.serveUrl,
      token,
      workspacesDir: paths.workspacesDir,
      dataDir: paths.dataDir,
      port: paths.port,
      diagnostics,
      rotationUnavailable: Boolean(options.rotate && existing && !adminPairing),
    } satisfies PairingPlan;
  });
}

export function preparePairing(options: PreparePairingOptions = {}): Promise<PairingPlan> {
  return Effect.runPromise(preparePairingEffect(options));
}

export function hostPortIsOpenEffect(paths: PicoHostPaths): Effect.Effect<boolean, PicoSetupError> {
  return portIsOpenEffect(paths.host, paths.port);
}

export function getOrCreatePairingTokenEffect(paths: PicoHostPaths): Effect.Effect<string, PicoSetupError> {
  return Effect.try({
    try: () => getOrCreatePairingToken(paths.dataDir),
    catch: (cause) => new PicoSetupError({
      code: "path_not_writable",
      message: "Could not create Pico pairing token",
      detail: cause instanceof Error ? cause.message : String(cause),
      fix: `Check write access to ${paths.dataDir}.`,
      cause,
    }),
  });
}

export function rotatePairingTokenEffect(paths: PicoHostPaths): Effect.Effect<string, PicoSetupError> {
  return Effect.try({
    try: () => rotatePairingToken(paths.dataDir),
    catch: (cause) => new PicoSetupError({
      code: "path_not_writable",
      message: "Could not rotate Pico pairing token",
      detail: cause instanceof Error ? cause.message : String(cause),
      fix: `Check write access to ${paths.dataDir}.`,
      cause,
    }),
  });
}

export function startPicoHostEffect(options: StartPicoHostOptions): Effect.Effect<PicoHostHandle, PicoSetupError> {
  return Effect.tryPromise({
    try: () => startPicoHost(options),
    catch: (cause) => new PicoSetupError({
      code: "host_start_failed",
      message: "Could not start Pico host",
      detail: cause instanceof Error ? cause.message : String(cause),
      fix: "Run `pico doctor` for details, or set PICO_HOST_PORT if the port is occupied.",
      cause,
    }),
  });
}

export function closePicoHostEffect(host: PicoHostHandle): Effect.Effect<void> {
  return Effect.promise(() => host.close()).pipe(Effect.catchAll(() => Effect.void));
}

export function waitForPicoHostHealthEffect(paths: PicoHostPaths, timeoutMs = 15_000): Effect.Effect<void, PicoSetupError> {
  const localUrl = `http://${paths.host}:${paths.port}`;
  return Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const healthy = yield* healthcheckEffect(localUrl, 1_000).pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (healthy) return;
      yield* Effect.sleep("250 millis");
    }
    return yield* Effect.fail(new PicoSetupError({
      code: "host_health_timeout",
      message: "Timed out waiting for Pico host /healthz",
      detail: localUrl,
      fix: "Check `pico logs` or run `pico serve` in the foreground.",
    }));
  });
}

function readRunningHostPairing(paths: PicoHostPaths, rotate: boolean, diagnostics: Diagnostic[]): Effect.Effect<LocalAdminPairing | undefined> {
  return Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () => rotate ? rotateLocalAdminPairingToken(paths) : getLocalAdminPairing(paths),
      catch: (cause) => cause,
    }).pipe(Effect.either);
    if (result._tag === "Right") return result.right;
    if (rotate) {
      diagnostics.push({
        level: "warn",
        code: "local_admin_unavailable",
        label: "Local admin",
        detail: result.left instanceof Error ? result.left.message : String(result.left),
        fix: "Restart the host with the current Pico CLI if pairing token rotation/status is unavailable.",
      });
    }
    return undefined;
  });
}

function pairingTokenForPlan(
  paths: PicoHostPaths,
  existing: boolean,
  adminPairing: LocalAdminPairing | undefined,
  rotate: boolean,
): Effect.Effect<string | undefined, PicoSetupError> {
  if (existing) return Effect.succeed(adminPairing?.token || process.env.PICO_PAIRING_TOKEN?.trim() || readPairingToken(paths.dataDir));
  return rotate ? rotatePairingTokenEffect(paths) : getOrCreatePairingTokenEffect(paths);
}
