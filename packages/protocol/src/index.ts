import * as v from "valibot";

export const PRODUCT_VERSION = "0.4.9";
export const PROTOCOL_VERSION = 1;
export const MIN_MOBILE_VERSION = "0.2.1";
export const RECOMMENDED_MOBILE_VERSION = PRODUCT_VERSION;


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

export const StopReason = v.picklist([
  "stop",
  "length",
  "toolUse",
  "error",
  "aborted",
]);
export type StopReason = v.InferOutput<typeof StopReason>;

export const MessageUsage = v.object({
  input: v.number(),
  output: v.number(),
  cacheRead: v.number(),
  cacheWrite: v.number(),
  total: v.number(),
  cost: v.number(),
});
export type MessageUsage = v.InferOutput<typeof MessageUsage>;

export const AssistantMessage = v.object({
  kind: v.literal("assistant"),
  ...Base,
  text: v.string(),
  streaming: v.optional(v.boolean()),
  stopReason: v.optional(StopReason),
  errorMessage: v.optional(v.string()),
  usage: v.optional(MessageUsage),
});
export type AssistantMessage = v.InferOutput<typeof AssistantMessage>;


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


export const SessionMeta = v.object({
  id: v.string(),
  title: v.string(),
  cwd: v.string(),
  branch: v.optional(v.string()),
  status: SessionStatus,
  updatedAt: v.string(),
  tokens: v.object({ in: v.number(), out: v.number() }),
  costUsd: v.number(),
  archived: v.boolean(),
});
export type SessionMeta = v.InferOutput<typeof SessionMeta>;

export const LocalGitBranch = v.object({
  kind: v.literal("local"),
  name: v.string(),
  current: v.boolean(),
});
export type LocalGitBranch = v.InferOutput<typeof LocalGitBranch>;

export const RemoteGitBranch = v.object({
  kind: v.literal("remote"),
  name: v.string(),
  remote: v.string(),
});
export type RemoteGitBranch = v.InferOutput<typeof RemoteGitBranch>;

export const GitBranch = v.variant("kind", [LocalGitBranch, RemoteGitBranch]);
export type GitBranch = v.InferOutput<typeof GitBranch>;

export const GitBranchesResponse = v.object({
  isRepo: v.boolean(),
  root: v.optional(v.string()),
  current: v.optional(v.string()),
  branches: v.array(GitBranch),
});
export type GitBranchesResponse = v.InferOutput<typeof GitBranchesResponse>;

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

export const ContextUsage = v.object({
  tokens: v.nullable(v.number()),
  contextWindow: v.number(),
  percent: v.nullable(v.number()),
});
export type ContextUsage = v.InferOutput<typeof ContextUsage>;

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
  contextUsage: v.optional(ContextUsage),
});
export type SessionStats = v.InferOutput<typeof SessionStats>;

export const BuiltinCommandEntry = v.object({
  kind: v.literal("builtin"),
  name: v.string(),
  description: v.string(),
  takesArgs: v.optional(v.boolean()),
});
export type BuiltinCommandEntry = v.InferOutput<typeof BuiltinCommandEntry>;

export const PromptCommandEntry = v.object({
  kind: v.literal("prompt"),
  name: v.string(),
  description: v.string(),
  takesArgs: v.optional(v.boolean()),
  source: v.optional(v.string()),
});
export type PromptCommandEntry = v.InferOutput<typeof PromptCommandEntry>;

export const SkillCommandEntry = v.object({
  kind: v.literal("skill"),
  name: v.string(),
  description: v.string(),
  takesArgs: v.optional(v.boolean()),
  source: v.optional(v.string()),
});
export type SkillCommandEntry = v.InferOutput<typeof SkillCommandEntry>;

export const CommandEntry = v.variant("kind", [
  BuiltinCommandEntry,
  PromptCommandEntry,
  SkillCommandEntry,
]);
export type CommandEntry = v.InferOutput<typeof CommandEntry>;

export const Commands = v.object({
  builtins: v.array(BuiltinCommandEntry),
  prompts: v.array(PromptCommandEntry),
  skills: v.array(SkillCommandEntry),
});
export type Commands = v.InferOutput<typeof Commands>;

export const QueueState = v.object({
  steering: v.array(v.string()),
  followUp: v.array(v.string()),
});
export type QueueState = v.InferOutput<typeof QueueState>;

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


const Seq = { seq: v.number() } as const;

export const WireEvent = v.variant("t", [
  v.object({
    t: v.literal("hello"),
    ...Seq,
    session: SessionMeta,
    cursor: v.number(),
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
    stopReason: v.optional(StopReason),
    errorMessage: v.optional(v.string()),
    usage: v.optional(MessageUsage),
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


export const ImageAttachment = v.object({
  data: v.string(),
  mimeType: v.string(),
});
export type ImageAttachment = v.InferOutput<typeof ImageAttachment>;

export const ClientEvent = v.variant("t", [
  v.object({
    t: v.literal("send"),
    text: v.string(),
    mode: v.optional(v.picklist(["steer", "follow_up"])),
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


export const decodeClientEvent = (raw: unknown) =>
  v.safeParse(ClientEvent, raw);

export const decodeWireEvent = (raw: unknown) => v.safeParse(WireEvent, raw);
export const parseWireEvent = (raw: unknown): WireEvent => v.parse(WireEvent, raw);

export const decodeSessionMeta = (raw: unknown) => v.safeParse(SessionMeta, raw);
export const parseSessionMeta = (raw: unknown): SessionMeta =>
  v.parse(SessionMeta, raw);

export const parseSessionStats = (raw: unknown): SessionStats =>
  v.parse(SessionStats, raw);

export const parseCommands = (raw: unknown): Commands =>
  v.parse(Commands, raw);

export const parseGitBranchesResponse = (raw: unknown): GitBranchesResponse =>
  v.parse(GitBranchesResponse, raw);

export const parseQueueState = (raw: unknown): QueueState =>
  v.parse(QueueState, raw);

export const encodeWireEvent = (e: WireEvent): string => JSON.stringify(e);
