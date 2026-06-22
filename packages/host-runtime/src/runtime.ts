import { Layer, Logger, LogLevel } from "effect";
import { DB_PATH } from "./config.ts";
import { PiClientFromEnv } from "./pi-env.ts";
import { ProviderAuthLive } from "./provider-auth.ts";
import { SessionManagerLive } from "./session.ts";
import { StoreLive } from "./store.ts";

const SessionLayer = SessionManagerLive.pipe(
  Layer.provide(Layer.mergeAll(PiClientFromEnv, StoreLive(DB_PATH))),
);

// The host's application services. Provided once into the unified server scope
// (see host.ts); the RPC handlers run against it in-context, and ws + the HTML
// export capture a Runtime / the SessionManager from the same context.
export const AppLayer = Layer.mergeAll(
  SessionLayer,
  ProviderAuthLive,
  Logger.minimumLogLevel(LogLevel.Info),
);

export type AppServices = Layer.Layer.Success<typeof AppLayer>;
