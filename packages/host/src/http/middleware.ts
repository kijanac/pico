import { HttpApp, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";
import { authorizeHeaders } from "../auth.ts";

const pathOf = (url: string): string => {
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
};

// The one identity gate: only the HTTP request's headers come from Tailscale
// Serve. (RPC messages carry headers of their own that @effect/rpc merges over
// the request's, so an RPC-level check could be spoofed.) Covers /rpc and the
// /ws upgrade.
export const authMiddleware = (app: HttpApp.Default) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (pathOf(request.url) === "/healthz") return yield* app;

    const result = authorizeHeaders(request.headers);
    if (!result.ok) {
      return HttpServerResponse.unsafeJson(
        { error: result.error, hostErrorCode: result.error },
        { status: result.status },
      );
    }
    return yield* app;
  });
