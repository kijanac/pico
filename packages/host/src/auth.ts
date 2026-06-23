import { timingSafeEqual } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { HostErrorCode } from "@pico/protocol";
import { DB_PATH, HOST_INSECURE_NO_AUTH, INITIAL_PAIRING_TOKEN } from "./config.ts";
import { HostClaimError } from "./errors.ts";

// Disabled only via PICO_HOST_INSECURE_NO_AUTH.
const REQUIRE_TAILSCALE_AUTH = !HOST_INSECURE_NO_AUTH;
let pairingToken = INITIAL_PAIRING_TOKEN;

const ALLOWED_ORIGINS = [
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "http://localhost:5173",
];

export const allowedOrigins = () => ALLOWED_ORIGINS;

export type AuthResult =
  | { ok: true; user?: string; claimed: boolean }
  | { ok: false; status: 401 | 403; error: HostErrorCode; user?: string };

// Lowercased keys; `string[]` covers node's multi-valued headers. The tRPC fetch
// adapter's web `Headers` is converted to this shape at its call site.
export type HeaderSource = Record<string, string | string[] | undefined>;

export function headerValue(headers: HeaderSource, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

interface OwnerDb {
  readonly db: DatabaseSync;
  readonly insertFirstOwner: StatementSync;
  readonly selectOwners: StatementSync;
}

let ownerDb: OwnerDb | undefined;

function getOwnerDb(): OwnerDb {
  if (ownerDb) return ownerDb;
  // HOST_DATA_DIR is created by the Store layer at boot.
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pico_host_owners (
      login      TEXT PRIMARY KEY,
      claimed_at INTEGER NOT NULL
    ) STRICT;
  `);
  const legacyOwnersTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bridge_owners'").get();
  if (legacyOwnersTable) {
    db.exec(`
      INSERT OR IGNORE INTO pico_host_owners (login, claimed_at)
      SELECT login, claimed_at FROM bridge_owners;
    `);
  }
  ownerDb = {
    db,
    insertFirstOwner: db.prepare(`
      INSERT INTO pico_host_owners (login, claimed_at)
      SELECT ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM pico_host_owners)
    `),
    selectOwners: db.prepare(`SELECT login FROM pico_host_owners ORDER BY login`),
  };
  return ownerDb;
}

function ownerLogins(): Set<string> {
  const rows = getOwnerDb().selectOwners.all() as Array<{ login: string }>;
  return new Set(rows.map((row) => row.login));
}

export function picoHostOwnerLogins(): string[] {
  return [...ownerLogins()].sort();
}

export function currentPairingToken(): string | undefined {
  return pairingToken;
}

export function setPairingToken(token: string | undefined): void {
  pairingToken = token?.trim() || undefined;
}

function pairingTokenMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function assertPairingToken(token: string | undefined, owners: Set<string>): void {
  if (!pairingToken || owners.size > 0) return;
  if (!token || !pairingTokenMatches(token.trim(), pairingToken)) {
    throw new HostClaimError({ hostErrorCode: "invalid_pairing_token" });
  }
}

export function claimPicoHostOwner(login: string, token?: string): { claimed: true; owner: string } {
  const owner = login.trim().toLowerCase();
  if (!owner) throw new Error("owner login is required");

  const owners = ownerLogins();
  assertPairingToken(token, owners);

  const result = getOwnerDb().insertFirstOwner.run(owner, Date.now());
  if (result.changes === 1) return { claimed: true, owner };

  if (owners.has(owner) || ownerLogins().has(owner)) return { claimed: true, owner };
  throw new HostClaimError({ hostErrorCode: "pico_host_already_claimed" });
}

// SECURITY INVARIANT: identity comes solely from the `tailscale-user-login`
// header, which is trustworthy only because (1) the server binds loopback
// (main.ts), so the sole ingress is Tailscale Serve, and (2) `tailscale serve`
// strips client-supplied `Tailscale-*` headers and injects its own. Both must
// hold — never bind this process to a non-loopback host, and never front it
// with a proxy that forwards client `Tailscale-*` headers, or callers can
// spoof any identity.
export function authorizeHeaders(headers: HeaderSource): AuthResult {
  if (!REQUIRE_TAILSCALE_AUTH) return { ok: true, claimed: true };

  const login = headerValue(headers, "tailscale-user-login")?.trim().toLowerCase();
  if (!login) {
    return {
      ok: false,
      status: 401,
      error: "missing_tailscale_identity",
    };
  }

  const owners = ownerLogins();
  if (owners.size > 0 && !owners.has(login)) {
    return {
      ok: false,
      status: 403,
      error: "tailscale_user_not_pico_host_owner",
      user: login,
    };
  }

  return { ok: true, user: login, claimed: owners.size > 0 };
}
