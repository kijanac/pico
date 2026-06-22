import { Cause, Effect, Fiber, Layer } from "effect";
import { HttpApiBuilder } from "@effect/platform";
import { NodeContext, NodeHttpServer } from "@effect/platform-node";
import { createServer, type Server } from "node:http";
import { DB_PATH, HOST_INSECURE_NO_AUTH, USE_MOCK } from "./config.ts";
import { allowedOrigins } from "./auth.ts";
import { AppLayer } from "./runtime.ts";
import { PicoHostApi } from "./http/api.ts";
import { AdminApiLive, SystemApiLive } from "./http/handlers.ts";
import { authMiddleware } from "./http/middleware.ts";
import { compress } from "./http/compression.ts";
import { RawRoutesLive } from "./http/routes.ts";
import { RpcRoutesLive, SessionWsRoutesLive } from "./http/rpc.ts";
import { ensureLocalAdminToken } from "./local-admin.ts";
import { TracingLive } from "./tracing.ts";

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

export function launchHttpServer(
  port: number,
  host: string,
  onServer?: (server: Server) => void,
): LaunchedHttpServer {
  // Created eagerly for a stable reference; listen happens when the layer builds.
  const server = createServer();
  onServer?.(server);

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
    Layer.provide(SessionWsRoutesLive),
    Layer.provide(RawRoutesLive),
    Layer.provide(ApiLive),
    Layer.provide(NodeHttpServer.layer(() => server, { port, host })),
  );

  const program = Effect.gen(function* () {
    // Pre-generate the loopback admin token before the server accepts requests,
    // so the co-located CLI can read it the moment the host reports ready.
    yield* ensureLocalAdminToken();
    yield* Layer.build(ServerLive);
    yield* Effect.never;
  }).pipe(
    Effect.provide(AppLayer),
    Effect.provide(NodeContext.layer),
    // No-op unless PICO_HOST_OTEL=1 (then spans print to the console).
    Effect.provide(TracingLive),
    Effect.scoped,
    Effect.tapErrorCause((cause) => Effect.logError(`http server failed: ${Cause.pretty(cause)}`)),
  );

  const fiber = Effect.runFork(program);

  // Interrupting the fiber closes the scope, running the layer finalizers
  // (server shutdown + SessionManager teardown).
  const stop = () => Effect.runPromise(Fiber.interrupt(fiber)).then(() => undefined);

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
