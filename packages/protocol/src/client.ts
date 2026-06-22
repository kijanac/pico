import { FetchHttpClient, Socket } from "@effect/platform";
import { RpcClient, RpcSerialization } from "@effect/rpc";
import { Layer } from "effect";

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");

// HTTP transport for PicoRpc (POST /rpc). transformClient lets callers inject
// auth headers (the smoke test fakes the Tailscale identity this way).
export const picoHttpProtocol = (
  baseUrl: string,
  transformClient?: Parameters<typeof RpcClient.layerProtocolHttp>[0]["transformClient"],
) =>
  RpcClient.layerProtocolHttp({ url: `${stripTrailingSlash(baseUrl)}/rpc`, transformClient }).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer),
  );

// WebSocket transport for PicoSessionRpc (GET /ws). The constructor differs by
// platform (browser global vs `ws` on Node), so the caller supplies it.
export const picoSocketProtocol = (
  baseUrl: string,
  webSocketConstructor: Layer.Layer<Socket.WebSocketConstructor>,
) =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(`${stripTrailingSlash(baseUrl).replace(/^http/, "ws")}/ws`)),
    Layer.provide(webSocketConstructor),
    Layer.provide(RpcSerialization.layerJson),
  );
