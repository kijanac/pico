import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { type PicoHostPaths, picoHostPathsFromEnv } from "./paths.ts";

export interface LocalAdminStatus {
  readonly ok: true;
  readonly pid: number;
  readonly uptimeSeconds: number;
  readonly cwd: string;
  readonly dataDir: string;
  readonly dbPath: string;
  readonly workspacesDir: string;
  readonly claimed: boolean;
  readonly owners: string[];
  readonly pairingTokenConfigured: boolean;
  readonly system?: {
    readonly hostVersion: string;
    readonly protocolVersion: number;
    readonly minMobileVersion: string;
    readonly recommendedMobileVersion: string;
    readonly updateChannel: string;
    readonly autoUpdate: boolean;
  };
}

export interface LocalAdminPairing extends LocalAdminStatus {
  readonly token?: string;
  readonly tokenConfigured: boolean;
}

export function localAdminTokenPath(dataDir: string): string {
  return join(dataDir, "admin-token");
}

export const readLocalAdminToken = (dataDir: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(localAdminTokenPath(dataDir))),
    Effect.map((token) => token.trim() || undefined),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );

const localAdminFetch = <T>(
  path: string,
  opts: { readonly paths?: PicoHostPaths; readonly method?: "GET" | "POST" } = {},
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
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5_000),
        }),
      catch: toError,
    });

    if (!response.ok) {
      const text = yield* Effect.promise(() => response.text().catch(() => ""));
      return yield* Effect.fail(new Error(`local admin ${path} failed: ${response.status}${text ? ` ${text}` : ""}`));
    }
    return (yield* Effect.tryPromise({ try: () => response.json(), catch: toError })) as T;
  });

export const getLocalAdminStatus = (paths?: PicoHostPaths) =>
  localAdminFetch<LocalAdminStatus>("/admin/status", { paths });

export const getLocalAdminPairing = (paths?: PicoHostPaths) =>
  localAdminFetch<LocalAdminPairing>("/admin/pairing", { paths });

export const rotateLocalAdminPairingToken = (paths?: PicoHostPaths) =>
  localAdminFetch<LocalAdminPairing>("/admin/pairing/rotate", { paths, method: "POST" });
