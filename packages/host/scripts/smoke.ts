import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, type AddressInfo, type Socket as NetSocket } from "node:net";
import { DatabaseSync } from "node:sqlite";
import type { Server } from "node:http";
import { HttpClient, HttpClientRequest, Socket } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { RpcClient } from "@effect/rpc";
import { Chunk, Duration, Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect";
import type { PicoAttachHello, PicoAttachHostMessage, PicoAttachRequest, WireEvent } from "@pico/protocol";
import { picoHttpProtocol, picoSocketProtocol } from "@pico/protocol/client";
import { PicoRpc, PicoSessionRpc } from "@pico/protocol/rpc";
import { WebSocket as WsWebSocket } from "ws";
import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import { v7 as randomUUIDv7 } from "uuid";

// realpath: tmpdir is a symlink on macOS (/var -> /private/var) but host-side paths are canonicalized.
const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), "pico-host-smoke-")));
const workspaceDir = join(tempRoot, "workspace");
mkdirSync(workspaceDir, { recursive: true });

process.env.NODE_ENV = "production";
process.env.PI_USE_MOCK = "1";
process.env.PI_ALLOW_UNSAFE_TEST_CLIENT = "1";
process.env.PICO_HOST_DATA_DIR = tempRoot;
process.env.PICO_HOST_DB = join(tempRoot, "pico-host.db");
process.env.PICO_WORKSPACES_DIR = workspaceDir;
process.env.PI_CODING_AGENT_DIR = join(tempRoot, "agent");
process.env.PICO_ATTACH_SOCKET = join(tempRoot, "pi-attach.sock");

// Exercise the upgrade from the pre-lifecycle schema and prove stale attached
// presence is removed by parsed metadata rather than normal session resume.
const legacyDb = new DatabaseSync(process.env.PICO_HOST_DB);
legacyDb.exec(`
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, cwd TEXT NOT NULL,
    status TEXT NOT NULL, updated_at INTEGER NOT NULL,
    tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
  ) STRICT;
`);
legacyDb.prepare(`
  INSERT INTO sessions
    (id, title, cwd, status, updated_at, tokens_in, tokens_out, cost_usd, created_at, archived)
  VALUES (?, ?, ?, 'idle', ?, 0, 0, 0, ?, 0)
`).run("attached:crash-residue", "stale terminal", workspaceDir, Date.now(), Date.now());
legacyDb.close();

const authHeaders = { "tailscale-user-login": "smoke@example.test" };

function addressInfo(serverAddress: string | AddressInfo | null): AddressInfo {
  assert(serverAddress && typeof serverAddress !== "string", "server did not expose a TCP address");
  return serverAddress;
}

class AttachSmokePeer {
  readonly requests: PicoAttachRequest[] = [];
  private buffer = "";
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private pendingHandoff: {
    readonly id: string;
    readonly resolve: (leaseId: string) => void;
    readonly reject: (error: Error) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  } | undefined;

  private constructor(
    private readonly socket: NetSocket,
    private readonly hello: PicoAttachHello,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.once("error", (error) => {
      this.rejectReady(error);
      this.pendingHandoff?.reject(error);
    });
  }

  static async connect(socketPath: string, hello: PicoAttachHello): Promise<AttachSmokePeer> {
    const socket = createConnection(socketPath);
    const peer = new AttachSmokePeer(socket, hello);
    await once(socket, "connect");
    peer.write(hello);
    await peer.ready;
    return peer;
  }

  async close(): Promise<void> {
    if (this.socket.destroyed) return;
    const closed = once(this.socket, "close");
    this.socket.end();
    await closed;
  }

