/**
 * Shared wire protocol — defined once with Valibot, types derived.
 *
 * Both the bridge and mobile client import this package so REST/WS payload
 * types and runtime validation stay in sync.
 */
import * as v from "valibot";

/* ── primitives ─────────────────────────────────────────────────────── */

export const SessionStatus = v.picklist([
  "idle",
  "thinking",
  "tool",
  "waiting",
  "error",
]);
export type SessionStatus = v.InferOutput<typeof SessionStatus>;

export const ToolName = v.picklist(["read", "write", "edit", "bash"]);
export type ToolName = v.InferOutput<typeof ToolName>;

export const PermissionChoice = v.picklist([
  "allow",
  "deny",
  "allow_session",
]);
export type PermissionChoice = v.InferOutput<typeof PermissionChoice>;

/* ── log entries (server's view of a session log) ───────────────────── */

const Base = {
  id: v.string(),
  at: v.number(),
} as const;

export const UserMessage = v.object({
  kind: v.literal("user"),
  ...Base,
  text: v.string(),
});
export type UserMessage = v.InferOutput<typeof UserMessage>;

/**
 * How an assistant turn ended. Mirrors pi-ai's StopReason:
 *
 *   stop     — model finished naturally
 *   length   — hit the model's max-output-tokens limit
 *   toolUse  — model is requesting tools; followed by tool_call entries
 *              and another assistant turn after the results
 *   error    — provider/network/internal failure; errorMessage explains
 *   aborted  — user (or our /interrupt) cancelled mid-stream
 *
 * The mobile renders "stop" and "toolUse" as normal completions; the
 * other three get an inline indicator on the assistant bubble.
 */
export const StopReason = v.picklist([
  "stop",
  "length",
  "toolUse",
  "error",
  "aborted",
]);
export type StopReason = v.InferOutput<typeof StopReason>;

export const AssistantMessage = v.object({
  kind: v.literal("assistant"),
  ...Base,
  text: v.string(),
  streaming: v.optional(v.boolean()),
  /** Populated once the assistant turn ends. Absent while streaming. */
  stopReason: v.optional(StopReason),
  /** Set when stopReason is "error" or "aborted"; explains the failure. */
  errorMessage: v.optional(v.string()),
});
export type AssistantMessage = v.InferOutput<typeof AssistantMessage>;

export const ToolCallMessage = v.object({
  kind: v.literal("tool_call"),
  ...Base,
  tool: ToolName,
  args: v.record(v.string(), v.unknown()),
  status: v.picklist(["pending", "running", "ok", "error"]),
  result: v.optional(v.string()),
  durationMs: v.optional(v.number()),
});
export type ToolCallMessage = v.InferOutput<typeof ToolCallMessage>;

export const PermissionRequest = v.object({
  kind: v.literal("permission"),
  ...Base,
  tool: ToolName,
  args: v.record(v.string(), v.unknown()),
  rationale: v.optional(v.string()),
  resolved: v.optional(PermissionChoice),
});
export type PermissionRequest = v.InferOutput<typeof PermissionRequest>;

export const LogEntry = v.variant("kind", [
  UserMessage,
  AssistantMessage,
  ToolCallMessage,
  PermissionRequest,
]);
export type LogEntry = v.InferOutput<typeof LogEntry>;

/* ── session metadata (REST surface) ────────────────────────────────── */

export const SessionMeta = v.object({
  id: v.string(),
  title: v.string(),
  cwd: v.string(),
  branch: v.optional(v.string()),
  status: SessionStatus,
  updatedAt: v.number(),
  tokens: v.object({ in: v.number(), out: v.number() }),
  costUsd: v.number(),
  /** True when the user has archived this session. Archived sessions
   *  are excluded from the default list but the row is kept (and can
   *  be restored by PATCHing archived: false). Hard delete is a
   *  separate DELETE. */
  archived: v.optional(v.boolean()),
});
export type SessionMeta = v.InferOutput<typeof SessionMeta>;

export const ModelSummary = v.object({
  provider: v.string(),
  id: v.string(),
  name: v.string(),
  reasoning: v.boolean(),
  input: v.array(v.picklist(["text", "image"])),
  contextWindow: v.number(),
  maxTokens: v.number(),
  current: v.boolean(),
  usingOAuth: v.boolean(),
});
export type ModelSummary = v.InferOutput<typeof ModelSummary>;

