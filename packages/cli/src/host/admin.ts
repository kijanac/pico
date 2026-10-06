import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import {
  LocalAdminPairing,
  LocalAdminSessionRelease,
  LocalAdminStatus,
} from "@pico/protocol/admin";
import { type PicoHostPaths, picoHostPathsFromEnv } from "./paths.ts";

export function localAdminTokenPath(dataDir: string): string {
  return join(dataDir, "admin-token");
}

export const readLocalAdminToken = (dataDir: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(localAdminTokenPath(dataDir))),
    Effect.map((token) => token.trim() || undefined),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );

const localAdminFetch = <A, I>(
  path: string,
  schema: Schema.Schema<A, I>,
  opts: {
    readonly paths?: PicoHostPaths;
    readonly method?: "GET" | "POST";
    readonly payload?: unknown;
  } = {},
) =>
  Effect.gen(function* () {
    const paths = opts.paths ?? picoHostPathsFromEnv();
    const token = yield* readLocalAdminToken(paths.dataDir);
    if (!token) {
      return yield* Effect.fail(new Error(`local admin token not found at ${localAdminTokenPath(paths.dataDir)}`));
    }

    const toError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`http://${paths.host}:${paths.port}${path}`, {
          method: opts.method ?? "GET",
          headers: {
            authorization: `Bearer ${token}`,
            ...(opts.payload === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(opts.payload === undefined ? {} : { body: JSON.stringify(opts.payload) }),
          signal: AbortSignal.timeout(15_000),
        }),
      catch: toError,
    });

    if (!response.ok) {
      const text = yield* Effect.promise(() => response.text().catch(() => ""));
      return yield* Effect.fail(new Error(`local admin ${path} failed: ${response.status}${text ? ` ${text}` : ""}`));
    }
    const json = yield* Effect.tryPromise({ try: () => response.json(), catch: toError });
    return yield* Schema.decodeUnknown(schema)(json).pipe(
      Effect.mapError((cause) => new Error(`local admin ${path} returned an unexpected shape`, { cause })),
    );
  });

export const getLocalAdminStatus = (paths?: PicoHostPaths) =>
  localAdminFetch("/admin/status", LocalAdminStatus, { paths });

export const getLocalAdminPairing = (paths?: PicoHostPaths) =>
  localAdminFetch("/admin/pairing", LocalAdminPairing, { paths });

export const rotateLocalAdminPairingToken = (paths?: PicoHostPaths) =>
  localAdminFetch("/admin/pairing/rotate", LocalAdminPairing, { paths, method: "POST" });

export const releaseLocalAdminSession = (id: string, paths?: PicoHostPaths) =>
  localAdminFetch("/admin/session/release", LocalAdminSessionRelease, {
    paths,
    method: "POST",
    payload: { id },
  }).pipe(
    Effect.flatMap((result) => result.ok
      ? Effect.succeed(result)
      : Effect.fail(new Error(result.error))),
  );
