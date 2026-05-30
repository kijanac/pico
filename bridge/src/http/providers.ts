import { Effect, type ManagedRuntime } from "effect";
import type { Hono } from "hono";
import * as v from "valibot";
import { ProviderAuth } from "../provider-auth.ts";
import { AuthInputBody } from "./schemas.ts";
import { runJson } from "./run.ts";

export function mountProviderRoutes(app: Hono, runtime: ManagedRuntime.ManagedRuntime<any, never>): void {
  app.get("/providers", async (c) =>
    runJson(runtime, c, Effect.flatMap(ProviderAuth, (auth) => auth.listProviders()), "auth_providers_failed"),
  );

  app.post("/providers/:providerId/login", async (c) => {
    const providerId = c.req.param("providerId");
    return runJson(runtime, c, Effect.flatMap(ProviderAuth, (auth) => auth.startLogin(providerId)), "auth_login_failed");
  });

  app.get("/provider-logins/:jobId", async (c) => {
    const jobId = c.req.param("jobId");
    return runJson(runtime, c, Effect.flatMap(ProviderAuth, (auth) => auth.getLogin(jobId)), "auth_job_failed");
  });

  app.post("/provider-logins/:jobId/input", async (c) => {
    const jobId = c.req.param("jobId");
    const body = v.safeParse(AuthInputBody, await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body", issues: body.issues }, 400);
    return runJson(
      runtime,
      c,
      Effect.flatMap(ProviderAuth, (auth) => auth.submitLoginInput(jobId, body.output.value)),
      "auth_input_failed",
    );
  });

  app.post("/provider-logins/:jobId/cancel", async (c) => {
    const jobId = c.req.param("jobId");
    return runJson(
      runtime,
      c,
      Effect.as(Effect.flatMap(ProviderAuth, (auth) => auth.cancelLogin(jobId)), { ok: true }),
      "auth_cancel_failed",
    );
  });
}
