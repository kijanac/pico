import { Effect, type ManagedRuntime } from "effect";
import type { Hono } from "hono";
import * as v from "valibot";
import { SessionManager } from "../session.ts";
import { CompactBody, SessionControlValueBody, SetModelBody, TreeJumpBody } from "./schemas.ts";
import { runJson, runResponse } from "./run.ts";

export function mountSessionActionRoutes(app: Hono, runtime: ManagedRuntime.ManagedRuntime<any, never>): void {
  app.get("/sessions/:id/models", async (c) => {
    const id = c.req.param("id");
    return runJson(runtime, c, Effect.flatMap(SessionManager, (m) => m.listModels(id)), "models_failed");
  });

  app.post("/sessions/:id/model", async (c) => {
    const id = c.req.param("id");
    const body = v.safeParse(SetModelBody, await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body", issues: body.issues }, 400);
    return runJson(
      runtime,
      c,
      Effect.as(
        Effect.flatMap(SessionManager, (m) => m.setModel(id, body.output.provider, body.output.modelId)),
        { ok: true },
      ),
      "set_model_failed",
    );
  });

  app.post("/sessions/:id/compact", async (c) => {
    const id = c.req.param("id");
    const body = v.safeParse(CompactBody, await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid_body", issues: body.issues }, 400);
    return runJson(
      runtime,
      c,
      Effect.as(
        Effect.flatMap(SessionManager, (m) => m.compact(id, body.output.instructions)),
        { ok: true },
      ),
      "compact_failed",
    );
  });

  app.get("/sessions/:id/export.html", async (c) => {
    const id = c.req.param("id");
    return runResponse(
      runtime,
      c,
      Effect.flatMap(SessionManager, (m) => m.exportHtml(id)),
      (html) =>
        c.body(html.stream, 200, {
          "content-type": "text/html; charset=utf-8",
          ...(html.filename ? { "content-disposition": `attachment; filename="${html.filename}"` } : {}),
          ...(html.size !== undefined ? { "content-length": String(html.size) } : {}),
        }),
      "export_failed",
    );
  });

  app.get("/sessions/:id/commands", async (c) => {
    const id = c.req.param("id");
    return runJson(runtime, c, Effect.flatMap(SessionManager, (m) => m.listCommands(id)), "commands_failed");
  });

  app.get("/sessions/:id/queue", async (c) => {
    const id = c.req.param("id");
    return runJson(runtime, c, Effect.flatMap(SessionManager, (m) => m.getQueue(id)), "queue_failed");
  });

  app.delete("/sessions/:id/queue", async (c) => {
    const id = c.req.param("id");
    return runJson(runtime, c, Effect.flatMap(SessionManager, (m) => m.clearQueue(id)), "queue_failed");
  });

  app.get("/sessions/:id/settings", async (c) => {
    const id = c.req.param("id");
    return runJson(runtime, c, Effect.flatMap(SessionManager, (m) => m.getSettings(id)), "settings_failed");
  });

  app.patch("/sessions/:id/settings/:key", async (c) => {
    const id = c.req.param("id");
    const key = c.req.param("key");
    const body = v.safeParse(SessionControlValueBody, await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body", issues: body.issues }, 400);
    return runJson(runtime, c, Effect.flatMap(SessionManager, (m) => m.patchSetting(id, key, body.output.value)), "settings_failed");
  });

  app.get("/sessions/:id/stats", async (c) => {
    const id = c.req.param("id");
    return runJson(runtime, c, Effect.flatMap(SessionManager, (m) => m.getStats(id)), "stats_failed");
  });

  app.get("/sessions/:id/tree", async (c) => {
    const id = c.req.param("id");
    return runJson(runtime, c, Effect.flatMap(SessionManager, (m) => m.getTree(id)), "tree_failed");
  });

  app.post("/sessions/:id/tree/jump", async (c) => {
    const id = c.req.param("id");
    const body = v.safeParse(TreeJumpBody, await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body", issues: body.issues }, 400);
    return runJson(
      runtime,
      c,
      Effect.as(
        Effect.flatMap(SessionManager, (m) => m.navigateTree(id, body.output.entryId, body.output.summarize)),
        { ok: true },
      ),
      "tree_jump_failed",
    );
  });
}
