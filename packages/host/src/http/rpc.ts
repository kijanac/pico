import { HttpApiBuilder } from "@effect/platform";
import { RpcSerialization, RpcServer } from "@effect/rpc";
import { Context, Effect, Layer, Stream } from "effect";
import {
  AuthMiddleware,
  CurrentIdentity,
  HostError,
  PicoRpc,
  PicoSessionRpc,
  RequestError,
  SessionNotFound,
} from "@pico/protocol/rpc";
import { authorizeHeaders, claimPicoHostOwner } from "../auth.ts";
import { HostError as InternalHostError, SessionNotFound as InternalSessionNotFound } from "../errors.ts";
import { listFs } from "../fs.ts";
import { PiError } from "../pi.ts";
import { ProviderAuth } from "../provider-auth.ts";
import { SessionManager } from "../session.ts";
import { hostSystemInfo, readUpdateStatus, requestHostUpdate } from "./system.ts";

// Reachable before the host is claimed; every other procedure requires an owner.
const UNCLAIMED_ALLOWED = new Set(["system.info", "system.identity", "system.claim"]);

export const AuthLive = Layer.succeed(
  AuthMiddleware,
  AuthMiddleware.of(({ headers, rpc }) =>
    Effect.gen(function* () {
      const result = authorizeHeaders(headers);
      // system.info is public: surface best-effort identity, never fail.
      if (rpc._tag === "system.info") {
        return result.ok ? { user: result.user, claimed: result.claimed } : { claimed: false };
      }
      if (!result.ok) return yield* Effect.fail(new HostError({ code: result.error }));
      if (!result.claimed && !UNCLAIMED_ALLOWED.has(rpc._tag)) {
        return yield* Effect.fail(new HostError({ code: "pico_host_unclaimed" }));
      }
      return { user: result.user, claimed: result.claimed };
    }),
  ),
);

const toRequestError = (error: unknown) =>
  new RequestError({ message: error instanceof Error ? error.message : String(error) });

const toSessionFail = (error: PiError | InternalSessionNotFound) =>
  error instanceof InternalSessionNotFound ? new SessionNotFound({ id: error.id }) : toRequestError(error);

const onSessions = <A>(
  f: (manager: Context.Tag.Service<SessionManager>) => Effect.Effect<A, PiError | InternalSessionNotFound>,
) => Effect.flatMap(SessionManager, f).pipe(Effect.mapError(toSessionFail));

const onProvider = <A>(
  f: (auth: Context.Tag.Service<ProviderAuth>) => Effect.Effect<A, PiError>,
) => Effect.flatMap(ProviderAuth, f).pipe(Effect.mapError(toRequestError));

const HandlersLive = PicoRpc.toLayer({
  "system.info": () => Effect.sync(() => hostSystemInfo()),
  "system.updateStatus": () => readUpdateStatus(),
  "system.triggerUpdate": () => requestHostUpdate().pipe(Effect.mapError(toRequestError)),
  "system.identity": () => CurrentIdentity,
  "system.claim": ({ token }) =>
    Effect.flatMap(CurrentIdentity, (identity) =>
      identity.user === undefined
        ? Effect.fail(new HostError({ code: "missing_tailscale_identity" }))
        : Effect.try({
            try: () => claimPicoHostOwner(identity.user!, token),
            catch: (error) =>
              error instanceof InternalHostError
                ? new HostError({ code: error.hostErrorCode })
                : toRequestError(error),
          }),
    ),

  "sessions.list": ({ archived }) => Effect.flatMap(SessionManager, (m) => m.list({ archived })),
  "sessions.create": (input) => Effect.flatMap(SessionManager, (m) => m.create(input)).pipe(Effect.mapError(toRequestError)),
  "sessions.patch": ({ id, ...patch }) => onSessions((m) => m.patch(id, patch)),
  "sessions.remove": ({ id }) => onSessions((m) => m.remove(id)),
  "sessions.controls": ({ id }) => onSessions((m) => m.getSettings(id)),
  "sessions.patchControl": ({ id, key, value }) => onSessions((m) => m.patchSetting(id, key, value)),
  "sessions.compact": ({ id, instructions }) => onSessions((m) => m.compact(id, instructions)),
  "sessions.queue": ({ id }) => onSessions((m) => m.getQueue(id)),
  "sessions.clearQueue": ({ id }) => onSessions((m) => m.clearQueue(id)),
  "sessions.stats": ({ id }) => onSessions((m) => m.getStats(id)),
  "sessions.tree": ({ id }) => onSessions((m) => m.getTree(id)),
  "sessions.navigateTree": ({ id, entryId, summarize }) => onSessions((m) => m.navigateTree(id, entryId, summarize)),
  "sessions.commands": ({ id }) => onSessions((m) => m.listCommands(id)),

  "auth.providers": () => onProvider((a) => a.listProviders()),
  "auth.startLogin": ({ providerId }) => onProvider((a) => a.startLogin(providerId)),
  "auth.getLogin": ({ jobId }) => onProvider((a) => a.getLogin(jobId)),
  "auth.submitLoginInput": ({ jobId, value }) => onProvider((a) => a.submitLoginInput(jobId, value)),
  "auth.saveApiKey": ({ providerId, apiKey }) => onProvider((a) => a.saveApiKey(providerId, apiKey)),
  "auth.cancelLogin": ({ jobId }) => onProvider((a) => a.cancelLogin(jobId)),

  "fs.ls": ({ path }) => listFs(path).pipe(Effect.mapError(toRequestError)),
});

export const RpcRoutesLive = HttpApiBuilder.Router.use((router) =>
  Effect.gen(function* () {
    const app = yield* RpcServer.toHttpApp(PicoRpc);
    yield* router.post("/rpc", app);
  }),
).pipe(
  Layer.provide(HandlersLive),
  Layer.provide(AuthLive),
  Layer.provide(RpcSerialization.layerJson),
);

const SessionHandlersLive = PicoSessionRpc.toLayer({
  "session.events": ({ id, cursor }) =>
    Effect.map(SessionManager, (m) => m.subscribe(id, cursor)).pipe(Stream.unwrap, Stream.mapError(toSessionFail)),
  "session.send": ({ id, text, mode, images, clientId }) =>
    onSessions((m) => m.send(id, text, mode, images ? [...images] : undefined, clientId)),
  "session.interrupt": ({ id }) => onSessions((m) => m.interrupt(id)),
  "session.permissionReply": ({ id, messageId, choice }) => onSessions((m) => m.approve(id, messageId, choice)),
  "session.extensionUiResponse": ({ id, requestId, value }) => onSessions((m) => m.extensionUiResponse(id, requestId, value)),
});

// The realtime channel rides a WebSocket: toHttpAppWebsocket upgrades the
// request (NodeHttpServer's native upgrade path), so no raw `ws` server is
// needed. Mounted as GET /ws on the same router serve() builds.
export const SessionWsRoutesLive = HttpApiBuilder.Router.use((router) =>
  Effect.gen(function* () {
    const app = yield* RpcServer.toHttpAppWebsocket(PicoSessionRpc);
    yield* router.get("/ws", app);
  }),
).pipe(
  Layer.provide(SessionHandlersLive),
  Layer.provide(AuthLive),
  Layer.provide(RpcSerialization.layerJson),
);
