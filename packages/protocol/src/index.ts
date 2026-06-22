import { Schema } from "effect";
import { HostErrorCodeSchema } from "./errors.ts";
export {
  HostErrorCodeSchema,
  hostErrorPayloadFromUnknown,
  isHostErrorCode,
} from "./errors.ts";
export type { HostErrorCode, HostErrorPayload } from "./errors.ts";
export {
  PRODUCT_VERSION,
  PROTOCOL_VERSION,
  MIN_MOBILE_VERSION,
  RECOMMENDED_MOBILE_VERSION,
} from "./version.ts";
export {
  PICO_REPO_URL,
  TAILSCALE_TAG,
  renderHostCloudInit,
  type HostCloudInitOptions,
} from "./cloud-init.ts";

export const SessionStatus = Schema.Literal("idle", "thinking", "tool", "waiting", "error");
export type SessionStatus = typeof SessionStatus.Type;

export const SendMode = Schema.Literal("steer", "follow_up");
export type SendMode = typeof SendMode.Type;

export const PermissionChoice = Schema.Literal("allow", "deny", "allow_session");
export type PermissionChoice = typeof PermissionChoice.Type;


const Base = {
  id: Schema.String,
  at: Schema.Number,
};

export const UserMessage = Schema.Struct({
  kind: Schema.Literal("user"),
  ...Base,
  text: Schema.String,
  queued: Schema.optional(Schema.Boolean),
  queueKind: Schema.optional(SendMode),
  // Echoed from the send event so the sender reconciles its optimistic echo and retries stay idempotent.
  clientId: Schema.optional(Schema.String),
});
export type UserMessage = typeof UserMessage.Type;

export const StopReason = Schema.Literal("stop", "length", "toolUse", "error", "aborted");
export type StopReason = typeof StopReason.Type;

export const MessageUsage = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  totalTokens: Schema.Number,
  cost: Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    cacheRead: Schema.Number,
    cacheWrite: Schema.Number,
    total: Schema.Number,
  }),
});
export type MessageUsage = typeof MessageUsage.Type;

export const AssistantMessage = Schema.Struct({
  kind: Schema.Literal("assistant"),
  ...Base,
  text: Schema.String,
  streaming: Schema.optional(Schema.Boolean),
  stopReason: Schema.optional(StopReason),
  errorMessage: Schema.optional(Schema.String),
  errorCode: Schema.optional(HostErrorCodeSchema),
  usage: Schema.optional(MessageUsage),
});
export type AssistantMessage = typeof AssistantMessage.Type;


export const ReadToolArgs = Schema.Struct({
  path: Schema.String,
  offset: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
});
export type ReadToolArgs = typeof ReadToolArgs.Type;

export const WriteToolArgs = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
});
export type WriteToolArgs = typeof WriteToolArgs.Type;

const EditReplacements = Schema.Array(
  Schema.Struct({
    oldText: Schema.String,
    newText: Schema.String,
  }),
);

// Some models (e.g. Opus 4.6, GLM-5.1) emit `edits` as a JSON-encoded string; decode it to the canonical array. No-op on already-parsed args.
export const EditToolArgs = Schema.Struct({
  path: Schema.String,
  edits: Schema.Union(EditReplacements, Schema.parseJson(EditReplacements)),
});
export type EditToolArgs = typeof EditToolArgs.Type;

export const BashToolArgs = Schema.Struct({
  command: Schema.String,
  timeout: Schema.optional(Schema.Number),
});
export type BashToolArgs = typeof BashToolArgs.Type;

export const CustomToolArgs = Schema.Record({ key: Schema.String, value: Schema.Unknown });
export type CustomToolArgs = typeof CustomToolArgs.Type;

const ToolStatus = Schema.Literal("pending", "running", "ok", "error");

export const ToolTextContent = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
});
export type ToolTextContent = typeof ToolTextContent.Type;

export const ToolImageContent = Schema.Struct({
  type: Schema.Literal("image"),
  data: Schema.String,
  mimeType: Schema.String,
});
export type ToolImageContent = typeof ToolImageContent.Type;

export const ToolResultContent = Schema.Union(ToolTextContent, ToolImageContent);
export type ToolResultContent = typeof ToolResultContent.Type;

