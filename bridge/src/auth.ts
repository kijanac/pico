import { mkdirSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Context, Next } from "hono";
import { BRIDGE_DATA_DIR, DB_PATH } from "./config.ts";

// Auth is ON by default and must be explicitly disabled — a missing or wrong
// NODE_ENV can no longer silently open the bridge. Only local dev sets this.
export const BRIDGE_INSECURE_NO_AUTH = process.env.PI_BRIDGE_INSECURE_NO_AUTH === "1";
const REQUIRE_TAILSCALE_AUTH = !BRIDGE_INSECURE_NO_AUTH;

const ALLOWED_ORIGINS = [
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "http://localhost:5173",
];

export const allowedOrigins = () => ALLOWED_ORIGINS;

export function isAllowedBrowserOrigin(origin: string | undefined): boolean {
  if (!origin || BRIDGE_INSECURE_NO_AUTH) return true;
  return allowedOrigins().includes(origin);
}

export type AuthResult =
  | { ok: true; user?: string; claimed: boolean }
  | { ok: false; status: 401 | 403; error: string; user?: string };

const firstHeader = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const UNCLAIMED_ALLOWED_PATHS = new Set([
  "/trpc/system.info",
  "/trpc/system.identity",
  "/trpc/system.claim",
]);

const isAllowedBeforeClaim = (path: string): boolean => UNCLAIMED_ALLOWED_PATHS.has(path);

interface OwnerDb {
  readonly db: DatabaseSync;
  readonly insertFirstOwner: StatementSync;
  readonly selectOwners: StatementSync;
}

let ownerDb: OwnerDb | undefined;

function getOwnerDb(): OwnerDb {
  if (ownerDb) return ownerDb;
  mkdirSync(BRIDGE_DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS bridge_owners (
      login      TEXT PRIMARY KEY,
      claimed_at INTEGER NOT NULL
    ) STRICT;
  `);
  ownerDb = {
    db,
    insertFirstOwner: db.prepare(`
      INSERT INTO bridge_owners (login, claimed_at)
      SELECT ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM bridge_owners)
    `),
    selectOwners: db.prepare(`SELECT login FROM bridge_owners ORDER BY login`),
  };
  return ownerDb;
}

function ownerLogins(): Set<string> {
  const rows = getOwnerDb().selectOwners.all() as Array<{ login: string }>;
  return new Set(rows.map((row) => row.login));
}

export function claimBridgeOwner(login: string): { claimed: true; owner: string } {
  const owner = login.trim().toLowerCase();
  if (!owner) throw new Error("owner login is required");

  const result = getOwnerDb().insertFirstOwner.run(owner, Date.now());
  if (result.changes === 1) return { claimed: true, owner };

  if (ownerLogins().has(owner)) return { claimed: true, owner };
  throw new Error("bridge is already claimed");
}

// SECURITY INVARIANT: identity comes solely from the `tailscale-user-login`
// header, which is trustworthy only because (1) the server binds loopback
// (main.ts), so the sole ingress is Tailscale Serve, and (2) `tailscale serve`
// strips client-supplied `Tailscale-*` headers and injects its own. Both must
// hold — never bind this process to a non-loopback host, and never front it
// with a proxy that forwards client `Tailscale-*` headers, or callers can
// spoof any identity.
export function authorizeHeaders(headers: IncomingHttpHeaders | Headers): AuthResult {
  if (!REQUIRE_TAILSCALE_AUTH) return { ok: true, claimed: true };

  const get = (name: string): string | undefined =>
    headers instanceof Headers
      ? headers.get(name) ?? undefined
      : firstHeader(headers[name.toLowerCase()]);

  const login = get("tailscale-user-login")?.trim().toLowerCase();
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
      error: "tailscale_user_not_bridge_owner",
      user: login,
    };
  }

  return { ok: true, user: login, claimed: owners.size > 0 };
}

export async function requireTailscaleAuth(c: Context, next: Next): Promise<Response | void> {
  if (new URL(c.req.url).pathname === "/healthz") {
    await next();
    return;
  }

  const result = authorizeHeaders(c.req.raw.headers);
  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }
  const path = new URL(c.req.url).pathname;
  if (!result.claimed && !isAllowedBeforeClaim(path)) {
    return c.json({ error: "bridge_unclaimed" }, 403);
  }
  await next();
}
