import * as Schema from "effect/Schema";
export { HostErrorCodeSchema, isHostErrorCode } from "./errors.ts";
export type { HostErrorCode } from "./errors.ts";
export { PRODUCT_VERSION } from "./version.ts";

export const ImageMediaType = Schema.Literal("image/png", "image/jpeg", "image/gif", "image/webp", "image/avif");
export type ImageMediaType = typeof ImageMediaType.Type;

export const FsListing = Schema.Struct({
  path: Schema.String,
  parent: Schema.NullOr(Schema.String),
  home: Schema.String,
  entries: Schema.Array(Schema.Struct({
    name: Schema.String,
    hidden: Schema.Boolean,
    kind: Schema.Literal("directory", "file", "other"),
    size: Schema.NullOr(Schema.Number),
  })),
});
export type FsListing = typeof FsListing.Type;

export const FsFile = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("text"), path: Schema.String, text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("pdf"), path: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("image"), path: Schema.String, mediaType: ImageMediaType }),
);
export type FsFile = typeof FsFile.Type;

export const FileChangeId = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));

export const FileChange = Schema.Struct({
  path: Schema.String,
  before: Schema.String,
  after: Schema.String,
});
export type FileChange = typeof FileChange.Type;

export const FileChangeRef = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("saved"), id: FileChangeId, path: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("unavailable"),
    path: Schema.String,
    reason: Schema.Literal("too_large", "not_text", "not_saved"),
  }),
);
export type FileChangeRef = typeof FileChangeRef.Type;

export const FileChangeDetails = Schema.Struct({ picoFileChange: FileChangeRef });

export const SessionStatus = Schema.Literal("idle", "thinking", "tool", "waiting", "error");
export type SessionStatus = typeof SessionStatus.Type;

export const SendMode = Schema.Literal("steer", "follow_up");
export type SendMode = typeof SendMode.Type;

export const ImageContent = Schema.Struct({
  type: Schema.Literal("image"),
  data: Schema.String,
  mimeType: Schema.String,
});
export type ImageContent = typeof ImageContent.Type;

const Base = {
  id: Schema.String,
  at: Schema.Number,
};

export const UserMessage = Schema.Struct({
  kind: Schema.Literal("user"),
  ...Base,
  text: Schema.String,
  images: Schema.optional(Schema.Array(ImageContent)),
  cid: Schema.optional(Schema.String),
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

const UNSAFE_RECORD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const isSafePlainRecord = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return (proto === null || proto === Object.prototype) && !Object.keys(value).some((key) => UNSAFE_RECORD_KEYS.has(key));
};

const SafeCustomToolArgsInput = Schema.Object.pipe(
  Schema.filter(isSafePlainRecord, { message: () => "custom tool args must be a safe plain record" }),
);

const CustomToolArgsRecord = Schema.Record({ key: Schema.String, value: Schema.Unknown }).pipe(
  Schema.filter(isSafePlainRecord, { message: () => "custom tool args must not contain prototype-polluting keys" }),
);

export const CustomToolArgs = SafeCustomToolArgsInput.pipe(Schema.compose(CustomToolArgsRecord));
export type CustomToolArgs = typeof CustomToolArgs.Type;

const ToolStatus = Schema.Literal("pending", "running", "ok", "error");

export const ToolTextContent = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
});
export type ToolTextContent = typeof ToolTextContent.Type;

export const ToolImageContent = ImageContent;
export type ToolImageContent = ImageContent;

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

export function hasToolDetails(details: unknown): boolean {
  if (details === undefined || details === null) return false;
  return typeof details !== "object" || Object.keys(details).length > 0;
}

export const CompactionStatus = Schema.Literal("running", "success");
export type CompactionStatus = typeof CompactionStatus.Type;

export const CompactionEntry = Schema.Struct({
  kind: Schema.Literal("compaction"),
  ...Base,
  status: CompactionStatus,
  summary: Schema.optional(Schema.String),
  tokensBefore: Schema.optional(Schema.Number),
});
export type CompactionEntry = typeof CompactionEntry.Type;

