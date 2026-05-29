import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ManagedRuntime } from "effect";
import { mountSystemRoutes } from "./system.ts";
import { mountSessionRoutes } from "./sessions.ts";
import { mountSessionActionRoutes } from "./session-actions.ts";
import { mountAuthRoutes } from "./auth.ts";
import { mountCommandRoutes } from "./commands.ts";
import { mountFsRoutes } from "./fs.ts";
import { mountGitRoutes } from "./git.ts";

export function makeHttpApp(runtime: ManagedRuntime.ManagedRuntime<any, never>): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type"],
    }),
  );

  mountSystemRoutes(app);
  mountSessionRoutes(app, runtime);
  mountSessionActionRoutes(app, runtime);
  mountAuthRoutes(app, runtime);
  mountCommandRoutes(app);
  mountFsRoutes(app);
  mountGitRoutes(app, runtime);

  return app;
}
