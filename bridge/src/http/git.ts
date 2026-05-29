import type { Hono } from "hono";
import { listGitBranches } from "../git.ts";
import { runJson } from "./run.ts";
import type { ManagedRuntime } from "effect";

export function mountGitRoutes(app: Hono, runtime: ManagedRuntime.ManagedRuntime<any, never>): void {
  app.get("/git/branches", async (c) => {
    const cwd = c.req.query("cwd");
    if (!cwd) return c.json({ error: "missing_cwd", message: "cwd query parameter is required" }, 400);
    return runJson(runtime, c, listGitBranches(cwd), "internal_error");
  });
}
