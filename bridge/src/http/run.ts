import { Cause, Effect, Option, type ManagedRuntime } from "effect";
import type { Context as HonoContext } from "hono";
import { SessionNotFound } from "../errors.ts";
import { PiError } from "../pi.ts";

export type ApiErrorCode =
  | "not_found"
  | "invalid_body"
  | "models_failed"
  | "set_model_failed"
  | "compact_failed"
  | "commands_failed"
  | "export_failed"
  | "queue_failed"
  | "auth_providers_failed"
  | "auth_login_failed"
  | "auth_job_failed"
  | "auth_input_failed"
  | "auth_cancel_failed"
  | "settings_failed"
  | "stats_failed"
  | "tree_failed"
  | "tree_jump_failed"
  | "internal_error";

interface ErrorBody {
  error: ApiErrorCode;
  message: string;
  detail?: string;
}

const isDev = process.env.NODE_ENV !== "production";

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Request failed";
}

export function failureJson<E>(
  c: HonoContext,
  code: ApiErrorCode,
  cause: Cause.Cause<E>,
): Response {
  const failure = Option.getOrUndefined(Cause.failureOption(cause));

  if (failure instanceof SessionNotFound) {
    return c.json({ error: "not_found", message: "Session not found" } satisfies ErrorBody, 404);
  }

  if (failure instanceof PiError || (failure instanceof Error && "_tag" in failure)) {
    return c.json({ error: code, message: safeErrorMessage(failure) } satisfies ErrorBody, 500);
  }

  const body: ErrorBody = {
    error: code,
    message: "Internal server error",
    ...(isDev ? { detail: Cause.pretty(cause) } : {}),
  };
  return c.json(body, 500);
}

export async function runJson<E, A>(
  runtime: ManagedRuntime.ManagedRuntime<any, never>,
  c: HonoContext,
  effect: Effect.Effect<A, E, any>,
  errorCode: ApiErrorCode,
): Promise<Response> {
  const result = await runtime.runPromiseExit(effect);
  if (result._tag === "Success") return c.json(result.value);
  return failureJson(c, errorCode, result.cause);
}

export async function runResponse<E, A>(
  runtime: ManagedRuntime.ManagedRuntime<any, never>,
  c: HonoContext,
  effect: Effect.Effect<A, E, any>,
  toResponse: (value: A) => Response,
  errorCode: ApiErrorCode,
): Promise<Response> {
  const result = await runtime.runPromiseExit(effect);
  if (result._tag === "Success") return toResponse(result.value);
  return failureJson(c, errorCode, result.cause);
}

export async function runNoContent<E>(
  runtime: ManagedRuntime.ManagedRuntime<any, never>,
  c: HonoContext,
  effect: Effect.Effect<void, E, any>,
  errorCode: ApiErrorCode,
): Promise<Response> {
  const result = await runtime.runPromiseExit(effect);
  if (result._tag === "Success") return c.body(null, 204);
  return failureJson(c, errorCode, result.cause);
}
