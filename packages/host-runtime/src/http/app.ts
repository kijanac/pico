import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import type { HostRuntime } from "../runtime.ts";
import { mountSystemRoutes } from "./system.ts";
import { mountSessionActionRoutes } from "./session-actions.ts";
import { mountTrpcRoutes } from "./trpc.ts";
import { allowedOrigins, requireTailscaleAuth } from "../auth.ts";
import { HOST_INSECURE_NO_AUTH } from "../config.ts";
import { mountLocalAdminRoutes } from "../local-admin.ts";

export function makeHttpApp(runtime: HostRuntime): Hono {
  const app = new Hono();

  app.use("*", compress());
  app.use(
    "*",
    cors({
      origin: HOST_INSECURE_NO_AUTH ? "*" : allowedOrigins(),
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type"],
    }),
  );

  mountLocalAdminRoutes(app);

  app.use("*", requireTailscaleAuth);
  mountSystemRoutes(app);
  mountSessionActionRoutes(app, runtime);
  mountTrpcRoutes(app, runtime);

  return app;
}