const BuiltinToolCallBase = {
  kind: Schema.Literal("tool_call"),
  toolKind: Schema.Literal("builtin"),
  ...Base,
  status: ToolStatus,
  result: Schema.optional(Schema.String),
  resultContent: Schema.optional(Schema.Array(ToolResultContent)),
  details: Schema.optional(Schema.Unknown),
  durationMs: Schema.optional(Schema.Number),
};

const ReadToolCallMessage = Schema.Struct({
  ...BuiltinToolCallBase,
  tool: Schema.Literal("read"),
  args: ReadToolArgs,
});

const WriteToolCallMessage = Schema.Struct({
  ...BuiltinToolCallBase,
  tool: Schema.Literal("write"),
  args: WriteToolArgs,
});

const EditToolCallMessage = Schema.Struct({
  ...BuiltinToolCallBase,
  tool: Schema.Literal("edit"),
  args: EditToolArgs,
});

const BashToolCallMessage = Schema.Struct({
  ...BuiltinToolCallBase,
  tool: Schema.Literal("bash"),
  args: BashToolArgs,
});

export const BuiltinToolCallMessage = Schema.Union(
  ReadToolCallMessage,
  WriteToolCallMessage,
  EditToolCallMessage,
  BashToolCallMessage,
);
export type BuiltinToolCallMessage = typeof BuiltinToolCallMessage.Type;

export const CustomToolCallMessage = Schema.Struct({
  kind: Schema.Literal("tool_call"),
  toolKind: Schema.Literal("custom"),
  ...Base,
  tool: Schema.String,
  args: CustomToolArgs,
  status: ToolStatus,
  result: Schema.optional(Schema.String),
  resultContent: Schema.optional(Schema.Array(ToolResultContent)),
  details: Schema.optional(Schema.Unknown),
  durationMs: Schema.optional(Schema.Number),
});
export type CustomToolCallMessage = typeof CustomToolCallMessage.Type;

export const ToolCallMessage = Schema.Union(BuiltinToolCallMessage, CustomToolCallMessage);
export type ToolCallMessage = typeof ToolCallMessage.Type;

const BuiltinPermissionBase = {
  kind: Schema.Literal("permission"),
  toolKind: Schema.Literal("builtin"),
  ...Base,
  rationale: Schema.optional(Schema.String),
  resolved: Schema.optional(PermissionChoice),
};

const ReadPermissionRequest = Schema.Struct({
  ...BuiltinPermissionBase,
  tool: Schema.Literal("read"),
  args: ReadToolArgs,
});
const WritePermissionRequest = Schema.Struct({
  ...BuiltinPermissionBase,
  tool: Schema.Literal("write"),
  args: WriteToolArgs,
});
const EditPermissionRequest = Schema.Struct({
  ...BuiltinPermissionBase,
  tool: Schema.Literal("edit"),
  args: EditToolArgs,
});
const BashPermissionRequest = Schema.Struct({
  ...BuiltinPermissionBase,
  tool: Schema.Literal("bash"),
  args: BashToolArgs,
});

export const BuiltinPermissionRequest = Schema.Union(
  ReadPermissionRequest,
  WritePermissionRequest,
  EditPermissionRequest,
  BashPermissionRequest,
);

export const CustomPermissionRequest = Schema.Struct({
  kind: Schema.Literal("permission"),
  toolKind: Schema.Literal("custom"),
  ...Base,
  tool: Schema.String,
  args: CustomToolArgs,
  rationale: Schema.optional(Schema.String),
  resolved: Schema.optional(PermissionChoice),
});

export const PermissionRequest = Schema.Union(BuiltinPermissionRequest, CustomPermissionRequest);
export type PermissionRequest = typeof PermissionRequest.Type;

export const CompactionReason = Schema.Literal("manual", "threshold", "overflow");
export type CompactionReason = typeof CompactionReason.Type;

export const CompactionStatus = Schema.Literal("running", "success", "error", "aborted");
export type CompactionStatus = typeof CompactionStatus.Type;

export const CompactionEntry = Schema.Struct({
  kind: Schema.Literal("compaction"),
  ...Base,
  status: CompactionStatus,
  reason: Schema.optional(CompactionReason),
  summary: Schema.optional(Schema.String),
  tokensBefore: Schema.optional(Schema.Number),
  errorMessage: Schema.optional(Schema.String),
  willRetry: Schema.optional(Schema.Boolean),
});
export type CompactionEntry = typeof CompactionEntry.Type;

