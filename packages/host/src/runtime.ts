import { Layer, Logger, LogLevel } from "effect";
import { DB_PATH } from "./config.ts";
import { DurableRuntimeFactoryFromEnv } from "./pi-env.ts";
import { ProviderAuthLive } from "./provider-auth.ts";
import { SessionManagerLive } from "./session.ts";
import { StoreLive } from "./store.ts";

const SessionLayer = SessionManagerLive.pipe(
  Layer.provide(Layer.mergeAll(DurableRuntimeFactoryFromEnv, StoreLive(DB_PATH))),
);

// Provided once into the unified server scope (host.ts) so RPC handlers, ws,
// and the HTML export all capture a Runtime from the same context.
export const AppLayer = Layer.mergeAll(
  SessionLayer,
  ProviderAuthLive,
  Logger.minimumLogLevel(LogLevel.Info),
);
