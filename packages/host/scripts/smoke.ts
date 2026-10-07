import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
import type { Entry, ServerMessage } from "@pico/protocol";
import { applyEntry, emptyLog } from "@pico/protocol/log";
import { picoHttpProtocol, picoSocketProtocol } from "@pico/protocol/client";
import { PicoRpc, PicoSessionRpc } from "@pico/protocol/rpc";
import { WebSocket as WsWebSocket } from "ws";
import { randomUUIDv7 } from "node:crypto";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

// realpath: tmpdir is a symlink on macOS (/var -> /private/var) but host-side paths are canonicalized.
const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), "pico-host-smoke-")));
const workspaceDir = join(tempRoot, "workspace");
mkdirSync(workspaceDir, { recursive: true });

process.env.PICO_HOST_DB = join(tempRoot, "pico-host.db");
process.env.PICO_OWNER = "smoke@example.test";
process.env.PI_CODING_AGENT_DIR = join(tempRoot, "agent");
// pi runs as in production, with pi-ai's scripted model as its default.
mkdirSync(process.env.PI_CODING_AGENT_DIR);
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, "settings.json"), JSON.stringify({ defaultProvider: "faux", defaultModel: "faux-1" }));

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
  const { getAgentModelRuntime } = await import("../src/pi.ts");
  const faux = createFauxCore({ provider: "faux", models: [{ id: "faux-1" }], tokensPerSecond: 100 });
  (await getAgentModelRuntime()).registerProvider("faux", {
    api: faux.api,
    // Required for custom models; the scripted stream never calls it.
    baseUrl: "http://faux.invalid",
    apiKey: "faux",
    streamSimple: faux.streamSimple,
    models: faux.models,
  });
  faux.setResponses([
    fauxAssistantMessage([fauxText("Running the tests first."), fauxToolCall("bash", { command: "for i in 1 2 3; do echo \"test $i ok\"; sleep 0.2; done" })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Done: the tests pass."),
  ]);
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

    assert.deepEqual(await call(client.sessions.list({ fresh: true })), []);

    const session = await call(client.sessions.create({ cwd: workspaceDir, title: "Smoke session" }));
    assert.equal(typeof session.id, "string");
    assert(session.id.length > 0);
    assert.equal(session.cwd, workspaceDir);

    const patched = await call(client.sessions.patch({ id: session.id, title: "Smoke session renamed" }));
    assert.equal(patched.title, "Smoke session renamed");

    await call(client.sessions.controls({ id: session.id }));
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

    // The live channel: a sync from the phone's bookmark, then changes. Sends go
    // over HTTP and are safe to repeat.
    const sessionRuntime = makeSessionRuntime(baseUrl);
    const sessionScope = await sessionRuntime.runPromise(Scope.make());
    const sessionClient = await sessionRuntime.runPromise(Scope.extend(RpcClient.make(PicoSessionRpc), sessionScope));

    const liveUntil = (head: string | null, done: (message: ServerMessage) => boolean): Promise<readonly ServerMessage[]> =>
      sessionRuntime.runPromise(
        sessionClient.session.live({ id: session.id, head, cids: [] }).pipe(
          Stream.takeUntil(done),
          Stream.runCollect,
          Effect.timeout(Duration.seconds(20)),
          Effect.map(Chunk.toReadonlyArray),
        ),
      );
    const entriesOf = (messages: readonly ServerMessage[]): Entry[] =>
      messages.flatMap((message) => (message.t === "sync" || message.t === "entries" ? message.entries : []));

    const [empty] = await liveUntil(null, () => true);
    assert(empty?.t === "sync" && empty.reset && empty.entries.length === 0, "a new session syncs empty");
    assert.equal(empty.session.id, session.id);

    const turn = liveUntil(null, (message) => message.t === "run" && !message.running);
    // Let the subscription attach before the run starts.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const send = (cid: string, text: string, opts: { base?: string | null; retry?: boolean } = {}) =>
      call(client.sessions.send({ id: session.id, cid, text, mode: "steer", base: opts.base ?? null, retry: opts.retry ?? false }));
    const promptCid = randomUUIDv7();
    assert.equal((await send(promptCid, "smoke prompt")).state, "started");
    assert.notEqual((await send(promptCid, "smoke prompt")).state, "failed", "a repeated cid is the same send");
    const steerCid = randomUUIDv7();
    assert.equal((await send(steerCid, "smoke steer")).state, "queued", "a send during a run is queued");
    const messages = await turn;

    const rows = emptyLog();
    for (const entry of entriesOf(messages)) applyEntry(rows, entry);
    const users = rows.entries.filter((row) => row.kind === "user");
    assert.deepEqual(users.map((row) => [row.text, row.cid]), [["smoke prompt", promptCid], ["smoke steer", steerCid]], "each send became one entry, linked by cid");
    assert(rows.entries.some((row) => row.kind === "tool_call" && row.tool === "bash" && row.status === "ok"), "tool rows complete from their results");
    assert(messages.some((message) => message.t === "out"), "tool output streams live");
    assert(messages.some((message) => message.t === "d"), "reply text streams live");

    // pi exports a session once it has a conversation.
    const exportRes = await fetch(`${baseUrl}/sessions/${encodeURIComponent(session.id)}/export.html`, {
      headers: authHeaders,
    });
    assert.equal(exportRes.status, 200);
    assert.match(exportRes.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(await exportRes.text(), /<!doctype html>/i);
    const leaf = [...messages].reverse().find((message) => message.t === "entries")?.leaf ?? null;
    const [caughtUp] = await liveUntil(leaf, () => true);
    assert(caughtUp?.t === "sync" && !caughtUp.reset && caughtUp.entries.length === 0, "a current phone gets nothing to catch up");
    const firstUser = users[0]?.id ?? null;
    const [behind] = await liveUntil(firstUser, () => true);
    assert(behind?.t === "sync" && !behind.reset && behind.entries.length > 0 && behind.entries[0]?.id !== firstUser, "a phone behind gets the entries after its bookmark");

    const page = await call(client.sessions.history({ id: session.id, before: users[1]!.id }));
    assert(page.entries.some((entry) => entry.type === "user" && entry.cid === promptCid), "history pages back from an entry");

    const again = await send(randomUUIDv7(), "smoke prompt", { base: null, retry: true });
    assert.equal(again.state, "delivered", "a retry pi already saved isn't sent twice");

    await sessionRuntime.runPromise(Scope.close(sessionScope, Exit.void));
    await sessionRuntime.dispose();

    await call(client.sessions.remove({ id: session.id }));
    assert.deepEqual(await call(client.sessions.list({ fresh: true })), []);

    // Sessions pi saved without Pico are listed too, under their first message.
    const { SessionManager: PiSessionManager } = await import("@earendil-works/pi-coding-agent");
    const terminal = PiSessionManager.create(workspaceDir);
    terminal.appendMessage({ role: "user", content: "started in the\nterminal", timestamp: Date.now() });
    terminal.appendMessage(fauxAssistantMessage("Hello."));
    const terminalFile = terminal.getSessionFile()!;
    const [listed] = await call(client.sessions.list({ fresh: true }));
    assert.equal(listed?.id, terminal.getSessionId(), "pi's own sessions are listed");
    assert.equal(listed.title, "started in the terminal", "an unnamed session shows its first message");
    await call(client.sessions.patch({ id: listed.id, title: "named in Pico" }));
    assert.equal(PiSessionManager.open(terminalFile).getSessionName(), "named in Pico", "renaming names pi's session");
    assert.equal((await call(client.sessions.list({ fresh: true })))[0]?.title, "named in Pico");
    await call(client.sessions.remove({ id: listed.id }));
    assert(!existsSync(terminalFile), "deleting a session deletes pi's file");
    assert.deepEqual(await call(client.sessions.list({ fresh: true })), []);
    const elsewhere = PiSessionManager.create(workspaceDir);
    elsewhere.appendMessage({ role: "user", content: "deleted in the terminal", timestamp: Date.now() });
    elsewhere.appendMessage(fauxAssistantMessage("Hello."));
    assert.equal((await call(client.sessions.list({ fresh: true }))).length, 1);
    rmSync(elsewhere.getSessionFile()!);
    assert.deepEqual(await call(client.sessions.list({ fresh: true })), [], "a session deleted outside Pico leaves the list");

    await clientRuntime.runPromise(Scope.close(clientScope, Exit.void));
    await clientRuntime.dispose();

    console.log("Pico host smoke tests passed");
  } finally {
    await Effect.runPromise(Scope.close(hostScope, Exit.void));
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
