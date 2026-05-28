/**
 * Entry point — Node.
 *
 *   - Hono handles HTTP via @hono/node-server
 *   - WebSocket upgrade is intercepted on the underlying Node http.Server
 *     and routed through the `ws` package
 *   - One ManagedRuntime carries the Effect layers (SessionManager + PiClient)
 *     and is shared across all HTTP and WS callbacks
 */
import { Effect, Layer, ManagedRuntime, Logger, LogLevel } from "effect";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as v from "valibot";
import { PiClientFromEnv } from "./pi.ts";
import { SessionManager, SessionManagerLive } from "./session.ts";
import { StoreLive } from "./store.ts";
import { makeConnectionHandler, type WsBindings } from "./ws.ts";
import { loadCommands } from "./commands.ts";
import { handleFsLs } from "./fs.ts";

const PORT = Number(process.env.PORT ?? 7777);
// 0.0.0.0 by convenience in dev (so you can open the bridge from your
// LAN). Production sets HOST=127.0.0.1 so the only reachable surface
// is via `tailscale serve`, which proxies tailnet → localhost.
const HOST = process.env.HOST ?? "0.0.0.0";
const DB_PATH = process.env.BRIDGE_DB ?? "data/bridge.db";
const USING_MOCK = process.env.PI_USE_MOCK === "1";

// Ensure the directory for the DB file exists before opening.
mkdirSync(dirname(DB_PATH), { recursive: true });

/* ── runtime ─────────────────────────────────────────────────────────── */

const AppLayer = SessionManagerLive.pipe(
  Layer.provide(Layer.mergeAll(PiClientFromEnv, StoreLive(DB_PATH))),
);
const runtime = ManagedRuntime.make(
  Layer.mergeAll(AppLayer, Logger.minimumLogLevel(LogLevel.Info)),
);

const onConnection = makeConnectionHandler(runtime);

/* ── HTTP routes ─────────────────────────────────────────────────────── */

const CreateBody = v.object({
  cwd: v.string(),
  title: v.optional(v.string()),
  branch: v.optional(v.string()),
});

// Allowed fields on PATCH /sessions/:id. Both optional — but at least
// one must be present or the request is a no-op (we reject empty
// bodies to surface obvious client bugs).
const PatchBody = v.object({
  title: v.optional(v.string()),
  archived: v.optional(v.boolean()),
});

const SetModelBody = v.object({
  provider: v.string(),
  modelId: v.string(),
});

const CompactBody = v.object({
  instructions: v.optional(v.string()),
});

const app = new Hono();

// Capacitor serves the app from a custom origin such as
// capacitor://localhost. REST calls to the tailnet HTTPS bridge are therefore
// cross-origin inside the WebView even though curl/Safari can reach them.
// The bridge is protected by Tailscale, not by browser same-origin policy, so
// allow browser clients through CORS.
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type"],
  }),
);

app.get("/healthz", (c) => c.text("ok"));

app.get("/sessions", async (c) => {
  const list = await runtime.runPromise(
    Effect.flatMap(SessionManager, (m) => m.list()),
  );
  return c.json(list);
});

app.post("/sessions", async (c) => {
  const body = v.safeParse(CreateBody, await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ error: "invalid_body", issues: body.issues }, 400);
  }
  const meta = await runtime
    .runPromise(Effect.flatMap(SessionManager, (m) => m.create(body.output)))
    .catch((e: unknown) => {
      runtime.runFork(Effect.logError("create failed", e));
      return null;
    });
  if (!meta) return c.json({ error: "create_failed" }, 500);
  return c.json(meta, 201);
});

app.get("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const opt = await runtime.runPromise(
    Effect.flatMap(SessionManager, (m) => m.get(id)),
  );
  if (opt._tag === "None") return c.json({ error: "not_found" }, 404);
  return c.json(opt.value);
});

/**
 * Partial update: rename, archive, or restore from archive. Returns
 * the updated SessionMeta on success.
 *
 *   PATCH /sessions/:id   { "title": "new name" }
 *   PATCH /sessions/:id   { "archived": true }   # archive
 *   PATCH /sessions/:id   { "archived": false }  # restore
 *
 * Empty bodies are rejected with 400 — a client that wants a no-op
 * patch is almost certainly a bug.
 */
