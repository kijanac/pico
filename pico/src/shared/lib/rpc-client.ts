import { Socket } from "@effect/platform";
import { RpcClient } from "@effect/rpc";
import { Cause, Context, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { PicoRpc, PicoSessionRpc } from "@pico/protocol/rpc";
import { picoHttpProtocol, picoSocketProtocol } from "@pico/protocol/client";
import { settingsState } from "@/features/settings/settings.state.svelte";

const makeClient = RpcClient.make(PicoRpc);
export type PicoClientService = Effect.Effect.Success<typeof makeClient>;

// No auth header is set — Tailscale Serve injects the identity at the network layer.
export class PicoClient extends Context.Tag("PicoClient")<PicoClient, PicoClientService>() {}

const runtimes = new Map<string, ManagedRuntime.ManagedRuntime<PicoClient, never>>();

function runtimeFor(baseUrl: string): ManagedRuntime.ManagedRuntime<PicoClient, never> {
  let runtime = runtimes.get(baseUrl);
  if (!runtime) {
    const ClientLive = Layer.scoped(PicoClient, makeClient).pipe(
      Layer.provide(picoHttpProtocol(baseUrl)),
    );
    runtime = ManagedRuntime.make(ClientLive);
    runtimes.set(baseUrl, runtime);
  }
  return runtime;
}

export const rpc = <A, E>(
  f: (client: PicoClientService) => Effect.Effect<A, E>,
): Effect.Effect<A, E, PicoClient> => Effect.flatMap(PicoClient, f);

// Rejects with the underlying typed error (HostError / RpcClientError / …) rather
// than a wrapping FiberFailure, so callers can classify it.
export const runAt = async <A, E>(baseUrl: string, effect: Effect.Effect<A, E, PicoClient>): Promise<A> => {
  const exit = await runtimeFor(baseUrl).runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
};

export const runHost = <A, E>(effect: Effect.Effect<A, E, PicoClient>): Promise<A> =>
  runAt(settingsState.hostUrl, effect);

const makeSessionClient = RpcClient.make(PicoSessionRpc);
export type PicoSessionClientService = Effect.Effect.Success<typeof makeSessionClient>;

// The realtime session channel over @effect/rpc's WebSocket transport. The
// browser WebSocket can't set headers, but Tailscale Serve injects the identity
// at the upgrade, so none is needed. The stream controller provides a fresh
// layer (fresh socket) per connection attempt and reconnects by re-providing it.
export class PicoSessionClient extends Context.Tag("PicoSessionClient")<PicoSessionClient, PicoSessionClientService>() {}

export const sessionClientLayer = (baseUrl: string): Layer.Layer<PicoSessionClient> =>
  Layer.scoped(PicoSessionClient, makeSessionClient).pipe(
    Layer.provide(picoSocketProtocol(baseUrl, Socket.layerWebSocketConstructorGlobal)),
  );
