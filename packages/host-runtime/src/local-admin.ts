import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Effect } from "effect";
import { HOST_DATA_DIR, DB_PATH, WORKSPACES_DIR } from "./config.ts";
import { currentPairingToken, headerValue, picoHostOwnerLogins, setPairingToken, type HeaderSource } from "./auth.ts";
import { hostSystemInfo } from "./http/system.ts";
import type { LocalAdminPairingData, LocalAdminStatusData } from "./http/api.ts";

const ADMIN_TOKEN_FILE = "admin-token";
const PAIRING_TOKEN_FILE = "pairing-token";

// `writeFileString`'s mode only applies on create; chmod enforces 0600 even when
// the file already exists.
const secureWrite = (fs: FileSystem.FileSystem, path: string, value: string) =>
  fs.writeFileString(path, `${value}\n`, { mode: 0o600 }).pipe(Effect.zipRight(fs.chmod(path, 0o600)));

export function localAdminTokenPath(): string {
  return join(HOST_DATA_DIR, ADMIN_TOKEN_FILE);
}

export function pairingTokenPath(): string {
  return join(HOST_DATA_DIR, PAIRING_TOKEN_FILE);
}

export const ensureLocalAdminToken = (): Effect.Effect<string, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = localAdminTokenPath();
    const existing = yield* fs
      .readFileString(path, "utf8")
      .pipe(Effect.map((raw) => raw.trim()), Effect.orElseSucceed(() => ""));
    if (existing) return existing;
    const token = randomBytes(32).toString("base64url");
    yield* secureWrite(fs, path, token);
    return token;
  });

const writePairingToken = (token: string): Effect.Effect<string, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const trimmed = token.trim();
    yield* secureWrite(fs, pairingTokenPath(), trimmed);
    setPairingToken(trimmed);
    return trimmed;
  });

function readAuthToken(headers: HeaderSource): string | undefined {
  const bearer = headerValue(headers, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || headerValue(headers, "x-pico-admin-token")?.trim() || undefined;
}

// A filesystem failure reading/creating the token denies admin access rather
// than crashing the request gate.
export const adminTokenAuthorized = (
  headers: HeaderSource,
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  ensureLocalAdminToken().pipe(
    Effect.map((expected) => {
      const actual = readAuthToken(headers);
      return Boolean(actual && actual === expected);
    }),
    Effect.orElseSucceed(() => false),
  );

export function adminStatus(): LocalAdminStatusData {
  const owners = picoHostOwnerLogins();
  return {
    ok: true,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    cwd: process.cwd(),
    dataDir: HOST_DATA_DIR,
    dbPath: DB_PATH,
    workspacesDir: WORKSPACES_DIR,
    system: hostSystemInfo(),
    owners,
    claimed: owners.length > 0,
    pairingTokenConfigured: Boolean(currentPairingToken()),
  };
}

export function adminPairing(): LocalAdminPairingData {
  return {
    token: currentPairingToken(),
    tokenConfigured: Boolean(currentPairingToken()),
    ...adminStatus(),
  };
}

export const rotatePairing = (): Effect.Effect<LocalAdminPairingData, PlatformError, FileSystem.FileSystem> =>
  writePairingToken(randomBytes(24).toString("base64url")).pipe(
    Effect.map((token) => ({ token, tokenConfigured: true, ...adminStatus() })),
  );
