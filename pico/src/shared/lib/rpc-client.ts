import { Socket } from "@effect/platform";
import { RpcClient } from "@effect/rpc";
import { Cause, Context, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { PicoRpc, PicoSessionRpc } from "@pico/protocol/rpc";
import { picoHttpProtocol, picoSocketProtocol } from "@pico/protocol/client";

const hostUrl = window.location.origin;

const makeClient = RpcClient.make(PicoRpc);
export type PicoClientService = Effect.Effect.Success<typeof makeClient>;

export class PicoClient extends Context.Tag("PicoClient")<PicoClient, PicoClientService>() {}

const runtime = ManagedRuntime.make(Layer.scoped(PicoClient, makeClient).pipe(Layer.provide(picoHttpProtocol(hostUrl))));

export const rpc = <A, E>(
  f: (client: PicoClientService) => Effect.Effect<A, E>,
): Effect.Effect<A, E, PicoClient> => Effect.flatMap(PicoClient, f);

export const forkRpc = <A, E>(effect: Effect.Effect<A, E, PicoClient>) => runtime.runFork(effect);

export const runRpc = async <A, E>(effect: Effect.Effect<A, E, PicoClient>): Promise<A> => {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
};

const makeSessionClient = RpcClient.make(PicoSessionRpc);
export type PicoSessionClientService = Effect.Effect.Success<typeof makeSessionClient>;

export class PicoSessionClient extends Context.Tag("PicoSessionClient")<PicoSessionClient, PicoSessionClientService>() {}

export const sessionClientLayer: Layer.Layer<PicoSessionClient> = Layer.scoped(PicoSessionClient, makeSessionClient).pipe(
  Layer.provide(picoSocketProtocol(hostUrl, Socket.layerWebSocketConstructorGlobal)),
);