app.patch("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const body = v.safeParse(PatchBody, await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ error: "invalid_body", issues: body.issues }, 400);
  }
  if (
    body.output.title === undefined &&
    body.output.archived === undefined
  ) {
    return c.json({ error: "empty_patch" }, 400);
  }

  const result = await runtime
    .runPromiseExit(
      Effect.flatMap(SessionManager, (m) => m.patch(id, body.output)),
    );
  if (result._tag === "Failure") {
    // SessionNotFound is the only tagged failure that surfaces here.
    return c.json({ error: "not_found" }, 404);
  }
  return c.json(result.value);
});

/**
 * Hard delete. Removes the session row and every persisted event for
 * it. Live PiSession is torn down; subscribers see the WS close.
 */
app.delete("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const result = await runtime.runPromiseExit(
    Effect.flatMap(SessionManager, (m) => m.remove(id)),
  );
  if (result._tag === "Failure") {
    return c.json({ error: "not_found" }, 404);
  }
  return c.body(null, 204);
});

app.get("/sessions/:id/models", async (c) => {
  const id = c.req.param("id");
  const result = await runtime.runPromiseExit(
    Effect.flatMap(SessionManager, (m) => m.listModels(id)),
  );
  if (result._tag === "Failure") {
    return c.json({ error: "models_failed", detail: String(result.cause) }, 500);
  }
  return c.json(result.value);
});

app.post("/sessions/:id/model", async (c) => {
  const id = c.req.param("id");
  const body = v.safeParse(SetModelBody, await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ error: "invalid_body", issues: body.issues }, 400);
  }
  const result = await runtime.runPromiseExit(
    Effect.flatMap(SessionManager, (m) =>
      m.setModel(id, body.output.provider, body.output.modelId),
    ),
  );
  if (result._tag === "Failure") {
    return c.json({ error: "set_model_failed", detail: String(result.cause) }, 500);
  }
  return c.json({ ok: true });
});

app.post("/sessions/:id/compact", async (c) => {
  const id = c.req.param("id");
  const body = v.safeParse(CompactBody, await c.req.json().catch(() => ({})));
  if (!body.success) {
    return c.json({ error: "invalid_body", issues: body.issues }, 400);
  }
  const result = await runtime.runPromiseExit(
    Effect.flatMap(SessionManager, (m) =>
      m.compact(id, body.output.instructions),
    ),
  );
  if (result._tag === "Failure") {
    return c.json({ error: "compact_failed", detail: String(result.cause) }, 500);
  }
  return c.json({ ok: true });
});

app.get("/commands", (c) => c.json(loadCommands()));
app.get("/fs/ls", handleFsLs);

/* ── boot ────────────────────────────────────────────────────────────── */

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST });

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const sessionId = url.searchParams.get("session");
  const cursor = Number(url.searchParams.get("cursor") ?? "0");
  if (!sessionId) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const bindings: WsBindings = { sessionId, cursor };
  wss.handleUpgrade(request, socket, head, (ws) => {
    onConnection(ws, bindings);
  });
});

runtime.runFork(
  Effect.logInfo(
    `pi-bridge listening on http://${HOST}:${PORT}  ${USING_MOCK ? "(mock pi)" : "(live pi)"}\n` +
      `   db   :  ${DB_PATH}\n` +
      `   REST :  GET    /healthz\n` +
      `           GET    /sessions\n` +
      `           POST   /sessions       { cwd, title?, branch? }\n` +
      `           GET    /sessions/:id\n` +
      `           PATCH  /sessions/:id   { title?, archived? }\n` +
      `           DELETE /sessions/:id\n` +
      `   WS   :  /ws?session=:id&cursor=:n`,
  ),
);

/* ── graceful shutdown ───────────────────────────────────────────────── */

const shutdown = async () => {
  await runtime.runPromise(Effect.logInfo("shutting down…"));
  wss.close();
  server.close();
  await runtime.dispose();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
