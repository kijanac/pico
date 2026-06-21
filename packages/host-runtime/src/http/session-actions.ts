import { Cause, Effect, Option } from "effect";
import type { Hono } from "hono";
import { IS_PRODUCTION } from "../config.ts";
import { SessionNotFound } from "../errors.ts";
import { PiError } from "../pi.ts";
import type { HostRuntime } from "../runtime.ts";
import { SessionManager } from "../session.ts";

const isDev = !IS_PRODUCTION;

export function mountSessionActionRoutes(app: Hono, runtime: HostRuntime): void {
  app.get("/sessions/:id/export.html", async (c) => {
    const id = c.req.param("id");
    const result = await runtime.runPromiseExit(
      Effect.flatMap(SessionManager, (manager) => manager.exportHtml(id)),
    );

    if (result._tag === "Success") {
      const html = result.value;
      return c.body(html.stream, 200, {
        "content-type": "text/html; charset=utf-8",
        ...(html.filename ? { "content-disposition": `attachment; filename="${html.filename}"` } : {}),
        ...(html.size !== undefined ? { "content-length": String(html.size) } : {}),
      });
    }

    const failure = Option.getOrUndefined(Cause.failureOption(result.cause));

    if (failure instanceof SessionNotFound) {
      return c.json({ error: "not_found", message: "Session not found" }, 404);
    }

    if (failure instanceof PiError) {
      return c.json({ error: "export_failed", message: failure.message || "Request failed" }, 500);
    }

    return c.json(
      {
        error: "export_failed",
        message: "Internal server error",
        ...(isDev ? { detail: Cause.pretty(result.cause) } : {}),
      },
      500,
    );
  });
}