  requestHandoff(runtimeSessionId: string, runtimeSessionFile: string, ownerPid: number): Promise<string> {
    assert(!this.pendingHandoff, "handoff already pending");
    const id = randomUUIDv7();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingHandoff = undefined;
        reject(new Error("handoff response timed out"));
      }, 10_000);
      timer.unref();
      this.pendingHandoff = { id, resolve, reject, timer };
      this.write({ t: "event", event: { t: "status", status: "idle" } });
      this.write({ t: "handoff", id, runtimeSessionId, runtimeSessionFile, ownerPid });
    });
  }

  private write(message: unknown): void {
    this.socket.write(`${JSON.stringify(message)}\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as PicoAttachHostMessage;
      if (message.t === "ready") {
        this.resolveReady();
      } else if (message.t === "error") {
        const error = new Error(message.error);
        this.rejectReady(error);
        this.pendingHandoff?.reject(error);
      } else if (message.t === "handoff_response") {
        const pending = this.pendingHandoff;
        if (!pending || pending.id !== message.id) continue;
        clearTimeout(pending.timer);
        this.pendingHandoff = undefined;
        if (message.ok) pending.resolve(message.leaseId);
        else pending.reject(new Error(message.error));
      } else {
        this.respond(message);
      }
    }
  }

  private respond(request: PicoAttachRequest): void {
    this.requests.push(request);
    let value: unknown;
    switch (request.method) {
      case "getSettings":
      case "patchSetting":
        value = { controls: [] };
        break;
      case "getStats":
        value = {
          sessionId: "smoke-terminal",
          cwd: this.hello.session.cwd,
          userMessages: 1,
          assistantMessages: 0,
          toolCalls: 0,
          toolResults: 0,
          totalMessages: 1,
          tokens: { input: 12, output: 4, cacheRead: 0, cacheWrite: 0, total: 16 },
          cost: 0.001,
        };
        break;
    }

    if (request.method === "send") {
      const { text, clientId } = request.params;
      this.write({
        t: "event",
        event: {
          t: "user_message",
          entry: { kind: "user", id: "attached-user-2", at: Date.now(), text, clientId },
        },
      });
      this.write({ t: "response", id: request.id, ok: true });
      this.write({
        t: "event",
        event: {
          t: "assistant_end",
          id: "attached-assistant-1",
          at: Date.now(),
          text: `terminal received: ${text}`,
        },
      });
      this.write({ t: "event", event: { t: "status", status: "idle" } });
      return;
    }
    this.write({ t: "response", id: request.id, ok: true, ...(value === undefined ? {} : { value }) });
  }
}

// Sends the Tailscale identity header the host normally receives from `tailscale serve`.
function makeClientRuntime(baseUrl: string) {
  return ManagedRuntime.make(
    picoHttpProtocol(baseUrl, (client) =>
      HttpClient.mapRequest(client, HttpClientRequest.setHeader("tailscale-user-login", "smoke@example.test")),
    ),
  );
}

// `ws`'s WebSocket satisfies the W3C interface the Socket layer expects; the
// custom constructor injects the Tailscale header on the upgrade request, which
// the WS-RPC server forwards into each rpc's headers (so AuthMiddleware sees it).
const wsConstructor = Layer.succeed(
  Socket.WebSocketConstructor,
  (url) => new WsWebSocket(url, { headers: authHeaders }) as unknown as globalThis.WebSocket,
);

function makeSessionRuntime(baseUrl: string) {
  return ManagedRuntime.make(picoSocketProtocol(baseUrl, wsConstructor));
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
    assert.deepEqual(await call(client.sessions.list({})), [], "stale presence should be removed during migration");

    const attachedId = "attached:smoke-terminal";
    const attachedHello: PicoAttachHello = {
      t: "hello",
      version: 1,
      session: {
        id: attachedId,
        title: "Attached terminal session",
        cwd: workspaceDir,
        status: "idle",
        updatedAt: new Date().toISOString(),
        tokens: { in: 12, out: 4 },
        costUsd: 0.001,
        archived: false,
        capabilities: ["stats", "rename", "settings", "interrupt"],
      },
      snapshot: [{ kind: "user", id: "attached-user-1", at: Date.now(), text: "terminal history" }],
    };
    const attachPeer = await AttachSmokePeer.connect(process.env.PICO_ATTACH_SOCKET, attachedHello);

    const attachedSessions = await call(client.sessions.list({}));
    assert.equal(attachedSessions.length, 1);
    assert.equal(attachedSessions[0]?.id, attachedId);
    assert.equal(attachedSessions[0]?.title, "Attached terminal session");
    assert.deepEqual(attachedSessions[0]?.capabilities, ["rename", "interrupt", "settings", "stats"]);
    assert.deepEqual(await call(client.sessions.controls({ id: attachedId })), { controls: [] });
    assert.equal((await call(client.sessions.stats({ id: attachedId }))).sessionId, attachedId);

    const attachedRuntime = makeSessionRuntime(baseUrl);
    const attachedScope = await attachedRuntime.runPromise(Scope.make());
    const attachedClient = await attachedRuntime.runPromise(Scope.extend(RpcClient.make(PicoSessionRpc), attachedScope));
    const attachedEventsUntil = (cursor: number, done: (event: WireEvent) => boolean): Promise<readonly WireEvent[]> =>
      attachedRuntime.runPromise(
        attachedClient.session.events({ id: attachedId, cursor }).pipe(
          Stream.takeUntil(done),
          Stream.runCollect,
          Effect.timeout(Duration.seconds(10)),
          Effect.map(Chunk.toReadonlyArray),
        ),
      );

    const attachedClientId = randomUUIDv7();
    await attachedRuntime.runPromise(
      attachedClient.session.send({
        id: attachedId,
        text: "remote prompt",
        mode: "steer",
        clientId: attachedClientId,
      }),
    );
    const attachedReplay = await attachedEventsUntil(0, (event) => event.t === "assistant_end");
    const remotePromptEvents = attachedReplay.filter(
      (event) => event.t === "user_message" && event.entry.clientId === attachedClientId,
    );
    assert.equal(remotePromptEvents.length, 1, "runtime echo must not duplicate the host-journaled mobile input");
    assert.equal(remotePromptEvents[0]?.t === "user_message" ? remotePromptEvents[0].entry.text : undefined, "remote prompt");
    assert(attachedReplay.some((event) => event.t === "assistant_end" && event.text === "terminal received: remote prompt"));
    const attachedSend = attachPeer.requests.find((request) => request.method === "send");
    assert.deepEqual(attachedSend?.params, { text: "remote prompt", mode: "steer", clientId: attachedClientId });

    assert(Exit.isFailure(await call(Effect.exit(client.sessions.compact({ id: attachedId })))));
    assert(Exit.isFailure(await call(Effect.exit(client.sessions.queue({ id: attachedId })))));

    const disconnectEvents = attachedEventsUntil(0, (event) => event.t === "status" && event.status === "error");
    await attachPeer.close();
    assert((await disconnectEvents).some((event) => event.t === "status" && event.status === "error"));
    await attachedRuntime.runPromise(Scope.close(attachedScope, Exit.void));
    await attachedRuntime.dispose();

    let attachedPresent = (await call(client.sessions.list({}))).some((session) => session.id === attachedId);
    for (let attempt = 0; attempt < 50 && attachedPresent; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      attachedPresent = (await call(client.sessions.list({}))).some((session) => session.id === attachedId);
    }
    assert.equal(attachedPresent, false);

    // Transfer a terminal-owned session to a new durable runtime while keeping
    // its logical Pico id. A separate child PID models the terminal owner so
    // the host can prove that process has exited before mock SDK resume.
    const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    await once(owner, "spawn");
    let handoffPeer: AttachSmokePeer | undefined;
    try {
      const runtimeSessionId = "handoff-terminal";
      const runtimeSessionFile = join(tempRoot, "handoff-terminal.jsonl");
      writeFileSync(runtimeSessionFile, `${JSON.stringify({
        type: "session",
        version: 3,
        id: runtimeSessionId,
        timestamp: new Date().toISOString(),
        cwd: workspaceDir,
      })}\n`);
      const handoffId = `attached:${runtimeSessionId}`;
      handoffPeer = await AttachSmokePeer.connect(process.env.PICO_ATTACH_SOCKET, {
        ...attachedHello,
        version: 3,
        piVersion: PI_VERSION,
        session: {
          ...attachedHello.session,
          id: handoffId,
          title: "Background handoff session",
          status: "thinking",
          canBackground: true,
          capabilities: ["stats", "rename", "settings", "interrupt"],
        },
      });

      await call(client.sessions.background({ id: handoffId }));
      assert(handoffPeer.requests.some((request) => request.method === "background"));
      await assert.rejects(
        handoffPeer.requestHandoff(runtimeSessionId, runtimeSessionFile, process.pid),
        /current process/,
      );
      const leaseId = await handoffPeer.requestHandoff(
        runtimeSessionId,
        runtimeSessionFile,
        owner.pid!,
      );
      assert.equal(typeof leaseId, "string");
      assert(leaseId.length > 0);
      const transferring = (await call(client.sessions.list({}))).find((session) => session.id === handoffId);
      assert.equal(transferring?.status, "waiting");
      assert.equal(transferring?.execution, "transferring");
      assert(
        Exit.isFailure(await call(Effect.exit(client.sessions.stats({ id: handoffId })))),
        "leased generations must reject new runtime operations",
      );

      owner.kill("SIGTERM");
      await once(owner, "exit");
      await handoffPeer.close();

      let backgroundSession = (await call(client.sessions.list({}))).find((session) => session.id === handoffId);
      for (
        let attempt = 0;
        attempt < 100 && !backgroundSession?.capabilities?.includes("archive");
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        backgroundSession = (await call(client.sessions.list({}))).find((session) => session.id === handoffId);
      }
      assert.equal(backgroundSession?.id, handoffId, "handoff must preserve Pico's logical session id");
      assert(backgroundSession);
      assert.equal(backgroundSession.status, "idle");
      assert.equal(backgroundSession.execution, "host");
      assert.equal(backgroundSession.canBackground, false);
      assert(backgroundSession.capabilities?.includes("archive"));
      assert(backgroundSession.capabilities?.includes("images"));
      assert.equal((await call(client.sessions.stats({ id: handoffId }))).sessionId, handoffId);

      const backgroundRuntime = makeSessionRuntime(baseUrl);
      const backgroundScope = await backgroundRuntime.runPromise(Scope.make());
      const backgroundClient = await backgroundRuntime.runPromise(
        Scope.extend(RpcClient.make(PicoSessionRpc), backgroundScope),
      );
      const backgroundEvents = backgroundRuntime.runPromise(
        backgroundClient.session.events({ id: handoffId, cursor: 0 }).pipe(
          Stream.takeUntil((event) => event.t === "status" && event.status === "idle"),
          Stream.runCollect,
          Effect.timeout(Duration.seconds(10)),
          Effect.map(Chunk.toReadonlyArray),
        ),
      );
      await backgroundRuntime.runPromise(backgroundClient.session.send({
        id: handoffId,
        text: "background prompt",
        mode: "steer",
        clientId: randomUUIDv7(),
      }));
      assert((await backgroundEvents).some((event) => event.t === "assistant_end"));
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = (await call(client.sessions.list({}))).find((candidate) => candidate.id === handoffId);
        if (current?.status === "idle") break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(
        (await call(client.sessions.list({}))).find((candidate) => candidate.id === handoffId)?.status,
        "idle",
      );
      await backgroundRuntime.runPromise(Scope.close(backgroundScope, Exit.void));
      await backgroundRuntime.dispose();

      // Re-run Store startup migrations against the live DB. Durable sessions
      // intentionally keep attached:* logical ids after handoff; the legacy
      // prefix backfill must never classify them as presence on later boots.
      const { Store, StoreLive } = await import("../src/store.ts");
      await Effect.runPromise(
        Effect.gen(function* () {
          const migrationStore = yield* Store;
          yield* migrationStore.close();
        }).pipe(
          Effect.provide(StoreLive(process.env.PICO_HOST_DB)),
          Effect.provide(NodeContext.layer),
        ),
      );
      const handoffDb = new DatabaseSync(process.env.PICO_HOST_DB, { readOnly: true });
      try {
        assert.deepEqual(
          { ...handoffDb.prepare(
            "SELECT lifecycle, runtime_session_id, runtime_session_file FROM sessions WHERE id = ?",
          ).get(handoffId) },
          {
            lifecycle: "durable",
            runtime_session_id: runtimeSessionId,
            runtime_session_file: runtimeSessionFile,
          },
        );
        const journalTypes = handoffDb
          .prepare("SELECT type FROM events WHERE session_id = ? ORDER BY seq")
          .all(handoffId)
          .map((row) => row.type);
        assert.equal(
          journalTypes[0],
          "log_reset",
          "handoff should start the new generation at an authoritative snapshot",
        );
      } finally {
        handoffDb.close();
      }
      const releaseResponse = await fetch(`${baseUrl}/admin/session/release`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${readFileSync(join(tempRoot, "admin-token"), "utf8").trim()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: "Background handoff session" }),
      });
      const releaseBody = await releaseResponse.text();
      assert.equal(releaseResponse.status, 200, releaseBody);
      const released = JSON.parse(releaseBody) as {
        ok: true;
        id: string;
        leaseId: string;
        runtimeSessionId: string;
        runtimeSessionFile: string;
      };
      assert.equal(released.ok, true);
      assert.equal(released.id, handoffId);
      assert.equal(released.runtimeSessionId, runtimeSessionId);
      assert.equal(released.runtimeSessionFile, runtimeSessionFile);

      const reclaimedPeer = await AttachSmokePeer.connect(process.env.PICO_ATTACH_SOCKET, {
        ...attachedHello,
        version: 3,
        piVersion: PI_VERSION,
        reclaimLeaseId: released.leaseId,
        session: {
          ...attachedHello.session,
          id: handoffId,
          title: "Background handoff session",
          execution: "terminal",
          canBackground: true,
          capabilities: ["stats", "rename", "settings", "interrupt"],
        },
      });
      assert.equal(
        (await call(client.sessions.list({}))).find((candidate) => candidate.id === handoffId)?.execution,
        "terminal",
      );
      await reclaimedPeer.close();
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (!(await call(client.sessions.list({}))).some((candidate) => candidate.id === handoffId)) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert(!(await call(client.sessions.list({}))).some((candidate) => candidate.id === handoffId));
    } finally {
      await handoffPeer?.close().catch(() => undefined);
      if (owner.exitCode === null && owner.signalCode === null) {
        owner.kill("SIGTERM");
        await once(owner, "exit").catch(() => undefined);
      }
    }

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
    await running.stop();
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
