import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

type AuthModule = typeof import("../src/auth.ts");

// config.ts reads env at import, so each test re-imports auth with its own env.
async function freshAuth(opts: { insecure?: boolean; owner?: string } = {}): Promise<AuthModule> {
  vi.resetModules();
  const dir = mkdtempSync(join(tmpdir(), "pico-auth-"));
  process.env.PICO_HOST_DB = join(dir, "host.db");
  process.env.PICO_WORKSPACES_DIR = dir;
  if (opts.insecure) process.env.PICO_HOST_INSECURE_NO_AUTH = "1";
  else delete process.env.PICO_HOST_INSECURE_NO_AUTH;
  if (opts.owner === undefined) delete process.env.PICO_OWNER;
  else process.env.PICO_OWNER = opts.owner;
  return import("../src/auth.ts");
}

describe("a host admits only its owner's Tailscale identity", () => {
  it("rejects a request that carries no identity", async () => {
    const auth = await freshAuth({ owner: "owner@example.test" });
    expect(auth.authorizeHeaders({})).toEqual({ ok: false, status: 401, error: "missing_tailscale_identity" });
  });

  it("admits the owner, ignoring case and surrounding whitespace", async () => {
    const auth = await freshAuth({ owner: " Owner@Example.Test " });
    expect(auth.authorizeHeaders({ "tailscale-user-login": "owner@example.test" })).toEqual({ ok: true });
    expect(auth.authorizeHeaders({ "tailscale-user-login": ["OWNER@example.test"] })).toEqual({ ok: true });
  });

  it("rejects every other identity", async () => {
    const auth = await freshAuth({ owner: "owner@example.test" });
    const impostors = [
      "",
      "owner",
      "owner@example.tes",
      "owner@example.test.evil",
      "not-the-owner@example.test",
      "ówner@example.test",
    ];
    for (const login of impostors) {
      expect(auth.authorizeHeaders({ "tailscale-user-login": login }).ok).toBe(false);
    }
    expect(auth.authorizeHeaders({ "tailscale-user-login": "bob@example.test" })).toEqual({
      ok: false,
      status: 403,
      error: "tailscale_user_not_pico_host_owner",
    });
  });

  it("refuses to start without an owner unless auth is explicitly off", async () => {
    await expect(freshAuth()).rejects.toThrow("PICO_OWNER is required");
    const auth = await freshAuth({ insecure: true });
    expect(auth.authorizeHeaders({})).toEqual({ ok: true });
  });
});
