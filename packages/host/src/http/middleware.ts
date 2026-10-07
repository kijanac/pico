import * as HttpApp from "@effect/platform/HttpApp";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import * as Effect from "effect/Effect";
import { authorizeHeaders } from "../auth.ts";

const pathOf = (url: string): string => {
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
};

// The one gate, covering /rpc and the /ws upgrade:
// - Identity comes only from the HTTP request's headers, which Tailscale Serve
//   sets. (RPC messages carry headers of their own that @effect/rpc merges over
//   the request's, so an RPC-level check could be spoofed.)
// - Serve stamps the owner's identity on everything from their devices, even
//   requests a hostile page makes from their browser, and WebSocket upgrades get
//   no CORS protection; so a browser request must come from this origin.
export const authMiddleware = (app: HttpApp.Default) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (pathOf(request.url) === "/healthz") return yield* app;

    const origin = request.headers.origin;
    if (origin !== undefined && URL.parse(origin)?.host !== request.headers.host) {
      return HttpServerResponse.empty({ status: 403 });
    }

    const result = authorizeHeaders(request.headers);
    if (!result.ok) {
      return HttpServerResponse.unsafeJson(
        { error: result.error, hostErrorCode: result.error },
        { status: result.status },
      );
    }
    return yield* app;
  });
