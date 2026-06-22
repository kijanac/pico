import { FileSystem, HttpApp, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";
import { authorizeHeaders } from "../auth.ts";
import { adminTokenAuthorized } from "../local-admin.ts";

const pathOf = (url: string): string => {
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
};

// Single global gate wrapping the whole app, mirroring the previous Hono order:
//   /admin/*  -> loopback admin-token (the CLI; no Tailscale identity present)
//   /healthz  -> public
//   /rpc      -> passed through; the RPC AuthMiddleware self-gates per method
//                (it can see the rpc tag, which a single endpoint path cannot)
//   everything else (the HTML export) -> Tailscale identity + claimed check
// OPTIONS preflights pass straight through so the CORS layer can answer them.
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
