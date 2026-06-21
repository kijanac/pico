import { Effect } from "effect";
import { serve } from "@hono/node-server";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH, HOST_INSECURE_NO_AUTH, USE_MOCK } from "./config.ts";
import { hostRuntime as runtime } from "./runtime.ts";
import { SessionManager } from "./session.ts";
import { makeHttpApp } from "./http/app.ts";
import { attachWebSocketUpgrade } from "./server.ts";
import { ensureLocalAdminToken } from "./local-admin.ts";

export interface PicoHostOptions {
  readonly host?: string;
  readonly port?: number;
}

export interface PicoHostHandle {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  close: () => Promise<void>;
}

const DEFAULT_PORT = 7777;
const DEFAULT_HOST = "127.0.0.1";

function closeServer(server: ReturnType<typeof serve>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function startPicoHost(options: PicoHostOptions = {}): PicoHostHandle {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const usingMock = USE_MOCK;

  if (HOST_INSECURE_NO_AUTH) {
    runtime.runFork(
      Effect.logWarning(
        "PICO_HOST_INSECURE_NO_AUTH=1 — Tailscale identity checks are DISABLED. Anyone who can reach this port has full access. Local dev only.",
      ),
    );
  }

  mkdirSync(dirname(DB_PATH), { recursive: true });
  ensureLocalAdminToken();

  const app = makeHttpApp(runtime);
  const server = serve({ fetch: app.fetch, port, hostname: host });
  const wss = attachWebSocketUpgrade(server, runtime);
  const url = `http://${host}:${port}`;
  let closed = false;

  runtime.runFork(
    Effect.logInfo(
      `Pico host listening on ${url}  ${usingMock ? "(mock pi)" : "(live pi)"}\n` +
        `   db   :  ${DB_PATH}\n` +
        `   HTTP :  GET    /healthz, /sessions/:id/export.html\n` +
        `   tRPC :  /trpc/*\n` +
        `   WS   :  /ws?session=:id&cursor=:n`,
    ),
  );

  const close = async () => {
    if (closed) return;
    closed = true;
    await runtime.runPromise(Effect.logInfo("shutting down…"));
    await runtime.runPromise(Effect.flatMap(SessionManager, (manager) => manager.closeAll()));
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await closeServer(server);
    await runtime.dispose();
  };

  return { host, port, url, close };
}
