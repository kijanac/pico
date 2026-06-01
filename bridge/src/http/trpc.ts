import { Cause, Effect, Option } from "effect";
import type { Hono } from "hono";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, type BridgeTrpcServices } from "@pi-mobile/protocol/trpc";
import { authorizeHeaders, claimBridgeOwner } from "../auth.ts";
import { loadCommands } from "../commands.ts";
import { SessionNotFound } from "../errors.ts";
import { listFs } from "../fs.ts";
import { listGitBranches } from "../git.ts";
import { PiError } from "../pi.ts";
import { ProviderAuth } from "../provider-auth.ts";
import { SessionManager } from "../session.ts";
import type { BridgeRuntime, BridgeRuntimeServices } from "../runtime.ts";
import { bridgeSystemInfo, readUpdateStatus, requestBridgeUpdate } from "./system.ts";

function trpcError(failure: unknown): TRPCError {
  if (failure instanceof SessionNotFound) {
    return new TRPCError({ code: "NOT_FOUND", message: "Session not found", cause: failure });
  }

  if (failure instanceof PiError || failure instanceof Error) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: failure.message,
      cause: failure,
    });
  }

  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Request failed", cause: failure });
}

async function runEffectForTrpc<A, E>(
  runtime: BridgeRuntime,
  effect: Effect.Effect<A, E, BridgeRuntimeServices>,
): Promise<A> {
  const result = await runtime.runPromiseExit(effect);
  if (result._tag === "Success") return result.value;
  throw trpcError(Option.getOrUndefined(Cause.failureOption(result.cause)));
}

function authError(status: number, message: string): TRPCError {
  return new TRPCError({
    code: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
    message,
  });
}

function makeSystemService(req: Request): BridgeTrpcServices["system"] {
  return {
    info: async () => bridgeSystemInfo(),
    updateStatus: async () => readUpdateStatus(),
    triggerUpdate: async () => requestBridgeUpdate(),
    identity: async () => {
      const result = authorizeHeaders(req.headers);
      if (!result.ok) throw authError(result.status, result.error);
      return { user: result.user, claimed: result.claimed };
    },
    claim: async () => {
      const result = authorizeHeaders(req.headers);
      if (!result.ok) throw authError(result.status, result.error);
      if (!result.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "missing_tailscale_identity" });

      try {
        return claimBridgeOwner(result.user);
      } catch (error) {
        throw new TRPCError({
          code: "CONFLICT",
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        });
      }
    },
  };
}

function makeSessionService(runtime: BridgeRuntime): BridgeTrpcServices["sessions"] {
  return {
    list: ({ archived }) =>
      runEffectForTrpc(runtime, Effect.flatMap(SessionManager, (manager) => manager.list({ archived }))),
    create: (input) =>
      runEffectForTrpc(runtime, Effect.flatMap(SessionManager, (manager) => manager.create(input))),
    patch: ({ id, ...patch }) =>
      runEffectForTrpc(runtime, Effect.flatMap(SessionManager, (manager) => manager.patch(id, patch))),
    remove: ({ id }) =>
      runEffectForTrpc(runtime, Effect.flatMap(SessionManager, (manager) => manager.remove(id))),
    controls: ({ id }) =>
      runEffectForTrpc(runtime, Effect.flatMap(SessionManager, (manager) => manager.getSettings(id))),
    patchControl: ({ id, key, value }) =>
      runEffectForTrpc(runtime, Effect.flatMap(SessionManager, (manager) => manager.patchSetting(id, key, value))),
    compact: ({ id, instructions }) =>
      runEffectForTrpc(runtime, Effect.flatMap(SessionManager, (manager) => manager.compact(id, instructions))),
    queue: ({ id }) =>
      runEffectForTrpc(runtime, Effect.flatMap(SessionManager, (manager) => manager.getQueue(id))),
    clearQueue: ({ id }) =>
      runEffectForTrpc(runtime, Effect.flatMap(SessionManager, (manager) => manager.clearQueue(id))),
    stats: ({ id }) =>
      runEffectForTrpc(runtime, Effect.flatMap(SessionManager, (manager) => manager.getStats(id))),
    tree: ({ id }) =>
      runEffectForTrpc(runtime, Effect.flatMap(SessionManager, (manager) => manager.getTree(id))),
    navigateTree: ({ id, entryId, summarize }) =>
      runEffectForTrpc(runtime, Effect.flatMap(SessionManager, (manager) => manager.navigateTree(id, entryId, summarize))),
    commands: ({ id }) =>
      runEffectForTrpc(runtime, Effect.flatMap(SessionManager, (manager) => manager.listCommands(id))),
  };
}

function makeAuthService(runtime: BridgeRuntime): BridgeTrpcServices["auth"] {
  return {
    providers: () =>
      runEffectForTrpc(runtime, Effect.flatMap(ProviderAuth, (auth) => auth.listProviders())),
    startLogin: ({ providerId }) =>
      runEffectForTrpc(runtime, Effect.flatMap(ProviderAuth, (auth) => auth.startLogin(providerId))),
    getLogin: ({ jobId }) =>
      runEffectForTrpc(runtime, Effect.flatMap(ProviderAuth, (auth) => auth.getLogin(jobId))),
    submitLoginInput: ({ jobId, value }) =>
      runEffectForTrpc(runtime, Effect.flatMap(ProviderAuth, (auth) => auth.submitLoginInput(jobId, value))),
    cancelLogin: ({ jobId }) =>
      runEffectForTrpc(runtime, Effect.flatMap(ProviderAuth, (auth) => auth.cancelLogin(jobId))),
  };
}

function makeContext(runtime: BridgeRuntime, req: Request): BridgeTrpcServices {
  return {
    system: makeSystemService(req),
    sessions: makeSessionService(runtime),
    auth: makeAuthService(runtime),
    commands: {
      list: async () => loadCommands(),
    },
    fs: {
      ls: async ({ path }) => listFs(path),
    },
    git: {
      branches: ({ cwd }) => runEffectForTrpc(runtime, listGitBranches(cwd)),
    },
  };
}

export function mountTrpcRoutes(app: Hono, runtime: BridgeRuntime): void {
  app.all("/trpc/*", (c) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: ({ req }) => makeContext(runtime, req),
    }),
  );
}