export const NoteEntry = Schema.Struct({
  kind: Schema.Literal("note"),
  ...Base,
  label: Schema.String,
  text: Schema.String,
});
export type NoteEntry = typeof NoteEntry.Type;

export const LogEntry = Schema.Union(
  UserMessage,
  AssistantMessage,
  ToolCallMessage,
  CompactionEntry,
  NoteEntry,
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

export const AuthSelectOption = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
});
export type AuthSelectOption = typeof AuthSelectOption.Type;

const AuthLoginJobBase = {
  id: Schema.String,
  providerId: Schema.String,
  providerName: Schema.String,
};

export const AuthLoginJob = Schema.Union(
  Schema.Struct({ ...AuthLoginJobBase, status: Schema.Literal("starting") }),
  Schema.Struct({
    ...AuthLoginJobBase,
    status: Schema.Literal("auth"),
    authUrl: Schema.String,
    instructions: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    ...AuthLoginJobBase,
    status: Schema.Literal("device"),
    userCode: Schema.String,
    verificationUri: Schema.String,
  }),
  Schema.Struct({ ...AuthLoginJobBase, status: Schema.Literal("progress"), progress: Schema.String }),
  Schema.Struct({
    ...AuthLoginJobBase,
    status: Schema.Literal("select"),
    selectMessage: Schema.String,
    selectOptions: Schema.Array(AuthSelectOption),
  }),
  Schema.Struct({
    ...AuthLoginJobBase,
    status: Schema.Literal("prompt"),
    promptMessage: Schema.String,
    promptPlaceholder: Schema.optional(Schema.String),
  }),
  Schema.Struct({ ...AuthLoginJobBase, status: Schema.Literal("manual"), promptMessage: Schema.String }),
  Schema.Struct({ ...AuthLoginJobBase, status: Schema.Literal("success") }),
  Schema.Struct({ ...AuthLoginJobBase, status: Schema.Literal("failed"), error: Schema.String }),
  Schema.Struct({ ...AuthLoginJobBase, status: Schema.Literal("cancelled"), error: Schema.optional(Schema.String) }),
);
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

export const ExtensionCommandEntry = Schema.Struct({
  kind: Schema.Literal("extension"),
  name: Schema.String,
  description: Schema.String,
  takesArgs: Schema.optional(Schema.Boolean),
  source: Schema.optional(Schema.String),
});
export type ExtensionCommandEntry = typeof ExtensionCommandEntry.Type;

export const CommandEntry = Schema.Union(
  BuiltinCommandEntry,
  PromptCommandEntry,
  SkillCommandEntry,
  ExtensionCommandEntry,
);
export type CommandEntry = typeof CommandEntry.Type;

export const Commands = Schema.Struct({
  builtins: Schema.Array(BuiltinCommandEntry),
  prompts: Schema.Array(PromptCommandEntry),
  skills: Schema.Array(SkillCommandEntry),
  extensions: Schema.Array(ExtensionCommandEntry),
});
export type Commands = typeof Commands.Type;

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


export const ToolCall = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  args: Schema.Unknown,
});
export type ToolCall = typeof ToolCall.Type;

export const Entry = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("user"),
    ...Base,
    text: Schema.String,
    images: Schema.optional(Schema.Array(ImageContent)),
    cid: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("assistant"),
    ...Base,
    text: Schema.String,
    tools: Schema.Array(ToolCall),
    stopReason: Schema.optional(StopReason),
    errorMessage: Schema.optional(Schema.String),
    usage: Schema.optional(MessageUsage),
  }),
  Schema.Struct({
    type: Schema.Literal("tool_result"),
    ...Base,
    toolCallId: Schema.String,
    isError: Schema.Boolean,
    result: Schema.optional(Schema.String),
    resultContent: Schema.optional(Schema.Array(ToolResultContent)),
    details: Schema.optional(Schema.Unknown),
  }),
  Schema.Struct({
    type: Schema.Literal("compaction"),
    ...Base,
    summary: Schema.String,
    tokensBefore: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("note"),
    ...Base,
    label: Schema.String,
    text: Schema.String,
  }),
);
export type Entry = typeof Entry.Type;

