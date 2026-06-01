import { Hono } from "hono";
import { cors } from "hono/cors";
import type { BridgeRuntime } from "../runtime.ts";
import { mountSystemRoutes } from "./system.ts";
import { mountSessionActionRoutes } from "./session-actions.ts";
import { mountTrpcRoutes } from "./trpc.ts";
import { allowedOrigins, requireTailscaleAuth } from "../auth.ts";

export function makeHttpApp(runtime: BridgeRuntime): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: process.env.NODE_ENV === "production" ? allowedOrigins() : "*",
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type"],
    }),
  );

  app.use("*", requireTailscaleAuth);
  mountSystemRoutes(app);
  mountSessionActionRoutes(app, runtime);
  mountTrpcRoutes(app, runtime);

  return app;
}
