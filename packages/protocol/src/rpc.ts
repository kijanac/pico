import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import {
  AuthLoginJob,
  AuthProviders,
  Commands,
  ExtensionUiResponseValue,
  ImageContent,
  LogPage,
  QueueState,
  SendMode,
  SessionControls,
  SessionMeta,
  SessionStats,
  SessionTree,
  WireEvent,
} from "./index.ts";

export const FsListing = Schema.Struct({
  path: Schema.String,
  parent: Schema.NullOr(Schema.String),
  home: Schema.String,
  entries: Schema.Array(Schema.Struct({ name: Schema.String, hidden: Schema.Boolean })),
});
export type FsListing = typeof FsListing.Type;

// Wire failures; host handlers map their internal errors (PiError / …) onto these.
export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()("SessionNotFound", {
  id: Schema.String,
}) {}

export class RequestError extends Schema.TaggedError<RequestError>()("RequestError", {
  message: Schema.String,
}) {}

const SessionFail = Schema.Union(SessionNotFound, RequestError);
const Trimmed = Schema.NonEmptyTrimmedString;

export const PicoRpc = RpcGroup.make(
  Rpc.make("sessions.list", { payload: { archived: Schema.optional(Schema.Boolean) }, success: Schema.Array(SessionMeta), error: RequestError }),
  Rpc.make("sessions.create", { payload: { cwd: Trimmed, title: Trimmed }, success: SessionMeta, error: RequestError }),
  Rpc.make("sessions.patch", { payload: { id: Schema.String, title: Schema.optional(Trimmed), archived: Schema.optional(Schema.Boolean) }, success: SessionMeta, error: SessionFail }),
  Rpc.make("sessions.remove", { payload: { id: Schema.String }, error: SessionFail }),
  Rpc.make("sessions.controls", { payload: { id: Schema.String }, success: SessionControls, error: SessionFail }),
  Rpc.make("sessions.patchControl", { payload: { id: Schema.String, key: Schema.String, value: Schema.Union(Schema.String, Schema.Boolean) }, success: SessionControls, error: SessionFail }),
  Rpc.make("sessions.compact", { payload: { id: Schema.String, instructions: Schema.optional(Schema.String) }, error: SessionFail }),
  Rpc.make("sessions.queue", { payload: { id: Schema.String }, success: QueueState, error: SessionFail }),
  Rpc.make("sessions.clearQueue", { payload: { id: Schema.String }, success: QueueState, error: SessionFail }),
  Rpc.make("sessions.removeQueued", { payload: { id: Schema.String, messageId: Schema.String }, success: QueueState, error: SessionFail }),
  Rpc.make("sessions.stats", { payload: { id: Schema.String }, success: SessionStats, error: SessionFail }),
  Rpc.make("sessions.logBefore", {
    payload: { id: Schema.String, beforeId: Schema.String, limit: Schema.optional(Schema.Number) },
    success: LogPage,
    error: SessionFail,
  }),
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
);

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
      mode: SendMode,
      images: Schema.optional(Schema.Array(ImageContent)),
      clientId: Schema.String,
    },
    error: SessionFail,
  }),
  Rpc.make("session.interrupt", { payload: { id: Schema.String }, error: SessionFail }),
  Rpc.make("session.extensionUiResponse", {
    payload: { id: Schema.String, requestId: Schema.String, value: ExtensionUiResponseValue },
    error: SessionFail,
  }),
);
