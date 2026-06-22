import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

export interface PairingLinkOptions {
  readonly hostUrl: string;
  readonly token?: string;
}

export function pairingTokenPath(dataDir: string): string {
  return join(dataDir, "pairing-token");
}

export function makePairingToken(): string {
  return randomBytes(24).toString("base64url");
}

export const readPairingToken = (dataDir: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(pairingTokenPath(dataDir))),
    Effect.map((token) => token.trim() || undefined),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );

export const writePairingToken = (dataDir: string, token: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = pairingTokenPath(dataDir);
    const trimmed = token.trim();
    yield* fs.makeDirectory(dataDir, { recursive: true });
    yield* fs.writeFileString(path, `${trimmed}\n`, { mode: 0o600 });
    yield* fs.chmod(path, 0o600);
    return trimmed;
  });

export const getOrCreatePairingToken = (dataDir: string) =>
  Effect.gen(function* () {
    const envToken = process.env.PICO_PAIRING_TOKEN?.trim();
    if (envToken) return envToken;
    const existing = yield* readPairingToken(dataDir);
    return existing ?? (yield* writePairingToken(dataDir, makePairingToken()));
  });

export const rotatePairingToken = (dataDir: string) => writePairingToken(dataDir, makePairingToken());

export function makePairingDeepLink(options: PairingLinkOptions): string {
  const url = new URL("pico://connect");
  url.searchParams.set("url", options.hostUrl);
  if (options.token) url.searchParams.set("claim", options.token);
  return url.toString();
}