export const RetryInfo = Schema.Struct({
  attempt: Schema.Number,
  maxAttempts: Schema.Number,
  delayMs: Schema.Number,
  errorMessage: Schema.String,
});
export type RetryInfo = typeof RetryInfo.Type;

export const QueueItem = Schema.Struct({
  text: Schema.String,
  mode: SendMode,
  cid: Schema.optional(Schema.String),
});
export type QueueItem = typeof QueueItem.Type;

export const LiveTool = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  details: Schema.optional(Schema.Unknown),
});
export type LiveTool = typeof LiveTool.Type;

export const Elsewhere = Schema.Struct({ messages: Schema.Number, at: Schema.Number });
export type Elsewhere = typeof Elsewhere.Type;

export const Live = Schema.Struct({
  running: Schema.Boolean,
  compacting: Schema.Boolean,
  retry: Schema.optional(RetryInfo),
  msg: Schema.optional(
    Schema.Struct({
      at: Schema.Number,
      text: Schema.String,
      calls: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, args: Schema.String })),
    }),
  ),
  tools: Schema.Array(LiveTool),
  queue: Schema.Array(QueueItem),
  ui: Schema.Array(ExtensionUiRequest),
  elsewhere: Schema.optional(Elsewhere),
});
export type Live = typeof Live.Type;

export const SendState = Schema.Literal("started", "queued", "held", "handled", "delivered", "cleared", "failed");
export type SendState = typeof SendState.Type;

const SendStatusFields = {
  cid: Schema.String,
  state: SendState,
  error: Schema.optional(Schema.String),
};
export const SendStatus = Schema.Struct(SendStatusFields);
export type SendStatus = typeof SendStatus.Type;

const TextChange = {
  drop: Schema.optional(Schema.Number),
  from: Schema.Number,
  s: Schema.String,
};

export const LiveEvent = Schema.Union(
  Schema.Struct({ t: Schema.Literal("msg"), at: Schema.Number }),
  Schema.Struct({ t: Schema.Literal("d"), s: Schema.String }),
  Schema.Struct({ t: Schema.Literal("call"), id: Schema.String, name: Schema.String, ...TextChange }),
  Schema.Struct({ t: Schema.Literal("out"), id: Schema.String, ...TextChange, details: Schema.optional(Schema.Unknown) }),
  Schema.Struct({
    t: Schema.Literal("run"),
    running: Schema.Boolean,
    compacting: Schema.Boolean,
    retry: Schema.optional(RetryInfo),
  }),
  Schema.Struct({ t: Schema.Literal("queue"), queue: Schema.Array(QueueItem) }),
  Schema.Struct({ t: Schema.Literal("ui"), request: ExtensionUiRequest }),
  Schema.Struct({ t: Schema.Literal("ui_done"), id: Schema.String }),
  Schema.Struct({ t: Schema.Literal("elsewhere"), elsewhere: Schema.optional(Elsewhere) }),
);
export type LiveEvent = typeof LiveEvent.Type;

export const ServerMessage = Schema.Union(
  Schema.Struct({
    t: Schema.Literal("sync"),
    reset: Schema.Boolean,
    leaf: Schema.NullOr(Schema.String),
    entries: Schema.Array(Entry),
    more: Schema.optional(Schema.String),
    live: Live,
    session: SessionMeta,
    sends: Schema.Array(SendStatus),
  }),
  Schema.Struct({ t: Schema.Literal("entries"), leaf: Schema.NullOr(Schema.String), entries: Schema.Array(Entry) }),
  ...LiveEvent.members,
  Schema.Struct({ t: Schema.Literal("send"), ...SendStatusFields }),
  Schema.Struct({ t: Schema.Literal("meta"), session: SessionMeta }),
);
export type ServerMessage = typeof ServerMessage.Type;

export const HistoryPage = Schema.Struct({
  entries: Schema.Array(Entry),
  more: Schema.optional(Schema.String),
});
export type HistoryPage = typeof HistoryPage.Type;
