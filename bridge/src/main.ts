import { Effect } from "effect";
import { serve } from "@hono/node-server";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./config.ts";
import { bridgeRuntime as runtime } from "./runtime.ts";
import { SessionManager } from "./session.ts";
import { makeHttpApp } from "./http/app.ts";
import { attachWebSocketUpgrade } from "./server.ts";
import { BRIDGE_INSECURE_NO_AUTH } from "./auth.ts";

const PORT = 7777;
const HOST = "127.0.0.1";
const USING_MOCK = process.env.PI_USE_MOCK === "1";

if (BRIDGE_INSECURE_NO_AUTH) {
  runtime.runFork(
    Effect.logWarning(
      "PI_BRIDGE_INSECURE_NO_AUTH=1 — Tailscale identity checks are DISABLED. Anyone who can reach this port has full access. Local dev only.",
    ),
  );
}

mkdirSync(dirname(DB_PATH), { recursive: true });

const app = makeHttpApp(runtime);
const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST });
const wss = attachWebSocketUpgrade(server, runtime);

runtime.runFork(
  Effect.logInfo(
    `pi-bridge listening on http://${HOST}:${PORT}  ${USING_MOCK ? "(mock pi)" : "(live pi)"}\n` +
      `   db   :  ${DB_PATH}\n` +
      `   HTTP :  GET    /healthz, /sessions/:id/export.html\n` +
      `   tRPC :  /trpc/*\n` +
      `   WS   :  /ws?session=:id&cursor=:n`,
  ),
);

const shutdown = async () => {
  await runtime.runPromise(Effect.logInfo("shutting down…"));
  await runtime.runPromise(Effect.flatMap(SessionManager, (manager) => manager.closeAll()));
  wss.close();
  server.close();
  await runtime.dispose();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