export const SessionModelState = v.object({
  current: v.optional(ModelSummary),
  models: v.array(ModelSummary),
});
export type SessionModelState = v.InferOutput<typeof SessionModelState>;

/* ── wire events — server → client ──────────────────────────────────── */

/**
 * Every wire event carries a monotonic `seq` set by the bridge. Clients
 * persist the last seq they saw so reconnects can `resume` and have the
 * bridge replay missed events.
 */
const Seq = { seq: v.number() } as const;

export const WireEvent = v.variant("t", [
  v.object({
    t: v.literal("hello"),
    ...Seq,
    session: SessionMeta,
    cursor: v.number(), // latest seq at the time of hello
  }),
  v.object({ t: v.literal("user_message"), ...Seq, entry: UserMessage }),
  v.object({
    t: v.literal("assistant_delta"),
    ...Seq,
    id: v.string(),
    text: v.string(),
  }),
  v.object({
    t: v.literal("assistant_end"),
    ...Seq,
    id: v.string(),
    /** How the turn ended. Absent only for legacy events written before
     *  this field existed; new code always sets it. */
    stopReason: v.optional(StopReason),
    /** Provider/network/internal error explanation. Set when
     *  stopReason is "error" or "aborted". */
    errorMessage: v.optional(v.string()),
  }),
  v.object({ t: v.literal("tool_call"), ...Seq, entry: ToolCallMessage }),
  v.object({
    t: v.literal("tool_result"),
    ...Seq,
    id: v.string(),
    result: v.string(),
    status: v.picklist(["ok", "error"]),
    durationMs: v.number(),
  }),
  v.object({ t: v.literal("permission"), ...Seq, entry: PermissionRequest }),
  v.object({ t: v.literal("status"), ...Seq, status: SessionStatus }),
  v.object({
    t: v.literal("cost"),
    ...Seq,
    tokensIn: v.number(),
    tokensOut: v.number(),
    costUsd: v.number(),
  }),
  // Pi auto-retries certain provider failures (rate limits, transient
  // network errors). The mobile shows a transient "retrying N of M"
  // pill between auto_retry_start and auto_retry_end. These events are
  // intentionally not persisted as log entries — they're status-only.
  v.object({
    t: v.literal("auto_retry_start"),
    ...Seq,
    attempt: v.number(),
    maxAttempts: v.number(),
    delayMs: v.number(),
    errorMessage: v.string(),
  }),
  v.object({
    t: v.literal("auto_retry_end"),
    ...Seq,
    success: v.boolean(),
    attempt: v.number(),
    finalError: v.optional(v.string()),
  }),
]);
export type WireEvent = v.InferOutput<typeof WireEvent>;

/* ── client events — client → server ────────────────────────────────── */

export const ImageAttachment = v.object({
  /** Base64-encoded image payload (no data: prefix). */
  data: v.string(),
  /** MIME type, e.g. "image/jpeg" or "image/png". */
  mimeType: v.string(),
});
export type ImageAttachment = v.InferOutput<typeof ImageAttachment>;

export const ClientEvent = v.variant("t", [
  v.object({
    t: v.literal("send"),
    text: v.string(),
    // When the agent is streaming, mode picks how to deliver:
    //   "steer"     → after the current turn's tool calls finish (default)
    //   "follow_up" → after the agent finishes all queued work
    // Ignored when the agent is idle.
    mode: v.optional(v.picklist(["steer", "follow_up"])),
    // Inline image attachments (camera/gallery). Sent through to pi's
    // prompt/steer/followUp via the SDK's ImageContent shape.
    images: v.optional(v.array(ImageAttachment)),
  }),
  v.object({
    t: v.literal("permission_reply"),
    id: v.string(),
    choice: PermissionChoice,
  }),
  v.object({ t: v.literal("interrupt") }),
  v.object({
    t: v.literal("resume"),
    sessionId: v.string(),
    cursor: v.number(),
  }),
]);
export type ClientEvent = v.InferOutput<typeof ClientEvent>;

/* ── decode helpers ──────────────────────────────────────────────────── */

export const decodeClientEvent = (raw: unknown) =>
  v.safeParse(ClientEvent, raw);

export const encodeWireEvent = (e: WireEvent): string => JSON.stringify(e);
