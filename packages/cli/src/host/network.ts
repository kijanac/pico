import { connect } from "node:net";
import { Effect } from "effect";
import { PicoSetupError } from "./errors.ts";

const probePort = (host: string, port: number, timeoutMs: number): Promise<boolean> =>
  new Promise<boolean>((resolveOpen) => {
    const socket = connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolveOpen(false);
    }, timeoutMs).unref();

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolveOpen(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolveOpen(false);
    });
  });

const probeHealth = async (url: string, timeoutMs: number): Promise<boolean> => {
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
};

export const portIsOpen = (host: string, port: number, timeoutMs = 500) =>
  Effect.tryPromise({
    try: () => probePort(host, port, timeoutMs),
    catch: (cause) =>
      new PicoSetupError({
        code: "host_health_timeout",
        message: `Could not check ${host}:${port}`,
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

export const healthcheck = (url: string, timeoutMs = 5_000) =>
  Effect.tryPromise({
    try: () => probeHealth(url, timeoutMs),
    catch: (cause) =>
      new PicoSetupError({
        code: "host_health_timeout",
        message: `Could not reach ${url}/healthz`,
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