export const LogEntry = Schema.Union(
  UserMessage,
  AssistantMessage,
  ToolCallMessage,
  PermissionRequest,
  CompactionEntry,
);
export type LogEntry = typeof LogEntry.Type;


export const SessionMeta = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  cwd: Schema.String,
  status: SessionStatus,
  updatedAt: Schema.String,
  tokens: Schema.Struct({ in: Schema.Number, out: Schema.Number }),
  costUsd: Schema.Number,
  archived: Schema.Boolean,
});
export type SessionMeta = typeof SessionMeta.Type;

export const SessionControlOption = Schema.Struct({
  value: Schema.String,
  label: Schema.String,
  description: Schema.optional(Schema.String),
  disabled: Schema.optional(Schema.Boolean),
});
export type SessionControlOption = typeof SessionControlOption.Type;

export const SelectSessionControl = Schema.Struct({
  key: Schema.String,
  kind: Schema.Literal("select"),
  label: Schema.String,
  value: Schema.String,
  description: Schema.optional(Schema.String),
  options: Schema.Array(SessionControlOption),
});
export type SelectSessionControl = typeof SelectSessionControl.Type;

export const BooleanSessionControl = Schema.Struct({
  key: Schema.String,
  kind: Schema.Literal("boolean"),
  label: Schema.String,
  value: Schema.Boolean,
  description: Schema.optional(Schema.String),
});
export type BooleanSessionControl = typeof BooleanSessionControl.Type;

export const SessionControl = Schema.Union(SelectSessionControl, BooleanSessionControl);
export type SessionControl = typeof SessionControl.Type;

export const SessionControls = Schema.Struct({
  controls: Schema.Array(SessionControl),
});
export type SessionControls = typeof SessionControls.Type;

export const SessionControlValueBody = Schema.Struct({
  value: Schema.Union(Schema.String, Schema.Boolean),
});
export type SessionControlValueBody = typeof SessionControlValueBody.Type;

export const AuthProvider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  configured: Schema.Boolean,
  authType: Schema.Literal("oauth", "api_key", "setup"),
  source: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
});
export type AuthProvider = typeof AuthProvider.Type;

export const AuthProviders = Schema.Struct({ providers: Schema.Array(AuthProvider) });
export type AuthProviders = typeof AuthProviders.Type;

export const AuthLoginJob = Schema.Struct({
  id: Schema.String,
  providerId: Schema.String,
  status: Schema.Literal("starting", "auth", "device", "prompt", "manual", "progress", "success", "failed", "cancelled"),
  providerName: Schema.optional(Schema.String),
  authUrl: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  userCode: Schema.optional(Schema.String),
  verificationUri: Schema.optional(Schema.String),
  promptMessage: Schema.optional(Schema.String),
  promptPlaceholder: Schema.optional(Schema.String),
  progress: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});
export type AuthLoginJob = typeof AuthLoginJob.Type;

export const ContextUsage = Schema.Struct({
  tokens: Schema.NullOr(Schema.Number),
  contextWindow: Schema.Number,
  percent: Schema.NullOr(Schema.Number),
});
export type ContextUsage = typeof ContextUsage.Type;

export const SessionStats = Schema.Struct({
  sessionFile: Schema.optional(Schema.String),
  sessionId: Schema.String,
  cwd: Schema.String,
  userMessages: Schema.Number,
  assistantMessages: Schema.Number,
  toolCalls: Schema.Number,
  toolResults: Schema.Number,
  totalMessages: Schema.Number,
  tokens: Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    cacheRead: Schema.Number,
    cacheWrite: Schema.Number,
    total: Schema.Number,
  }),
  cost: Schema.Number,
  contextUsage: Schema.optional(ContextUsage),
});
export type SessionStats = typeof SessionStats.Type;

export const BuiltinCommandEntry = Schema.Struct({
  kind: Schema.Literal("builtin"),
  name: Schema.String,
  description: Schema.String,
  takesArgs: Schema.optional(Schema.Boolean),
});
export type BuiltinCommandEntry = typeof BuiltinCommandEntry.Type;

export const PromptCommandEntry = Schema.Struct({
  kind: Schema.Literal("prompt"),
  name: Schema.String,
  description: Schema.String,
  takesArgs: Schema.optional(Schema.Boolean),
  source: Schema.optional(Schema.String),
});
export type PromptCommandEntry = typeof PromptCommandEntry.Type;

