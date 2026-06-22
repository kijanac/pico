import { Rpc, RpcGroup, RpcMiddleware } from "@effect/rpc";
import { Context, Schema } from "effect";
import { HostErrorCodeSchema } from "./errors.ts";
import {
  AuthLoginJob,
  AuthProviders,
  Commands,
  ExtensionUiResponseValue,
  HostUpdateStatus,
  ImageAttachment,
  PermissionChoice,
  QueueState,
  SendMode,
  SessionControls,
  SessionMeta,
  SessionStats,
  SessionTree,
  SystemInfo,
  WireEvent,
} from "./index.ts";

export const HostIdentity = Schema.Struct({
  user: Schema.optional(Schema.String),
  claimed: Schema.Boolean,
});
export type HostIdentity = typeof HostIdentity.Type;

export const HostClaimResult = Schema.Struct({
  claimed: Schema.Literal(true),
  owner: Schema.String,
});
export type HostClaimResult = typeof HostClaimResult.Type;

export const FsListing = Schema.Struct({
  path: Schema.String,
  parent: Schema.NullOr(Schema.String),
  home: Schema.String,
  entries: Schema.Array(Schema.Struct({ name: Schema.String, hidden: Schema.Boolean })),
});
export type FsListing = typeof FsListing.Type;

// Wire failures; host handlers map their internal errors (PiError / …) onto these.
export class HostError extends Schema.TaggedError<HostError>()("HostError", {
  code: HostErrorCodeSchema,
}) {}

export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()("SessionNotFound", {
  id: Schema.String,
}) {}

export class RequestError extends Schema.TaggedError<RequestError>()("RequestError", {
  message: Schema.String,
}) {}

// Resolved by the auth middleware from the request's Tailscale headers.
export class CurrentIdentity extends Context.Tag("CurrentIdentity")<CurrentIdentity, HostIdentity>() {}

// "claimed" enforced except for unclaimed-allowed system.{info,identity,claim} tags.
// Client needs no implementation: Tailscale Serve injects the identity header at the network layer.
export class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()("AuthMiddleware", {
  provides: CurrentIdentity,
  failure: HostError,
}) {}

const SessionFail = Schema.Union(SessionNotFound, RequestError);
const Trimmed = Schema.NonEmptyTrimmedString;

export const PicoRpc = RpcGroup.make(
  Rpc.make("system.info", { success: SystemInfo, error: RequestError }),
  Rpc.make("system.updateStatus", { success: HostUpdateStatus, error: RequestError }),
  Rpc.make("system.triggerUpdate", { success: HostUpdateStatus, error: RequestError }),
  Rpc.make("system.identity", { success: HostIdentity, error: HostError }),
  Rpc.make("system.claim", { payload: { token: Schema.optional(Schema.String) }, success: HostClaimResult, error: Schema.Union(HostError, RequestError) }),
  Rpc.make("sessions.list", { payload: { archived: Schema.optional(Schema.Boolean) }, success: Schema.Array(SessionMeta), error: RequestError }),
  Rpc.make("sessions.create", { payload: { cwd: Trimmed, title: Trimmed }, success: SessionMeta, error: RequestError }),
  Rpc.make("sessions.patch", { payload: { id: Schema.String, title: Schema.optional(Trimmed), archived: Schema.optional(Schema.Boolean) }, success: SessionMeta, error: SessionFail }),
  Rpc.make("sessions.remove", { payload: { id: Schema.String }, error: SessionFail }),
  Rpc.make("sessions.controls", { payload: { id: Schema.String }, success: SessionControls, error: SessionFail }),
  Rpc.make("sessions.patchControl", { payload: { id: Schema.String, key: Schema.String, value: Schema.Union(Schema.String, Schema.Boolean) }, success: SessionControls, error: SessionFail }),
  Rpc.make("sessions.compact", { payload: { id: Schema.String, instructions: Schema.optional(Schema.String) }, error: SessionFail }),
  Rpc.make("sessions.queue", { payload: { id: Schema.String }, success: QueueState, error: SessionFail }),
  Rpc.make("sessions.clearQueue", { payload: { id: Schema.String }, success: QueueState, error: SessionFail }),
  Rpc.make("sessions.stats", { payload: { id: Schema.String }, success: SessionStats, error: SessionFail }),
  Rpc.make("sessions.tree", { payload: { id: Schema.String }, success: SessionTree, error: SessionFail }),
  Rpc.make("sessions.navigateTree", { payload: { id: Schema.String, entryId: Schema.String, summarize: Schema.optional(Schema.Boolean) }, error: SessionFail }),
  Rpc.make("sessions.commands", { payload: { id: Schema.String }, success: Commands, error: SessionFail }),
  Rpc.make("auth.providers", { success: AuthProviders, error: RequestError }),
  Rpc.make("auth.startLogin", { payload: { providerId: Schema.String }, success: AuthLoginJob, error: RequestError }),
  Rpc.make("auth.getLogin", { payload: { jobId: Schema.String }, success: AuthLoginJob, error: RequestError }),
  Rpc.make("auth.submitLoginInput", { payload: { jobId: Schema.String, value: Schema.String }, success: AuthLoginJob, error: RequestError }),
  Rpc.make("auth.saveApiKey", { payload: { providerId: Schema.String, apiKey: Trimmed }, success: AuthProviders, error: RequestError }),
  Rpc.make("auth.cancelLogin", { payload: { jobId: Schema.String }, error: RequestError }),
  Rpc.make("fs.ls", { payload: { path: Schema.optional(Schema.String) }, success: FsListing, error: RequestError }),
).middleware(AuthMiddleware);

// The realtime session channel, served over a WebSocket. `events` is the
// server push stream (resumed from `cursor`); the rest are the live commands a
// viewer issues. One socket serves any session, so each rpc names its `id`.
export const PicoSessionRpc = RpcGroup.make(
  Rpc.make("session.events", {
    payload: { id: Schema.String, cursor: Schema.Number },
    success: WireEvent,
    error: SessionFail,
    stream: true,
  }),
  Rpc.make("session.send", {
    payload: {
      id: Schema.String,
      text: Schema.String,
      mode: Schema.optional(SendMode),
      images: Schema.optional(Schema.Array(ImageAttachment)),
      clientId: Schema.optional(Schema.String),
    },
    error: SessionFail,
  }),
  Rpc.make("session.interrupt", { payload: { id: Schema.String }, error: SessionFail }),
  Rpc.make("session.permissionReply", {
    payload: { id: Schema.String, messageId: Schema.String, choice: PermissionChoice },
    error: SessionFail,
  }),
  Rpc.make("session.extensionUiResponse", {
    payload: { id: Schema.String, requestId: Schema.String, value: ExtensionUiResponseValue },
    error: SessionFail,
  }),
).middleware(AuthMiddleware);
