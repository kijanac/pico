import { Effect, Layer, ManagedRuntime, Logger, LogLevel } from "effect";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PiClientFromEnv } from "./pi-env.ts";
import { SessionManagerLive } from "./session.ts";
import { StoreLive } from "./store.ts";
import { makeConnectionHandler, type WsBindings } from "./ws.ts";
import { makeHttpApp } from "./http/app.ts";

const PORT = Number(process.env.PORT ?? 7777);
const HOST = process.env.HOST ?? "0.0.0.0";
const DB_PATH = process.env.BRIDGE_DB ?? "data/bridge.db";
const USING_MOCK = process.env.PI_USE_MOCK === "1";

mkdirSync(dirname(DB_PATH), { recursive: true });

const AppLayer = SessionManagerLive.pipe(
  Layer.provide(Layer.mergeAll(PiClientFromEnv, StoreLive(DB_PATH))),
);
const runtime = ManagedRuntime.make(
  Layer.mergeAll(AppLayer, Logger.minimumLogLevel(LogLevel.Info)),
);

const app = makeHttpApp(runtime);
const onConnection = makeConnectionHandler(runtime);
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
      `           GET    /git/branches?cwd=:path\n` +
      `           POST   /sessions       { cwd, title?, branch? }\n` +
      `           GET    /sessions/:id\n` +
      `           PATCH  /sessions/:id   { title?, archived? }\n` +
      `           DELETE /sessions/:id\n` +
      `   WS   :  /ws?session=:id&cursor=:n`,
  ),
);

const shutdown = async () => {
  await runtime.runPromise(Effect.logInfo("shutting down…"));
  wss.close();
  server.close();
  await runtime.dispose();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