export const SkillCommandEntry = Schema.Struct({
  kind: Schema.Literal("skill"),
  name: Schema.String,
  description: Schema.String,
  takesArgs: Schema.optional(Schema.Boolean),
  source: Schema.optional(Schema.String),
});
export type SkillCommandEntry = typeof SkillCommandEntry.Type;

export const CommandEntry = Schema.Union(
  BuiltinCommandEntry,
  PromptCommandEntry,
  SkillCommandEntry,
);
export type CommandEntry = typeof CommandEntry.Type;

export const Commands = Schema.Struct({
  builtins: Schema.Array(BuiltinCommandEntry),
  prompts: Schema.Array(PromptCommandEntry),
  skills: Schema.Array(SkillCommandEntry),
});
export type Commands = typeof Commands.Type;

export const QueuedMessage = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  queueKind: SendMode,
});
export type QueuedMessage = typeof QueuedMessage.Type;

export const QueueState = Schema.Struct({
  queued: Schema.Array(QueuedMessage),
});
export type QueueState = typeof QueueState.Type;

const ExtensionUiBase = {
  id: Schema.String,
  title: Schema.String,
  timeoutMs: Schema.optional(Schema.Number),
};

export const ExtensionUiConfirmRequest = Schema.Struct({
  kind: Schema.Literal("confirm"),
  ...ExtensionUiBase,
  message: Schema.String,
});
export const ExtensionUiSelectRequest = Schema.Struct({
  kind: Schema.Literal("select"),
  ...ExtensionUiBase,
  options: Schema.Array(Schema.String),
});
export const ExtensionUiInputRequest = Schema.Struct({
  kind: Schema.Literal("input"),
  ...ExtensionUiBase,
  placeholder: Schema.optional(Schema.String),
  initialValue: Schema.optional(Schema.String),
  multiline: Schema.optional(Schema.Boolean),
});
export const ExtensionUiNotifyRequest = Schema.Struct({
  kind: Schema.Literal("notify"),
  id: Schema.String,
  message: Schema.String,
  level: Schema.Literal("info", "warning", "error"),
});
export const ExtensionUiStatusRequest = Schema.Struct({
  kind: Schema.Literal("status"),
  id: Schema.String,
  key: Schema.String,
  text: Schema.NullOr(Schema.String),
});
export const ExtensionUiRequest = Schema.Union(
  ExtensionUiConfirmRequest,
  ExtensionUiSelectRequest,
  ExtensionUiInputRequest,
  ExtensionUiNotifyRequest,
  ExtensionUiStatusRequest,
);
export type ExtensionUiRequest = typeof ExtensionUiRequest.Type;

export const ExtensionUiResponseValue = Schema.NullOr(Schema.Union(Schema.String, Schema.Boolean));
export type ExtensionUiResponseValue = typeof ExtensionUiResponseValue.Type;

export const TreeEntry = Schema.Struct({
  id: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  type: Schema.String,
  role: Schema.optional(Schema.String),
  text: Schema.String,
  timestamp: Schema.String,
  depth: Schema.Number,
  current: Schema.Boolean,
  onCurrentPath: Schema.Boolean,
  label: Schema.optional(Schema.String),
  childCount: Schema.Number,
});
export type TreeEntry = typeof TreeEntry.Type;

export const SessionTree = Schema.Struct({
  currentId: Schema.NullOr(Schema.String),
  entries: Schema.Array(TreeEntry),
});
export type SessionTree = typeof SessionTree.Type;

export const SystemInfo = Schema.Struct({
  hostVersion: Schema.String,
  protocolVersion: Schema.Number,
  minMobileVersion: Schema.String,
  recommendedMobileVersion: Schema.String,
  updateChannel: Schema.String,
  autoUpdate: Schema.Boolean,
});
export type SystemInfo = typeof SystemInfo.Type;

export const HostUpdateStatus = Schema.Struct({
  currentVersion: Schema.String,
  autoUpdate: Schema.Boolean,
  manualUpdate: Schema.Boolean,
  lastSeenVersion: Schema.optional(Schema.String),
  requestedAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  failure: Schema.optional(Schema.Struct({
    version: Schema.String,
    reason: Schema.String,
    at: Schema.Number,
  })),
});
export type HostUpdateStatus = typeof HostUpdateStatus.Type;


