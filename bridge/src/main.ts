import { Effect, Layer, ManagedRuntime, Logger, LogLevel } from "effect";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./config.ts";
import { PiClientFromEnv } from "./pi-env.ts";
import { ProviderAuthLive } from "./provider-auth.ts";
import { SessionManager, SessionManagerLive } from "./session.ts";
import { StoreLive } from "./store.ts";
import { makeConnectionHandler, type WsBindings } from "./ws.ts";
import { makeHttpApp } from "./http/app.ts";
import { authorizeHeaders, isAllowedBrowserOrigin } from "./auth.ts";

const PORT = 7777;
const HOST = "127.0.0.1";
const USING_MOCK = process.env.PI_USE_MOCK === "1";

mkdirSync(dirname(DB_PATH), { recursive: true });

const SessionLayer = SessionManagerLive.pipe(
  Layer.provide(Layer.mergeAll(PiClientFromEnv, StoreLive(DB_PATH))),
);
const AppLayer = Layer.mergeAll(SessionLayer, ProviderAuthLive);
const runtime = ManagedRuntime.make(
  Layer.mergeAll(AppLayer, Logger.minimumLogLevel(LogLevel.Info)),
);

const app = makeHttpApp(runtime);
const onConnection = makeConnectionHandler(runtime);
const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST });
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  if (!request.url || !request.headers.host) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const sessionId = url.searchParams.get("session");
  const rawCursor = url.searchParams.get("cursor");
  if (!sessionId || rawCursor === null) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const cursor = Number(rawCursor);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  if (!isAllowedBrowserOrigin(request.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  const auth = authorizeHeaders(request.headers);
  if (!auth.ok) {
    socket.write(`HTTP/1.1 ${auth.status} ${auth.status === 401 ? "Unauthorized" : "Forbidden"}\r\n\r\n`);
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
      `           GET    /sessions?archived=0|1\n` +
      `           GET    /git/branches?cwd=:path\n` +
      `           POST   /sessions       { cwd, title, branch? }\n` +
      `           GET    /sessions/:id\n` +
      `           PATCH  /sessions/:id   { title?, archived? }\n` +
      `           DELETE /sessions/:id\n` +
      `   WS   :  /ws?session=:id&cursor=:n`,
  ),
);

const shutdown = async () => {
  await runtime.runPromise(Effect.logInfo("shutting down…"));
  await runtime.runPromise(Effect.flatMap(SessionManager, (manager) => manager.closeAll()));
  wss.close();
  server.close();
  await runtime.dispose();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
