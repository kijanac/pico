/**
 * Shared wire protocol — defined once with Valibot, types derived.
 *
 * Both the bridge and mobile client import this package so REST/WS payload
 * types and runtime validation stay in sync.
 */
import * as v from "valibot";

export const PRODUCT_VERSION = "0.3.0";
export const PROTOCOL_VERSION = 1;
export const MIN_MOBILE_VERSION = "0.2.1";
export const RECOMMENDED_MOBILE_VERSION = PRODUCT_VERSION;

/* ── primitives ─────────────────────────────────────────────────────── */

export const SessionStatus = v.picklist([
  "idle",
  "thinking",
  "tool",
  "waiting",
  "error",
]);
export type SessionStatus = v.InferOutput<typeof SessionStatus>;

export const BuiltinToolName = v.picklist(["read", "write", "edit", "bash"]);
export type BuiltinToolName = v.InferOutput<typeof BuiltinToolName>;

export const ToolName = v.string();
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

/* ── tool arguments ─────────────────────────────────────────────────── */

export const ReadToolArgs = v.object({
  path: v.string(),
  offset: v.optional(v.number()),
  limit: v.optional(v.number()),
});
export type ReadToolArgs = v.InferOutput<typeof ReadToolArgs>;

export const WriteToolArgs = v.object({
  path: v.string(),
  content: v.string(),
});
export type WriteToolArgs = v.InferOutput<typeof WriteToolArgs>;

export const EditToolArgs = v.object({
  path: v.string(),
  edits: v.array(
    v.object({
      oldText: v.string(),
      newText: v.string(),
    }),
  ),
});
export type EditToolArgs = v.InferOutput<typeof EditToolArgs>;

export const BashToolArgs = v.object({
  command: v.string(),
  timeout: v.optional(v.number()),
});
export type BashToolArgs = v.InferOutput<typeof BashToolArgs>;

export const CustomToolArgs = v.record(v.string(), v.unknown());
export type CustomToolArgs = v.InferOutput<typeof CustomToolArgs>;

const ToolStatus = v.picklist(["pending", "running", "ok", "error"]);
const BuiltinToolCallBase = {
  kind: v.literal("tool_call"),
  toolKind: v.literal("builtin"),
  ...Base,
  status: ToolStatus,
  result: v.optional(v.string()),
  durationMs: v.optional(v.number()),
} as const;

export const ReadToolCallMessage = v.object({
  ...BuiltinToolCallBase,
  tool: v.literal("read"),
  args: ReadToolArgs,
});
export type ReadToolCallMessage = v.InferOutput<typeof ReadToolCallMessage>;

export const WriteToolCallMessage = v.object({
  ...BuiltinToolCallBase,
  tool: v.literal("write"),
  args: WriteToolArgs,
});
export type WriteToolCallMessage = v.InferOutput<typeof WriteToolCallMessage>;

export const EditToolCallMessage = v.object({
  ...BuiltinToolCallBase,
  tool: v.literal("edit"),
  args: EditToolArgs,
});
export type EditToolCallMessage = v.InferOutput<typeof EditToolCallMessage>;

export const BashToolCallMessage = v.object({
  ...BuiltinToolCallBase,
  tool: v.literal("bash"),
  args: BashToolArgs,
});
export type BashToolCallMessage = v.InferOutput<typeof BashToolCallMessage>;

export const BuiltinToolCallMessage = v.variant("tool", [
  ReadToolCallMessage,
  WriteToolCallMessage,
  EditToolCallMessage,
  BashToolCallMessage,
]);
export type BuiltinToolCallMessage = v.InferOutput<typeof BuiltinToolCallMessage>;

export const CustomToolCallMessage = v.object({
  kind: v.literal("tool_call"),
  toolKind: v.literal("custom"),
  ...Base,
  tool: v.string(),
  args: CustomToolArgs,
  status: ToolStatus,
  result: v.optional(v.string()),
  durationMs: v.optional(v.number()),
});
export type CustomToolCallMessage = v.InferOutput<typeof CustomToolCallMessage>;

export const ToolCallMessage = v.variant("toolKind", [
  BuiltinToolCallMessage,
  CustomToolCallMessage,
]);
export type ToolCallMessage = v.InferOutput<typeof ToolCallMessage>;

const BuiltinPermissionBase = {
  kind: v.literal("permission"),
  toolKind: v.literal("builtin"),
  ...Base,
  rationale: v.optional(v.string()),
  resolved: v.optional(PermissionChoice),
} as const;

export const ReadPermissionRequest = v.object({
  ...BuiltinPermissionBase,
  tool: v.literal("read"),
  args: ReadToolArgs,
});
export const WritePermissionRequest = v.object({
  ...BuiltinPermissionBase,
  tool: v.literal("write"),
  args: WriteToolArgs,
});
export const EditPermissionRequest = v.object({
  ...BuiltinPermissionBase,
  tool: v.literal("edit"),
  args: EditToolArgs,
});
export const BashPermissionRequest = v.object({
  ...BuiltinPermissionBase,
  tool: v.literal("bash"),
  args: BashToolArgs,
});

