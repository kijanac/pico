import { Cause, Effect, Fiber, Layer } from "effect";
import { HttpApiBuilder } from "@effect/platform";
import { NodeHttpServer } from "@effect/platform-node";
import { createServer, type Server } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { WebSocketServer } from "ws";
import { DB_PATH, HOST_INSECURE_NO_AUTH, USE_MOCK } from "./config.ts";
import { allowedOrigins } from "./auth.ts";
import { AppLayer } from "./runtime.ts";
import { SessionManager } from "./session.ts";
import { PicoHostApi } from "./http/api.ts";
import { AdminApiLive, SystemApiLive } from "./http/handlers.ts";
import { authMiddleware } from "./http/middleware.ts";
import { compress } from "./http/compression.ts";
import { RawRoutesLive } from "./http/routes.ts";
import { RpcRoutesLive } from "./http/rpc.ts";
import { attachWebSocketUpgrade } from "./server.ts";
import { ensureLocalAdminToken } from "./local-admin.ts";

export interface PicoHostOptions {
  readonly host?: string;
  readonly port?: number;
}

export interface PicoHostHandle {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  close: () => Promise<void>;
}

const DEFAULT_PORT = 7777;
const DEFAULT_HOST = "127.0.0.1";

export interface LaunchedHttpServer {
  readonly stop: () => Promise<void>;
}

// Assembles the whole server as one self-contained layer (typed HttpApi + RPC +
// raw routes + CORS/gzip + the global auth gate) and runs it in a single scope
// with the app services provided once. The RPC handlers run in-context against
// those services; ws + the export route reuse the same context (a captured
// Runtime / build-time SessionManager). Exported so the smoke test exercises the
// real wiring.
export function launchHttpServer(
  port: number,
  host: string,
  onServer?: (server: Server) => void,
): LaunchedHttpServer {
  // Created eagerly so the node server is a stable reference; listen happens
  // when the layer builds below.
  const server = createServer();
  onServer?.(server);
  let wss: WebSocketServer | undefined;

  const ApiLive = HttpApiBuilder.api(PicoHostApi).pipe(
    Layer.provide(SystemApiLive),
    Layer.provide(AdminApiLive),
  );

  const ServerLive = HttpApiBuilder.serve(authMiddleware).pipe(
    Layer.provide(
      HttpApiBuilder.middlewareCors({
        allowedOrigins: HOST_INSECURE_NO_AUTH ? () => true : allowedOrigins(),
        allowedMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["content-type"],
      }),
    ),
    Layer.provide(HttpApiBuilder.middleware(compress)),
    Layer.provide(RpcRoutesLive),
    Layer.provide(RawRoutesLive),
    Layer.provide(ApiLive),
    Layer.provide(NodeHttpServer.layer(() => server, { port, host })),
  );

  const program = Effect.gen(function* () {
    yield* Layer.build(ServerLive);
    // NodeHttpServer attaches its own "upgrade" listener for Effect-native
    // websockets; we run the session WebSocket on raw `ws`, so replace it once
    // the server is built. ws forks effects on a Runtime captured from the same
    // app context the RPC handlers use.
    const runtime = yield* Effect.runtime<SessionManager>();
    yield* Effect.sync(() => {
      server.removeAllListeners("upgrade");
      wss = attachWebSocketUpgrade(server, runtime);
    });
    yield* Effect.never;
  }).pipe(
    Effect.provide(AppLayer),
    Effect.scoped,
    Effect.tapErrorCause((cause) => Effect.logError(`http server failed: ${Cause.pretty(cause)}`)),
  );

  const fiber = Effect.runFork(program);

  const stop = async () => {
    const currentWss = wss;
    if (currentWss) await new Promise<void>((resolve) => currentWss.close(() => resolve()));
    // Interrupting the fiber closes the scope, running the layer finalizers:
    // the node server shuts down and SessionManager tears its sessions down.
    await Effect.runPromise(Fiber.interrupt(fiber));
  };

  return { stop };
}

export function startPicoHost(options: PicoHostOptions = {}): PicoHostHandle {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const usingMock = USE_MOCK;

  if (HOST_INSECURE_NO_AUTH) {
    Effect.runFork(
      Effect.logWarning(
        "PICO_HOST_INSECURE_NO_AUTH=1 — Tailscale identity checks are DISABLED. Anyone who can reach this port has full access. Local dev only.",
      ),
    );
  }

  mkdirSync(dirname(DB_PATH), { recursive: true });
  ensureLocalAdminToken();

  const server = launchHttpServer(port, host);
  const url = `http://${host}:${port}`;
  let closed = false;

  Effect.runFork(
    Effect.logInfo(
      `Pico host listening on ${url}  ${usingMock ? "(mock pi)" : "(live pi)"}\n` +
        `   db   :  ${DB_PATH}\n` +
        `   HTTP :  GET    /healthz, /sessions/:id/export.html\n` +
        `   RPC  :  POST   /rpc\n` +
        `   WS   :  /ws?session=:id&cursor=:n`,
    ),
  );

  const close = async () => {
    if (closed) return;
    closed = true;
    await Effect.runPromise(Effect.logInfo("shutting down…"));
    await server.stop();
  };

  return { host, port, url, close };
}
