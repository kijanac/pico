import * as Rpc from "@effect/rpc/Rpc";
import * as RpcGroup from "@effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import {
  AuthLoginJob,
  AuthProviders,
  Commands,
  ExtensionUiResponseValue,
  FileChange,
  FileChangeId,
  FsFile,
  FsListing,
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

export { FsFile, FsListing } from "./index.ts";

export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()("SessionNotFound", {
  id: Schema.String,
}) {}

export class RequestError extends Schema.TaggedError<RequestError>()("RequestError", {
  message: Schema.String,
}) {}

const SessionFail = Schema.Union(SessionNotFound, RequestError);
const Trimmed = Schema.NonEmptyTrimmedString;

export const PicoRpc = RpcGroup.make(
  Rpc.make("sessions.list", { payload: { archived: Schema.optional(Schema.Boolean), fresh: Schema.optional(Schema.Boolean) }, success: Schema.Array(SessionMeta), error: RequestError }),
  Rpc.make("sessions.create", { payload: { cwd: Trimmed, title: Schema.optional(Trimmed) }, success: SessionMeta, error: RequestError }),
  Rpc.make("sessions.patch", { payload: { id: Schema.String, title: Schema.optional(Trimmed), archived: Schema.optional(Schema.Boolean) }, success: SessionMeta, error: SessionFail }),
  Rpc.make("sessions.remove", { payload: { id: Schema.String }, error: SessionFail }),
  Rpc.make("sessions.controls", { payload: { id: Schema.String }, success: SessionControls, error: SessionFail }),
  Rpc.make("sessions.patchControl", { payload: { id: Schema.String, key: Schema.String, value: Schema.Union(Schema.String, Schema.Boolean) }, success: SessionControls, error: SessionFail }),
  Rpc.make("sessions.compact", { payload: { id: Schema.String, instructions: Schema.optional(Schema.String) }, error: SessionFail }),
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
  Rpc.make("fs.ls", { payload: { path: Schema.optional(Schema.String), files: Schema.optional(Schema.Boolean), showHidden: Schema.optional(Schema.Boolean) }, success: FsListing, error: RequestError }),
  Rpc.make("fs.read", { payload: { path: Schema.String, relativeTo: Schema.optional(Schema.String) }, success: FsFile, error: RequestError }),
  Rpc.make("fs.change", { payload: { id: FileChangeId }, success: FileChange, error: RequestError }),
);

export const PicoSessionRpc = RpcGroup.make(
  Rpc.make("session.live", {
    payload: { id: Schema.String, head: Schema.NullOr(Schema.String), cids: Schema.Array(Schema.String) },
    success: ServerMessage,
    error: SessionFail,
    stream: true,
  }),
);
