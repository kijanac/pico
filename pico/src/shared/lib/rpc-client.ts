import { Socket } from "@effect/platform";
import { RpcClient } from "@effect/rpc";
import { Cause, Context, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { PicoRpc, PicoSessionRpc } from "@pico/protocol/rpc";
import { picoHttpProtocol, picoSocketProtocol } from "@pico/protocol/client";

// The host serves this app, so it is the page's own origin. No auth header is
// set: Tailscale Serve injects the identity at the network layer.
const hostUrl = window.location.origin;

const makeClient = RpcClient.make(PicoRpc);
export type PicoClientService = Effect.Effect.Success<typeof makeClient>;

export class PicoClient extends Context.Tag("PicoClient")<PicoClient, PicoClientService>() {}

const runtime = ManagedRuntime.make(Layer.scoped(PicoClient, makeClient).pipe(Layer.provide(picoHttpProtocol(hostUrl))));

export const rpc = <A, E>(
  f: (client: PicoClientService) => Effect.Effect<A, E>,
): Effect.Effect<A, E, PicoClient> => Effect.flatMap(PicoClient, f);

// Rejects with the underlying typed error (RequestError / RpcClientError / …)
// rather than a wrapping FiberFailure, so callers can classify it.
export const runRpc = async <A, E>(effect: Effect.Effect<A, E, PicoClient>): Promise<A> => {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
};

const makeSessionClient = RpcClient.make(PicoSessionRpc);
export type PicoSessionClientService = Effect.Effect.Success<typeof makeSessionClient>;

// The live session channel over @effect/rpc's WebSocket transport. The stream
// controller provides this layer per connection attempt, so each reconnect gets
// a fresh socket.
export class PicoSessionClient extends Context.Tag("PicoSessionClient")<PicoSessionClient, PicoSessionClientService>() {}

export const sessionClientLayer: Layer.Layer<PicoSessionClient> = Layer.scoped(PicoSessionClient, makeSessionClient).pipe(
  Layer.provide(picoSocketProtocol(hostUrl, Socket.layerWebSocketConstructorGlobal)),
);
