import { strict as assert } from "node:assert";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { RpcClient, RpcSerialization } from "@effect/rpc";
import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { PicoRpc } from "@pico/protocol/rpc";
import { WebSocket } from "ws";

// realpath so comparisons hold on platforms where tmpdir is a symlink (macOS
// /var -> /private/var); listFs and session cwd are canonicalized host-side.
const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), "pico-host-smoke-")));
const workspaceDir = join(tempRoot, "workspace");
mkdirSync(workspaceDir, { recursive: true });

process.env.NODE_ENV = "production";
process.env.PI_USE_MOCK = "1";
process.env.PI_ALLOW_UNSAFE_TEST_CLIENT = "1";
process.env.PICO_HOST_DB = join(tempRoot, "pico-host.db");
process.env.PICO_WORKSPACES_DIR = workspaceDir;
process.env.PI_CODING_AGENT_DIR = join(tempRoot, "agent");

const authHeaders = { "tailscale-user-login": "smoke@example.test" };

function addressInfo(serverAddress: string | AddressInfo | null): AddressInfo {
  assert(serverAddress && typeof serverAddress !== "string", "server did not expose a TCP address");
  return serverAddress;
}

type SmokeWireEvent = { t?: string; seq?: number; session?: { id?: string } };

function sessionWsUrl(wsUrl: string, sessionId: string, cursor: number): string {
  return `${wsUrl}/ws?session=${encodeURIComponent(sessionId)}&cursor=${cursor}`;
}

async function expectWsHello(wsUrl: string, sessionId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(sessionWsUrl(wsUrl, sessionId, 0), { headers: authHeaders });
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("timed out waiting for websocket hello"));
    }, 5_000);

    ws.once("error", reject);
    ws.once("message", (raw) => {
      clearTimeout(timeout);
      const event = JSON.parse(raw.toString()) as SmokeWireEvent;
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

async function sendPromptOverWs(wsUrl: string, sessionId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(sessionWsUrl(wsUrl, sessionId, 0), { headers: authHeaders });
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("timed out waiting for assistant response"));
    }, 10_000);

    ws.on("error", reject);
    ws.on("message", (raw) => {
      const event = JSON.parse(raw.toString()) as SmokeWireEvent;
      if (event.t === "hello") {
        ws.send(JSON.stringify({ t: "send", text: "smoke prompt" }));
      }
      if (event.t === "assistant_end") {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });
  });
}

async function collectInitialReplay(wsUrl: string, sessionId: string, cursor: number): Promise<SmokeWireEvent[]> {
  return await new Promise<SmokeWireEvent[]>((resolve, reject) => {
    const events: SmokeWireEvent[] = [];
    const ws = new WebSocket(sessionWsUrl(wsUrl, sessionId, cursor), { headers: authHeaders });
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("timed out waiting for websocket replay"));
    }, 5_000);

    ws.on("error", reject);
    ws.on("message", (raw) => {
      const event = JSON.parse(raw.toString()) as SmokeWireEvent;
      events.push(event);
      if (event.t === "queue" && event.seq === 0) {
        clearTimeout(timeout);
        ws.close();
        resolve(events);
      }
    });
  });
}

async function expectIncrementalWsReplay(wsUrl: string, sessionId: string): Promise<void> {
  await sendPromptOverWs(wsUrl, sessionId);

  const replay = await collectInitialReplay(wsUrl, sessionId, 0);
  assert.equal(replay[0]?.t, "hello");
  assert(replay.some((event) => event.t === "user_message"), "replay should include journaled user message");
  assert(replay.some((event) => event.t === "assistant_end"), "replay should include journaled assistant end");
  assert(!replay.some((event) => event.t === "log_reset"), "fresh cursor replay should not need a full log_reset");
}

