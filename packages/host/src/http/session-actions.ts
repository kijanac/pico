import { HttpRouter, HttpServerResponse } from "@effect/platform";
import { Context, Effect } from "effect";
import { SessionManager } from "../session.ts";

// manager is a captured service whose methods need no further Effect context.
export const exportRoute = (manager: Context.Tag.Service<SessionManager>) =>
  Effect.flatMap(HttpRouter.params, ({ id }) =>
    manager.exportHtml(id ?? "").pipe(
      Effect.map((html) =>
        HttpServerResponse.stream(html.stream, {
          contentType: "text/html; charset=utf-8",
          headers: {
            ...(html.filename ? { "content-disposition": `attachment; filename="${html.filename}"` } : {}),
            ...(html.size !== undefined ? { "content-length": String(html.size) } : {}),
          },
        }),
      ),
      Effect.catchTags({
        SessionNotFound: () =>
          Effect.succeed(
            HttpServerResponse.unsafeJson({ error: "not_found", message: "Session not found" }, { status: 404 }),
          ),
        PiError: (error) =>
          Effect.succeed(
            HttpServerResponse.unsafeJson(
              { error: "export_failed", message: error.message || "Request failed" },
              { status: 500 },
            ),
          ),
      }),
    ),
  );