const Seq = { seq: Schema.Number };

export const WireEvent = Schema.Union(
  Schema.Struct({
    t: Schema.Literal("hello"),
    ...Seq,
    session: SessionMeta,
    cursor: Schema.Number,
  }),
  Schema.Struct({ t: Schema.Literal("user_message"), ...Seq, entry: UserMessage }),
  Schema.Struct({ t: Schema.Literal("log_reset"), ...Seq, entries: Schema.Array(LogEntry) }),
  Schema.Struct({
    t: Schema.Literal("assistant_delta"),
    ...Seq,
    id: Schema.String,
    text: Schema.String,
  }),
  Schema.Struct({
    t: Schema.Literal("assistant_end"),
    ...Seq,
    id: Schema.String,
    stopReason: Schema.optional(StopReason),
    errorMessage: Schema.optional(Schema.String),
    errorCode: Schema.optional(HostErrorCodeSchema),
    usage: Schema.optional(MessageUsage),
  }),
  Schema.Struct({ t: Schema.Literal("tool_call"), ...Seq, entry: ToolCallMessage }),
  Schema.Struct({
    t: Schema.Literal("tool_update"),
    ...Seq,
    id: Schema.String,
    result: Schema.String,
    resultContent: Schema.optional(Schema.Array(ToolResultContent)),
    details: Schema.optional(Schema.Unknown),
  }),
  Schema.Struct({
    t: Schema.Literal("tool_result"),
    ...Seq,
    id: Schema.String,
    result: Schema.String,
    resultContent: Schema.optional(Schema.Array(ToolResultContent)),
    details: Schema.optional(Schema.Unknown),
    status: Schema.Literal("ok", "error"),
    durationMs: Schema.Number,
  }),
  Schema.Struct({ t: Schema.Literal("permission"), ...Seq, entry: PermissionRequest }),
  Schema.Struct({ t: Schema.Literal("compaction"), ...Seq, entry: CompactionEntry }),
  Schema.Struct({ t: Schema.Literal("status"), ...Seq, status: SessionStatus }),
  Schema.Struct({
    t: Schema.Literal("queue"),
    ...Seq,
    queued: Schema.Array(QueuedMessage),
  }),
  Schema.Struct({
    t: Schema.Literal("cost"),
    ...Seq,
    tokensIn: Schema.Number,
    tokensOut: Schema.Number,
    costUsd: Schema.Number,
  }),
  Schema.Struct({
    t: Schema.Literal("auto_retry_start"),
    ...Seq,
    attempt: Schema.Number,
    maxAttempts: Schema.Number,
    delayMs: Schema.Number,
    errorMessage: Schema.String,
  }),
  Schema.Struct({
    t: Schema.Literal("auto_retry_end"),
    ...Seq,
    success: Schema.Boolean,
    attempt: Schema.Number,
    finalError: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    t: Schema.Literal("extension_ui_request"),
    ...Seq,
    request: ExtensionUiRequest,
  }),
);
export type WireEvent = typeof WireEvent.Type;


export const ImageAttachment = Schema.Struct({
  data: Schema.String,
  mimeType: Schema.String,
});
export type ImageAttachment = typeof ImageAttachment.Type;

export const ClientEvent = Schema.Union(
  Schema.Struct({
    t: Schema.Literal("send"),
    text: Schema.String,
    mode: Schema.optional(SendMode),
    images: Schema.optional(Schema.Array(ImageAttachment)),
    // Idempotency key: the host drops repeats and echoes it back on user_message.
    clientId: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    t: Schema.Literal("permission_reply"),
    id: Schema.String,
    choice: PermissionChoice,
  }),
  Schema.Struct({ t: Schema.Literal("interrupt") }),
  Schema.Struct({
    t: Schema.Literal("extension_ui_response"),
    id: Schema.String,
    value: ExtensionUiResponseValue,
  }),
);
export type ClientEvent = typeof ClientEvent.Type;


export const decodeClientEvent = Schema.decodeUnknownEither(ClientEvent);

export const decodeWireEvent = Schema.decodeUnknownEither(WireEvent);
export const parseWireEvent = Schema.decodeUnknownSync(WireEvent);

export const encodeWireEvent = (e: WireEvent): string => JSON.stringify(e);
