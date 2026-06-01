import { Layer, ManagedRuntime, Logger, LogLevel } from "effect";
import { DB_PATH } from "./config.ts";
import { PiClientFromEnv } from "./pi-env.ts";
import { ProviderAuthLive } from "./provider-auth.ts";
import { SessionManagerLive } from "./session.ts";
import { StoreLive } from "./store.ts";

const SessionLayer = SessionManagerLive.pipe(
  Layer.provide(Layer.mergeAll(PiClientFromEnv, StoreLive(DB_PATH))),
);

const AppLayer = Layer.mergeAll(SessionLayer, ProviderAuthLive);

export const bridgeRuntime = ManagedRuntime.make(
  Layer.mergeAll(AppLayer, Logger.minimumLogLevel(LogLevel.Info)),
);

export type BridgeRuntime = typeof bridgeRuntime;
export type BridgeRuntimeServices = ManagedRuntime.ManagedRuntime.Context<typeof bridgeRuntime>;
