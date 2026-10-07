import * as Rpc from "@effect/rpc/Rpc";
import * as RpcGroup from "@effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import {
  AuthLoginJob,
  AuthProviders,
  Commands,
  ExtensionUiResponseValue,
  HistoryPage,
  ImageContent,
  SendMode,
  SendStatus,
  ServerMessage,
  SessionControls,
  SessionMeta,
  SessionStats,
  SessionTree,
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
  // Safe to repeat: a send is identified by `cid`. `base` is the phone's
  // bookmark when the message was first sent; on a retry (`retry`) the host
  // looks after it in pi's file for the same text, in case it forgot the cid
  // in a restart.
  Rpc.make("sessions.send", {
    payload: {
      id: Schema.String,
      cid: Schema.String,
      text: Schema.String,
      mode: SendMode,
      images: Schema.optional(Schema.Array(ImageContent)),
      base: Schema.NullOr(Schema.String),
      retry: Schema.Boolean,
    },
    success: SendStatus,
    error: SessionFail,
  }),
  Rpc.make("sessions.interrupt", { payload: { id: Schema.String }, error: SessionFail }),
  Rpc.make("sessions.uiResponse", {
    payload: { id: Schema.String, requestId: Schema.String, value: ExtensionUiResponseValue },
    error: SessionFail,
  }),
  // Empties the queue and returns what was in it, for the composer (pi's dequeue).
  Rpc.make("sessions.clearQueue", {
    payload: { id: Schema.String },
    success: Schema.Struct({ steering: Schema.Array(Schema.String), followUp: Schema.Array(Schema.String) }),
    error: SessionFail,
  }),
  Rpc.make("sessions.stats", { payload: { id: Schema.String }, success: SessionStats, error: SessionFail }),
  Rpc.make("sessions.history", {
    payload: { id: Schema.String, before: Schema.String, limit: Schema.optional(Schema.Number) },
    success: HistoryPage,
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

// The live channel, served over a WebSocket. It only pushes: the first
// message is a sync from the phone's bookmark (`head`, a pi entry id), then
// changes follow. `cids` are the phone's unconfirmed sends, reported in the sync.
export const PicoSessionRpc = RpcGroup.make(
  Rpc.make("session.live", {
    payload: { id: Schema.String, head: Schema.NullOr(Schema.String), cids: Schema.Array(Schema.String) },
    success: ServerMessage,
    error: SessionFail,
    stream: true,
  }),
);
