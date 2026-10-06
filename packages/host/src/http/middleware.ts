import { HttpApp, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";
import { authorizeHeaders } from "../auth.ts";

const pathOf = (url: string): string => {
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
};

// /rpc and /ws pass through so the RPC AuthMiddleware can answer with a typed
// HostError; everything else (the app, exports) is gated here.
export const authMiddleware = (
  app: HttpApp.Default,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const path = pathOf(request.url);
    if (path === "/healthz" || path === "/rpc" || path === "/ws") return yield* app;

    const result = authorizeHeaders(request.headers);
    if (!result.ok) {
      return HttpServerResponse.unsafeJson(
        { error: result.error, hostErrorCode: result.error },
        { status: result.status },
      );
    }
    return yield* app;
  });