export const BuiltinPermissionRequest = v.variant("tool", [
  ReadPermissionRequest,
  WritePermissionRequest,
  EditPermissionRequest,
  BashPermissionRequest,
]);

export const CustomPermissionRequest = v.object({
  kind: v.literal("permission"),
  toolKind: v.literal("custom"),
  ...Base,
  tool: v.string(),
  args: CustomToolArgs,
  rationale: v.optional(v.string()),
  resolved: v.optional(PermissionChoice),
});

export const PermissionRequest = v.variant("toolKind", [
  BuiltinPermissionRequest,
  CustomPermissionRequest,
]);
export type PermissionRequest = v.InferOutput<typeof PermissionRequest>;

export const LogEntry = v.union([
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

export const ThinkingLevel = v.picklist(["off", "low", "medium", "high"]);
export type ThinkingLevel = v.InferOutput<typeof ThinkingLevel>;

export const QueueMode = v.picklist(["all", "one-at-a-time"]);
export type QueueMode = v.InferOutput<typeof QueueMode>;

export const SessionSettings = v.object({
  thinkingLevel: ThinkingLevel,
  availableThinkingLevels: v.array(ThinkingLevel),
  steeringMode: QueueMode,
  followUpMode: QueueMode,
  autoCompaction: v.boolean(),
  autoRetry: v.boolean(),
});
export type SessionSettings = v.InferOutput<typeof SessionSettings>;

export const SessionSettingsPatch = v.object({
  thinkingLevel: v.optional(ThinkingLevel),
  steeringMode: v.optional(QueueMode),
  followUpMode: v.optional(QueueMode),
  autoCompaction: v.optional(v.boolean()),
  autoRetry: v.optional(v.boolean()),
});
export type SessionSettingsPatch = v.InferOutput<typeof SessionSettingsPatch>;

export const AuthProvider = v.object({
  id: v.string(),
  name: v.string(),
  configured: v.boolean(),
  source: v.optional(v.string()),
  label: v.optional(v.string()),
});
export type AuthProvider = v.InferOutput<typeof AuthProvider>;

export const AuthProviders = v.object({ providers: v.array(AuthProvider) });
export type AuthProviders = v.InferOutput<typeof AuthProviders>;

export const AuthLoginJob = v.object({
  id: v.string(),
  providerId: v.string(),
  status: v.picklist(["starting", "auth", "device", "prompt", "manual", "progress", "success", "failed", "cancelled"]),
  providerName: v.optional(v.string()),
  authUrl: v.optional(v.string()),
  instructions: v.optional(v.string()),
  userCode: v.optional(v.string()),
  verificationUri: v.optional(v.string()),
  promptMessage: v.optional(v.string()),
  promptPlaceholder: v.optional(v.string()),
  progress: v.optional(v.string()),
  error: v.optional(v.string()),
});
export type AuthLoginJob = v.InferOutput<typeof AuthLoginJob>;

export const SessionStats = v.object({
  sessionFile: v.optional(v.string()),
  sessionId: v.string(),
  userMessages: v.number(),
  assistantMessages: v.number(),
  toolCalls: v.number(),
  toolResults: v.number(),
  totalMessages: v.number(),
  tokens: v.object({
    input: v.number(),
    output: v.number(),
    cacheRead: v.number(),
    cacheWrite: v.number(),
    total: v.number(),
  }),
  cost: v.number(),
});
export type SessionStats = v.InferOutput<typeof SessionStats>;

export const TreeEntry = v.object({
  id: v.string(),
  parentId: v.nullable(v.string()),
  type: v.string(),
  role: v.optional(v.string()),
  text: v.string(),
  timestamp: v.string(),
  depth: v.number(),
  current: v.boolean(),
  onCurrentPath: v.boolean(),
  label: v.optional(v.string()),
  childCount: v.number(),
});
export type TreeEntry = v.InferOutput<typeof TreeEntry>;

export const SessionTree = v.object({
  currentId: v.nullable(v.string()),
  entries: v.array(TreeEntry),
});
export type SessionTree = v.InferOutput<typeof SessionTree>;

export const SystemInfo = v.object({
  bridgeVersion: v.string(),
  protocolVersion: v.number(),
  minMobileVersion: v.string(),
  recommendedMobileVersion: v.string(),
  updateChannel: v.string(),
  autoUpdate: v.boolean(),
});
export type SystemInfo = v.InferOutput<typeof SystemInfo>;

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
    //   "steer"     → after the current turn's tools finish (default)
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
]);
export type ClientEvent = v.InferOutput<typeof ClientEvent>;

/* ── decode helpers ──────────────────────────────────────────────────── */

export const decodeClientEvent = (raw: unknown) =>
  v.safeParse(ClientEvent, raw);

export const decodeWireEvent = (raw: unknown) => v.safeParse(WireEvent, raw);
export const parseWireEvent = (raw: unknown): WireEvent => v.parse(WireEvent, raw);

export const decodeSessionMeta = (raw: unknown) => v.safeParse(SessionMeta, raw);
export const parseSessionMeta = (raw: unknown): SessionMeta =>
  v.parse(SessionMeta, raw);

export const encodeWireEvent = (e: WireEvent): string => JSON.stringify(e);
