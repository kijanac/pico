import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import type { LocalAdminPairingData } from "@pico/protocol/admin";
import type { PicoHostHandle } from "@pico/host";
import { startPicoHost } from "@pico/host";
import { getLocalAdminPairing, rotateLocalAdminPairingToken } from "./admin.ts";
import { PicoSetupError, type Diagnostic } from "./errors.ts";
import { healthcheck, portIsOpen } from "./network.ts";
import { getOrCreatePairingToken, readPairingToken, rotatePairingToken } from "./pairing.ts";
import { picoHostPathsFromEnv, type PicoHostPaths } from "./paths.ts";
import { ensureTailscaleServe } from "./tailscale.ts";

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

export interface PrepareServingOptions {
  readonly paths?: PicoHostPaths;
  readonly configureServe?: boolean;
  readonly inheritTailscaleStdio?: boolean;
}

export interface ServingPlan {
  readonly host: PicoHostHandle;
  readonly hostUrl?: string;
  readonly localUrl: string;
  readonly workspacesDir: string;
  readonly dataDir: string;
  readonly diagnostics: readonly Diagnostic[];
}

export const preparePairing = (options: PreparePairingOptions = {}) =>
  Effect.gen(function* () {
    const paths = options.paths ?? picoHostPathsFromEnv();
    const diagnostics: Diagnostic[] = [];
    yield* ensurePicoHostDirectories(paths);

    const existing = yield* portIsOpen(paths.host, paths.port).pipe(Effect.catchAll(() => Effect.succeed(false)));
    const adminPairing = existing ? yield* readRunningHostPairing(paths, Boolean(options.rotate), diagnostics) : undefined;
    const token = yield* pairingTokenForPlan(paths, existing, adminPairing, Boolean(options.rotate));

    let host: PicoHostHandle | undefined;
    let foregroundHostStarted = false;
    if (!existing && options.startHost) {
      const started = yield* startHost(paths, token);
      host = started;
      foregroundHostStarted = true;
      yield* waitForPicoHostHealth(paths).pipe(Effect.tapError(() => closeQuietly(started)));
    }

    const tailscale = yield* ensureTailscaleServe(paths.port, {
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

export const prepareServing = (options: PrepareServingOptions = {}) =>
  Effect.gen(function* () {
    const paths = options.paths ?? picoHostPathsFromEnv();
    yield* ensurePicoHostDirectories(paths);

    if (yield* portIsOpen(paths.host, paths.port).pipe(Effect.catchAll(() => Effect.succeed(false)))) {
      return yield* Effect.fail(new PicoSetupError({
        code: "host_port_in_use",
        message: `Port ${paths.host}:${paths.port} is already in use`,
        detail: `${paths.host}:${paths.port}`,
        fix: "Stop the existing Pico host process, or set PICO_HOST_PORT.",
      }));
    }

    const token = yield* getOrCreatePairingTokenSafe(paths);
    const host = yield* startHost(paths, token);

    return yield* Effect.gen(function* () {
      yield* waitForPicoHostHealth(paths);
      const tailscale = yield* ensureTailscaleServe(paths.port, {
        configure: Boolean(options.configureServe),
        inheritStdio: options.inheritTailscaleStdio,
      });
      return {
        host,
        hostUrl: tailscale.serveUrl,
        localUrl: `http://${paths.host}:${paths.port}`,
        workspacesDir: paths.workspacesDir,
        dataDir: paths.dataDir,
        diagnostics: tailscale.diagnostics.filter((diagnostic) => diagnostic.level !== "ok"),
      } satisfies ServingPlan;
    }).pipe(Effect.tapError(() => closeQuietly(host)));
  });

const closeQuietly = (host: PicoHostHandle) => Effect.promise(() => host.close().catch(() => {}));

const ensurePicoHostDirectories = (paths: PicoHostPaths) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(paths.dataDir, { recursive: true });
    yield* fs.makeDirectory(paths.workspacesDir, { recursive: true });
  }).pipe(
    Effect.mapError((cause) => new PicoSetupError({
      code: "path_not_writable",
      message: "Could not prepare Pico host directories",
      detail: cause instanceof Error ? cause.message : String(cause),
      fix: "Check directory permissions or set PICO_HOST_DATA_DIR/PICO_WORKSPACES_DIR.",
      cause,
    })),
  );

const getOrCreatePairingTokenSafe = (paths: PicoHostPaths) =>
  getOrCreatePairingToken(paths.dataDir).pipe(
    Effect.mapError((cause) => new PicoSetupError({
      code: "path_not_writable",
      message: "Could not create Pico pairing token",
      detail: cause instanceof Error ? cause.message : String(cause),
      fix: `Check write access to ${paths.dataDir}.`,
      cause,
    })),
  );

const rotatePairingTokenSafe = (paths: PicoHostPaths) =>
  rotatePairingToken(paths.dataDir).pipe(
    Effect.mapError((cause) => new PicoSetupError({
      code: "path_not_writable",
      message: "Could not rotate Pico pairing token",
      detail: cause instanceof Error ? cause.message : String(cause),
      fix: `Check write access to ${paths.dataDir}.`,
      cause,
    })),
  );

const startHost = (paths: PicoHostPaths, token: string | undefined) =>
  Effect.tryPromise({
    try: () => startPicoHost({
      dbPath: paths.dbPath,
      workspacesDir: paths.workspacesDir,
      pairingToken: token,
      host: paths.host,
      port: paths.port,
      nodeEnv: process.env.NODE_ENV || "production",
    }),
    catch: (cause) => new PicoSetupError({
      code: "host_start_failed",
      message: "Could not start Pico host",
      detail: cause instanceof Error ? cause.message : String(cause),
      fix: "Run `pico doctor` for details, or set PICO_HOST_PORT if the port is occupied.",
      cause,
    }),
  });

const waitForPicoHostHealth = (paths: PicoHostPaths, timeoutMs = 15_000) =>
  Effect.gen(function* () {
    const localUrl = `http://${paths.host}:${paths.port}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = yield* healthcheck(localUrl, 1_000).pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (ok) return;
      yield* Effect.sleep("250 millis");
    }
    return yield* Effect.fail(new PicoSetupError({
      code: "host_health_timeout",
      message: "Timed out waiting for Pico host /healthz",
      detail: localUrl,
      fix: "Check `pico logs` or run `pico serve` in the foreground.",
    }));
  });

const readRunningHostPairing = (paths: PicoHostPaths, rotate: boolean, diagnostics: Diagnostic[]) =>
  (rotate ? rotateLocalAdminPairingToken(paths) : getLocalAdminPairing(paths)).pipe(
    Effect.map((pairing): LocalAdminPairingData | undefined => pairing),
    Effect.catchAll((error) => {
      if (rotate) {
        diagnostics.push({
          level: "warn",
          code: "local_admin_unavailable",
          label: "Local admin",
          detail: error instanceof Error ? error.message : String(error),
          fix: "Restart the host with the current Pico CLI if pairing token rotation/status is unavailable.",
        });
      }
      return Effect.succeed(undefined);
    }),
  );

const pairingTokenForPlan = (
  paths: PicoHostPaths,
  existing: boolean,
  adminPairing: LocalAdminPairingData | undefined,
  rotate: boolean,
) =>
  Effect.gen(function* () {
    if (existing) {
      return adminPairing?.token || process.env.PICO_PAIRING_TOKEN?.trim() || (yield* readPairingToken(paths.dataDir));
    }
    return rotate ? yield* rotatePairingTokenSafe(paths) : yield* getOrCreatePairingTokenSafe(paths);
  });