// An RPC client over HTTP, sending the Tailscale identity header that the host
// would normally receive from `tailscale serve`.
function makeClientRuntime(baseUrl: string) {
  const ProtocolLive = RpcClient.layerProtocolHttp({
    url: `${baseUrl}/rpc`,
    transformClient: (client) =>
      HttpClient.mapRequest(client, HttpClientRequest.setHeader("tailscale-user-login", "smoke@example.test")),
  }).pipe(Layer.provide(RpcSerialization.layerJson), Layer.provide(FetchHttpClient.layer));
  return ManagedRuntime.make(ProtocolLive);
}

try {
  const { launchHttpServer } = await import("../src/host.ts");

  let resolveServer: (server: Server) => void;
  const serverReady = new Promise<Server>((resolve) => {
    resolveServer = resolve;
  });
  const running = launchHttpServer(0, "127.0.0.1", (server) => resolveServer(server));
  const server = await serverReady;

  try {
    await once(server, "listening");
    const address = addressInfo(server.address());
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const wsUrl = `ws://127.0.0.1:${address.port}`;

    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok");

    const clientRuntime = makeClientRuntime(baseUrl);
    const clientScope = await clientRuntime.runPromise(Scope.make());
    const client = await clientRuntime.runPromise(Scope.extend(RpcClient.make(PicoRpc), clientScope));
    const call = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => clientRuntime.runPromise(effect);

    const identityBeforeClaim = await call(client.system.identity());
    assert.equal(identityBeforeClaim.user, "smoke@example.test");
    assert.equal(identityBeforeClaim.claimed, false);

    const claim = await call(client.system.claim({}));
    assert.equal(claim.claimed, true);
    assert.equal(claim.owner, "smoke@example.test");

    const info = await call(client.system.info());
    assert.equal(typeof info.hostVersion, "string");
    assert.equal(typeof info.protocolVersion, "number");

    const fsListing = await call(client.fs.ls({ path: workspaceDir }));
    assert.equal(fsListing.path, workspaceDir);
    assert(Array.isArray(fsListing.entries));

    assert.deepEqual(await call(client.sessions.list({})), []);

    const session = await call(client.sessions.create({ cwd: workspaceDir, title: "Smoke session" }));
    assert.equal(typeof session.id, "string");
    assert(session.id.length > 0);
    assert.equal(session.cwd, workspaceDir);

    const patched = await call(client.sessions.patch({ id: session.id, title: "Smoke session renamed" }));
    assert.equal(patched.title, "Smoke session renamed");

    await call(client.sessions.controls({ id: session.id }));
    await call(client.sessions.queue({ id: session.id }));
    await call(client.sessions.stats({ id: session.id }));
    await call(client.sessions.tree({ id: session.id }));
    await call(client.sessions.commands({ id: session.id }));
    await call(client.commands.list());

    const authProviders = await call(client.auth.providers());
    assert(authProviders.providers.length > 3, "auth provider list should include API-key providers, not only OAuth providers");
    assert(authProviders.providers.some((provider) => provider.authType === "oauth"));
    assert(authProviders.providers.some((provider) => provider.authType === "api_key"));
    assert(authProviders.providers.some((provider) => provider.id === "openrouter"));

    const savedProviders = await call(client.auth.saveApiKey({ providerId: "openrouter", apiKey: "sk-smoke-test" }));
    assert.equal(savedProviders.providers.find((provider) => provider.id === "openrouter")?.configured, true);

    const exportRes = await fetch(`${baseUrl}/sessions/${encodeURIComponent(session.id)}/export.html`, {
      headers: authHeaders,
    });
    assert.equal(exportRes.status, 200);
    assert.match(exportRes.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(await exportRes.text(), /<!doctype html>/i);

    await expectWsHello(wsUrl, session.id);
    await expectIncrementalWsReplay(wsUrl, session.id);

    await call(client.sessions.remove({ id: session.id }));
    assert.deepEqual(await call(client.sessions.list({})), []);

    await clientRuntime.runPromise(Scope.close(clientScope, Exit.void));
    await clientRuntime.dispose();

    console.log("Pico host smoke tests passed");
  } finally {
    await running.stop();
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
