import { connect } from "node:net";
import { Effect } from "effect";
import { PicoSetupError } from "./errors.ts";

export async function portIsOpen(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return await new Promise<boolean>((resolveOpen) => {
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
}

export async function healthcheck(url: string, timeoutMs = 5_000): Promise<boolean> {
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

export function portIsOpenEffect(host: string, port: number, timeoutMs = 500): Effect.Effect<boolean, PicoSetupError> {
  return Effect.tryPromise({
    try: () => portIsOpen(host, port, timeoutMs),
    catch: (cause) => new PicoSetupError({
      code: "host_health_timeout",
      message: `Could not check ${host}:${port}`,
      detail: cause instanceof Error ? cause.message : String(cause),
      cause,
    }),
  });
}

export function healthcheckEffect(url: string, timeoutMs = 5_000): Effect.Effect<boolean, PicoSetupError> {
  return Effect.tryPromise({
    try: () => healthcheck(url, timeoutMs),
    catch: (cause) => new PicoSetupError({
      code: "host_health_timeout",
      message: `Could not reach ${url}/healthz`,
      detail: cause instanceof Error ? cause.message : String(cause),
      cause,
    }),
  });
}
