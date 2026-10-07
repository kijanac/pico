import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as Socket from "@effect/platform/Socket";
import * as RpcClient from "@effect/rpc/RpcClient";
import * as RpcSerialization from "@effect/rpc/RpcSerialization";
import * as Layer from "effect/Layer";

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
