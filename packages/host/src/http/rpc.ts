import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as RpcSerialization from "@effect/rpc/RpcSerialization";
import * as RpcServer from "@effect/rpc/RpcServer";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import {
  PicoRpc,
  PicoSessionRpc,
  RequestError,
  SessionNotFound,
} from "@pico/protocol/rpc";
import { SessionNotFound as InternalSessionNotFound } from "../errors.ts";
import { listFs } from "../fs.ts";
import { PiError } from "../pi.ts";
import { ProviderAuth } from "../provider-auth.ts";
import { SessionManager } from "../session.ts";

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
  "sessions.list": ({ archived }) => Effect.flatMap(SessionManager, (m) => m.list({ archived })),
  "sessions.create": (input) => Effect.flatMap(SessionManager, (m) => m.create(input)).pipe(Effect.mapError(toRequestError)),
  "sessions.patch": ({ id, ...patch }) => onSessions((m) => m.patch(id, patch)),
  "sessions.remove": ({ id }) => onSessions((m) => m.remove(id)),
  "sessions.controls": ({ id }) => onSessions((m) => m.getSettings(id)),
  "sessions.patchControl": ({ id, key, value }) => onSessions((m) => m.patchSetting(id, key, value)),
  "sessions.compact": ({ id, instructions }) => onSessions((m) => m.compact(id, instructions)),
  "sessions.queue": ({ id }) => onSessions((m) => m.getQueue(id)),
  "sessions.clearQueue": ({ id }) => onSessions((m) => m.clearQueue(id)),
  "sessions.removeQueued": ({ id, messageId }) => onSessions((m) => m.removeQueued(id, messageId)),
  "sessions.stats": ({ id }) => onSessions((m) => m.getStats(id)),
  "sessions.logBefore": ({ id, beforeId, limit }) => onSessions((m) => m.getLogBefore(id, beforeId, limit)),
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
  Layer.provide(RpcSerialization.layerJson),
);

const SessionHandlersLive = PicoSessionRpc.toLayer({
  "session.events": ({ id, cursor }) =>
    Effect.map(SessionManager, (m) => m.subscribe(id, cursor)).pipe(Stream.unwrap, Stream.mapError(toSessionFail)),
  "session.send": ({ id, text, mode, images, clientId }) =>
    onSessions((m) => m.send(id, text, mode, images ? [...images] : undefined, clientId)),
  "session.interrupt": ({ id }) => onSessions((m) => m.interrupt(id)),
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
  Layer.provide(RpcSerialization.layerJson),
);
