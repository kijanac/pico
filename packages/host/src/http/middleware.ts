import { FileSystem, HttpApp, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";
import { authorizeHeaders } from "../auth.ts";
import { adminTokenAuthorized } from "../local-admin.ts";

const pathOf = (url: string): string => {
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
};

// /admin/* uses loopback admin-token: the CLI has no Tailscale identity.
// /rpc is passed through so the RPC AuthMiddleware can self-gate per method
// (it sees the rpc tag, which a single endpoint path cannot).
// OPTIONS passes through so the CORS layer can answer preflights.
export const authMiddleware = (
  app: HttpApp.Default,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.method === "OPTIONS") return yield* app;

    const path = pathOf(request.url);

    if (path.startsWith("/admin/")) {
      if (!(yield* adminTokenAuthorized(request.headers))) {
        return HttpServerResponse.unsafeJson({ error: "invalid_admin_token" }, { status: 401 });
      }
      return yield* app;
    }

    if (path === "/healthz" || path === "/rpc") {
      return yield* app;
    }

    const result = authorizeHeaders(request.headers);
    if (!result.ok) {
      return HttpServerResponse.unsafeJson(
        { error: result.error, hostErrorCode: result.error },
        { status: result.status },
      );
    }
    if (!result.claimed) {
      return HttpServerResponse.unsafeJson(
        { error: "pico_host_unclaimed", hostErrorCode: "pico_host_unclaimed" },
        { status: 403 },
      );
    }

    return yield* app;
  });
