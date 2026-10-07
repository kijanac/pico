import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";
import { DB_PATH } from "./config.ts";
import { PiClientLive } from "./pi.ts";
import { ProviderAuthLive } from "./provider-auth.ts";
import { SessionManagerLive } from "./session.ts";
import { StoreLive } from "./store.ts";

const SessionLayer = SessionManagerLive.pipe(
  Layer.provide(Layer.mergeAll(PiClientLive, StoreLive(DB_PATH))),
);

// Provided once into the unified server scope (host.ts) so RPC handlers, ws,
// and the HTML export all capture a Runtime from the same context.
export const AppLayer = Layer.mergeAll(
  SessionLayer,
  ProviderAuthLive,
  Logger.minimumLogLevel(LogLevel.Info),
);

export type AppServices = Layer.Layer.Success<typeof AppLayer>;
