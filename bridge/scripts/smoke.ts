import { strict as assert } from "node:assert";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { WebSocket } from "ws";

const tempRoot = mkdtempSync(join(tmpdir(), "pi-bridge-smoke-"));
const workspaceDir = join(tempRoot, "workspace");
mkdirSync(workspaceDir, { recursive: true });

process.env.NODE_ENV = "production";
process.env.PI_USE_MOCK = "1";
process.env.BRIDGE_DB = join(tempRoot, "bridge.db");
process.env.PI_WORKSPACES_DIR = workspaceDir;

const authHeaders = { "tailscale-user-login": "smoke@example.test" };

type TrpcEnvelope<T> = { result?: { data: T }; error?: { message?: string } };

function addressInfo(serverAddress: string | AddressInfo | null): AddressInfo {
  assert(serverAddress && typeof serverAddress !== "string", "server did not expose a TCP address");
  return serverAddress;
}

async function trpcQuery<T>(baseUrl: string, path: string, input: object = {}): Promise<T> {
  const encodedInput = encodeURIComponent(JSON.stringify(input));
  const res = await fetch(`${baseUrl}/trpc/${path}?input=${encodedInput}`, { headers: authHeaders });
  return unwrapTrpc<T>(path, res, await res.json() as TrpcEnvelope<T>);
}

async function trpcMutation<T>(baseUrl: string, path: string, input: object = {}): Promise<T> {
  const res = await fetch(`${baseUrl}/trpc/${path}`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrapTrpc<T>(path, res, await res.json() as TrpcEnvelope<T>);
}

function unwrapTrpc<T>(path: string, res: Response, body: TrpcEnvelope<T>): T {
  if (!res.ok || body.error) {
    throw new Error(`${path} failed (${res.status}): ${body.error?.message ?? JSON.stringify(body)}`);
  }
  assert(body.result, `${path} did not return a tRPC result`);
  return body.result.data;
}

async function expectWsHello(wsUrl: string, sessionId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}/ws?session=${encodeURIComponent(sessionId)}&cursor=0`, {
      headers: authHeaders,
    });
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("timed out waiting for websocket hello"));
    }, 5_000);

    ws.once("error", reject);
    ws.once("message", (raw) => {
      clearTimeout(timeout);
      const event = JSON.parse(raw.toString()) as { t?: string; session?: { id?: string } };
      try {
        assert.equal(event.t, "hello");
        assert.equal(event.session?.id, sessionId);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        ws.close();
      }
    });
  });
}

try {
  const [{ makeHttpApp }, { bridgeRuntime }, { attachWebSocketUpgrade }] = await Promise.all([
    import("../src/http/app.ts"),
    import("../src/runtime.ts"),
    import("../src/server.ts"),
  ]);

  const app = makeHttpApp(bridgeRuntime);
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  const wss = attachWebSocketUpgrade(server, bridgeRuntime);

  try {
    await once(server, "listening");
    const address = addressInfo(server.address());
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const wsUrl = `ws://127.0.0.1:${address.port}`;

    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok");

    const identityBeforeClaim = await trpcQuery<{ user?: string; claimed: boolean }>(baseUrl, "system.identity");
    assert.equal(identityBeforeClaim.user, "smoke@example.test");
    assert.equal(identityBeforeClaim.claimed, false);

    const claim = await trpcMutation<{ claimed: true; owner: string }>(baseUrl, "system.claim");
    assert.equal(claim.claimed, true);
    assert.equal(claim.owner, "smoke@example.test");

    const info = await trpcQuery<{ bridgeVersion: string; protocolVersion: number }>(baseUrl, "system.info");
    assert.equal(typeof info.bridgeVersion, "string");
    assert.equal(typeof info.protocolVersion, "number");

    const fsListing = await trpcQuery<{ path: string; entries: unknown[] }>(baseUrl, "fs.ls", { path: workspaceDir });
    assert.equal(fsListing.path, workspaceDir);
    assert(Array.isArray(fsListing.entries));

    const branches = await trpcQuery<{ isRepo: boolean; branches: unknown[] }>(baseUrl, "git.branches", { cwd: workspaceDir });
    assert.equal(branches.isRepo, false);
    assert.deepEqual(branches.branches, []);

    const listBefore = await trpcQuery<unknown[]>(baseUrl, "sessions.list");
    assert.deepEqual(listBefore, []);

    const session = await trpcMutation<{ id: string; title: string; cwd: string }>(baseUrl, "sessions.create", {
      cwd: workspaceDir,
      title: "Smoke session",
    });
    assert(session.id.startsWith("s_"));
    assert.equal(session.cwd, workspaceDir);

    const patched = await trpcMutation<{ id: string; title: string }>(baseUrl, "sessions.patch", {
      id: session.id,
      title: "Smoke session renamed",
    });
    assert.equal(patched.title, "Smoke session renamed");

    await trpcQuery(baseUrl, "sessions.controls", { id: session.id });
    await trpcQuery(baseUrl, "sessions.queue", { id: session.id });
    await trpcQuery(baseUrl, "sessions.stats", { id: session.id });
    await trpcQuery(baseUrl, "sessions.tree", { id: session.id });
    await trpcQuery(baseUrl, "sessions.commands", { id: session.id });
    await trpcQuery(baseUrl, "commands.list");
    await trpcQuery(baseUrl, "auth.providers");

    const exportRes = await fetch(`${baseUrl}/sessions/${encodeURIComponent(session.id)}/export.html`, {
      headers: authHeaders,
    });
    assert.equal(exportRes.status, 200);
    assert.match(exportRes.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(await exportRes.text(), /<!doctype html>/i);

    await expectWsHello(wsUrl, session.id);

    await trpcMutation<void>(baseUrl, "sessions.remove", { id: session.id });
    const listAfter = await trpcQuery<unknown[]>(baseUrl, "sessions.list");
    assert.deepEqual(listAfter, []);

    console.log("bridge smoke tests passed");
  } finally {
    wss.close();
    server.close();
    await bridgeRuntime.dispose();
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
