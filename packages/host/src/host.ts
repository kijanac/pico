import { Effect, Layer } from "effect";
import { HttpApiBuilder, HttpServer } from "@effect/platform";
import { NodeContext, NodeHttpServer } from "@effect/platform-node";
import { createServer } from "node:http";
import { DB_PATH, HOST_INSECURE_NO_AUTH, USE_MOCK } from "./config.ts";
import { AppLayer } from "./runtime.ts";
import { PicoHostApi } from "./http/api.ts";
import { SystemApiLive } from "./http/handlers.ts";
import { authMiddleware } from "./http/middleware.ts";
import { compress } from "./http/compression.ts";
import { RawRoutesLive } from "./http/routes.ts";
import { RpcRoutesLive, SessionWsRoutesLive } from "./http/rpc.ts";
import { WebRoutesLive } from "./http/web.ts";
import { TracingLive } from "./tracing.ts";

// Logs once the server is listening, and again when it shuts down.
const LifecycleLogLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    if (HOST_INSECURE_NO_AUTH) {
      yield* Effect.logWarning("auth_disabled").pipe(
        Effect.annotateLogs({ reason: "PICO_HOST_INSECURE_NO_AUTH=1: anyone who can reach the port has full access" }),
      );
    }
    const url = yield* HttpServer.addressFormattedWith(Effect.succeed);
    yield* Effect.logInfo("host_started").pipe(
      Effect.annotateLogs({ url, db: DB_PATH, pi: USE_MOCK ? "mock" : "live" }),
    );
    yield* Effect.addFinalizer(() => Effect.logInfo("host_stopping"));
  }),
);

// The whole host as one Layer: main.ts launches it on :7777, the smoke test on
// port 0. It binds loopback only; Tailscale Serve is the sole ingress (auth.ts).
// HttpServer stays in the output so callers can read the bound address.
export const hostLayer = (port: number) =>
  HttpApiBuilder.serve(authMiddleware).pipe(
    Layer.provide(HttpApiBuilder.middleware(compress)),
    Layer.provide(RpcRoutesLive),
    Layer.provide(SessionWsRoutesLive),
    Layer.provide(RawRoutesLive),
    Layer.provide(WebRoutesLive),
    Layer.provide(HttpApiBuilder.api(PicoHostApi).pipe(Layer.provide(SystemApiLive))),
    Layer.merge(LifecycleLogLive),
    Layer.provideMerge(NodeHttpServer.layer(createServer, { port, host: "127.0.0.1" })),
    Layer.provide(AppLayer),
    Layer.provide(NodeContext.layer),
    Layer.provide(TracingLive),
  );
