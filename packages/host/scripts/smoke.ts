import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Socket from "@effect/platform/Socket";
import * as RpcClient from "@effect/rpc/RpcClient";
import * as Chunk from "effect/Chunk";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { WireEvent } from "@pico/protocol";
import { picoHttpProtocol, picoSocketProtocol } from "@pico/protocol/client";
import { PicoRpc, PicoSessionRpc } from "@pico/protocol/rpc";
import { WebSocket as WsWebSocket } from "ws";
import { randomUUIDv7 } from "node:crypto";

// realpath: tmpdir is a symlink on macOS (/var -> /private/var) but host-side paths are canonicalized.
const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), "pico-host-smoke-")));
const workspaceDir = join(tempRoot, "workspace");
mkdirSync(workspaceDir, { recursive: true });

process.env.NODE_ENV = "production";
process.env.PI_USE_MOCK = "1";
process.env.PI_ALLOW_UNSAFE_TEST_CLIENT = "1";
process.env.PICO_HOST_DB = join(tempRoot, "pico-host.db");
process.env.PICO_WORKSPACES_DIR = workspaceDir;
process.env.PICO_OWNER = "smoke@example.test";
process.env.PI_CODING_AGENT_DIR = join(tempRoot, "agent");

const authHeaders = { "tailscale-user-login": "smoke@example.test" };

// Sends the Tailscale identity header the host normally receives from `tailscale serve`.
function makeClientRuntime(baseUrl: string) {
  return ManagedRuntime.make(
    picoHttpProtocol(baseUrl, (client) =>
      HttpClient.mapRequest(client, HttpClientRequest.setHeader("tailscale-user-login", "smoke@example.test")),
    ),
  );
}

// `ws`'s WebSocket satisfies the W3C interface the Socket layer expects; the
// custom constructor injects the Tailscale header on the upgrade request.
const wsConstructor = Layer.succeed(
  Socket.WebSocketConstructor,
  (url) => new WsWebSocket(url, { headers: authHeaders }) as unknown as globalThis.WebSocket,
);

function makeSessionRuntime(baseUrl: string) {
  return ManagedRuntime.make(picoSocketProtocol(baseUrl, wsConstructor));
}

try {
  const { hostLayer } = await import("../src/host.ts");
  const hostScope = Effect.runSync(Scope.make());
  const host = await Effect.runPromise(Layer.buildWithScope(hostLayer(0), hostScope));
  const baseUrl = HttpServer.formatAddress(Context.get(host, HttpServer.HttpServer).address);

  try {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok");

    const clientRuntime = makeClientRuntime(baseUrl);
    const clientScope = await clientRuntime.runPromise(Scope.make());
    const client = await clientRuntime.runPromise(Scope.extend(RpcClient.make(PicoRpc), clientScope));
    const call = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => clientRuntime.runPromise(effect);

    assert.equal((await fetch(`${baseUrl}/`)).status, 401, "the app requires the owner's Tailscale identity");
    const spoofed = await fetch(`${baseUrl}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        _tag: "Request",
        id: "1",
        tag: "sessions.list",
        payload: {},
        headers: [["tailscale-user-login", "smoke@example.test"]],
      }),
    });
    assert.equal(spoofed.status, 401, "an identity header inside an RPC message must not authenticate");
    const crossSite = await fetch(`${baseUrl}/rpc`, {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "https://evil.example", ...authHeaders },
      body: JSON.stringify({ _tag: "Request", id: "1", tag: "sessions.list", payload: {}, headers: [] }),
    });
    assert.equal(crossSite.status, 403, "a cross-origin browser request must be refused");

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

    // Realtime channel over WS-RPC: subscribe to the event stream, drive a turn
    // via a command rpc, and confirm the journal replays from a fresh cursor.
    const sessionRuntime = makeSessionRuntime(baseUrl);
    const sessionScope = await sessionRuntime.runPromise(Scope.make());
    const sessionClient = await sessionRuntime.runPromise(Scope.extend(RpcClient.make(PicoSessionRpc), sessionScope));

    const eventsUntil = (cursor: number, done: (event: WireEvent) => boolean): Promise<readonly WireEvent[]> =>
      sessionRuntime.runPromise(
        sessionClient.session.events({ id: session.id, cursor }).pipe(
          Stream.takeUntil(done),
          Stream.runCollect,
          Effect.timeout(Duration.seconds(10)),
          Effect.map(Chunk.toReadonlyArray),
        ),
      );

    const hello = await eventsUntil(0, (event) => event.t === "hello");
    const first = hello[0];
    assert(first?.t === "hello", "first event should be hello");
    assert.equal(first.session.id, session.id);

    await sessionRuntime.runPromise(sessionClient.session.send({ id: session.id, text: "smoke prompt", mode: "steer", clientId: randomUUIDv7() }));

    const replay = await eventsUntil(0, (event) => event.t === "assistant_end");
    assert.equal(replay[0]?.t, "hello");
    assert(replay.some((event) => event.t === "user_message"), "replay should include journaled user message");
    assert(replay.some((event) => event.t === "assistant_end"), "replay should include journaled assistant end");

    await sessionRuntime.runPromise(Scope.close(sessionScope, Exit.void));
    await sessionRuntime.dispose();

    await call(client.sessions.remove({ id: session.id }));
    assert.deepEqual(await call(client.sessions.list({})), []);

    await clientRuntime.runPromise(Scope.close(clientScope, Exit.void));
    await clientRuntime.dispose();

    console.log("Pico host smoke tests passed");
  } finally {
    await Effect.runPromise(Scope.close(hostScope, Exit.void));
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
