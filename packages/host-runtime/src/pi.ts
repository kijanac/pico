import {
  Context,
  Effect,
  Layer,
  Option,
  Queue,
  Schema,
  Stream,
} from "effect";
import {
  AuthStorage,
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager as PiSessionManager,
  type AgentSession,
  type AgentSessionServices,
  type AgentSessionEvent,
  type SessionEntry,
  type SessionStats as PiSdkSessionStats,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage as PiAssistantMessage, Model } from "@earendil-works/pi-ai";
import { randomUUIDv7 } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import {
  BashToolArgs,
  CustomToolArgs,
  type Commands,
  type CompactionEntry as ProtocolCompactionEntry,
  EditToolArgs,
  type LogEntry,
  ReadToolArgs,
  WriteToolArgs,
  type ExtensionUiRequest,
  type ExtensionUiResponseValue,
  type HostErrorCode,
  type PermissionChoice,
  type PermissionRequest,
  type SendMode,
  type SessionControls,
  type ToolResultContent,
  type SessionMeta,
  type SessionStats,
  type SessionStatus,
  type SessionTree,
  type ToolCallMessage,
  type TreeEntry,
} from "@pico/protocol";
import { hostErrorCodeFromUnknown, SessionNotFound } from "./errors.ts";
import { HOST_DATA_DIR, PI_EPHEMERAL } from "./config.ts";
import { createMobileExtensionUiChannel } from "./mobile-extension-ui-channel.ts";
import { projectToolResult, projectToolResultContent, textFromContent } from "./tool-result-projection.ts";


export type SdkQueueState = Pick<Extract<AgentSessionEvent, { type: "queue_update" }>, "steering" | "followUp">;

export type PiEmission =
  | { t: "log_reset"; entries: LogEntry[] }
  | { t: "assistant_delta"; id: string; text: string }
  | {
      t: "assistant_end";
      id: string;
      stopReason?:
        | "stop"
        | "length"
        | "toolUse"
        | "error"
        | "aborted";
      errorMessage?: string;
      errorCode?: HostErrorCode;
      usage?: PiAssistantMessage["usage"];
    }
  | { t: "tool_call"; entry: ToolCallMessage }
  | {
      t: "tool_update";
      id: string;
      result: string;
      resultContent?: ToolResultContent[];
      details?: unknown;
    }
  | {
      t: "tool_result";
      id: string;
      result: string;
      resultContent?: ToolResultContent[];
      details?: unknown;
      status: "ok" | "error";
      durationMs: number;
    }
  | { t: "permission"; entry: PermissionRequest }
  | { t: "compaction"; entry: ProtocolCompactionEntry }
  | { t: "status"; status: SessionStatus }
  | ({ t: "queue" } & SdkQueueState)
  | { t: "cost"; tokensIn: number; tokensOut: number; costUsd: number }
  | {
      t: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | {
      t: "auto_retry_end";
      success: boolean;
      attempt: number;
      finalError?: string;
    }
  | { t: "extension_ui_request"; request: ExtensionUiRequest };

export class PiError extends Error {
  readonly _tag = "PiError";
  readonly hostErrorCode?: HostErrorCode;

  constructor(message: string, options?: ErrorOptions & { hostErrorCode?: HostErrorCode }) {
    super(message, options);
    this.hostErrorCode = options?.hostErrorCode ?? hostErrorCodeFromUnknown(options?.cause);
  }
}

export type { SendMode } from "@pico/protocol";

export interface SendImage {
  data: string;
  mimeType: string;
}

export interface ExportedHtml {
  readonly stream: ReadableStream<Uint8Array>;
  readonly size?: number;
  readonly filename?: string;
}

export interface QueuedSend {
  readonly text: string;
  readonly mode: SendMode;
  readonly images?: SendImage[];
}

export interface PiSession {
  readonly meta: SessionMeta;
  readonly events: Stream.Stream<PiEmission, PiError>;
  readonly send: (
    text: string,
    mode?: SendMode,
    images?: SendImage[],
  ) => Effect.Effect<void, PiError>;
  readonly isCompacting: () => Effect.Effect<boolean, PiError>;
  readonly flushAfterCompaction: (
    messages: readonly QueuedSend[],
    opts?: { willRetry?: boolean },
  ) => Effect.Effect<void, PiError>;
  readonly interrupt: () => Effect.Effect<void, PiError>;
  readonly extensionUiResponse: (
    id: string,
    value: ExtensionUiResponseValue,
  ) => Effect.Effect<void, PiError>;
  readonly approve: (
    id: string,
    choice: PermissionChoice,
  ) => Effect.Effect<void, PiError>;
  readonly compact: (instructions?: string) => Effect.Effect<void, PiError>;
  readonly exportHtml: () => Effect.Effect<ExportedHtml, PiError>;
  readonly listCommands: () => Effect.Effect<Commands, PiError>;
  readonly getQueue: () => Effect.Effect<SdkQueueState, PiError>;
  readonly clearQueue: () => Effect.Effect<SdkQueueState, PiError>;
  readonly getSettings: () => Effect.Effect<SessionControls, PiError>;
  readonly patchSession: (patch: { title?: string }) => Effect.Effect<void, PiError>;
  readonly patchSetting: (key: string, value: string | boolean) => Effect.Effect<SessionControls, PiError>;
  readonly getStats: () => Effect.Effect<SessionStats, PiError>;
  readonly getLog: () => Effect.Effect<LogEntry[], PiError>;
  readonly getTree: () => Effect.Effect<SessionTree, PiError>;
  readonly navigateTree: (entryId: string, summarize?: boolean) => Effect.Effect<void, PiError>;
  readonly close: () => Effect.Effect<void>;
}

export class PiClient extends Context.Tag("PiClient")<
  PiClient,
  {
    readonly create: (opts: {
      cwd: string;
      title: string;
    }) => Effect.Effect<PiSession, PiError>;
    readonly resume: (
      storedRecord: import("./session-record.ts").SessionRecord,
    ) => Effect.Effect<PiSession, PiError | SessionNotFound>;
  }
>() {}


const EXPORT_DIR = join(HOST_DATA_DIR, "exports");
const EXPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const authStorage = AuthStorage.create();
const servicesByCwd = new Map<string, Promise<AgentSessionServices>>();

export const reloadAgentAuth = (): void => authStorage.reload();

export const getAgentServices = (cwd: string): Promise<AgentSessionServices> => {
  const key = resolve(cwd);
  const existing = servicesByCwd.get(key);
  if (existing) return existing;
  const created = createAgentSessionServices({ cwd: key, authStorage });
  servicesByCwd.set(key, created);
  return created;
};

const safeFilenamePart = (value: string) =>
  value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "session";

async function cleanupOldExports(now = Date.now()): Promise<void> {
  const entries = await readdir(EXPORT_DIR, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && (entry.name.endsWith(".html") || entry.name.endsWith(".tmp")))
      .map(async (entry) => {
        const path = join(EXPORT_DIR, entry.name);
        const info = await stat(path).catch(() => undefined);
        if (info && now - info.mtimeMs > EXPORT_MAX_AGE_MS) {
          await rm(path, { force: true }).catch(() => undefined);
        }
      }),
  );
}

const queueModeOptions = [
  { value: "one-at-a-time", label: "one-at-a-time" },
  { value: "all", label: "all" },
];

const modelControlValue = (model: Model<any>): string => `${model.provider}/${model.id}`;

const modelControlDescription = (piSession: AgentSession, model: Model<any>): string => {
  const provider = piSession.modelRegistry.getProviderDisplayName(model.provider);
  const tags = [provider, model.id];
  if (model.reasoning) tags.push("reasoning");
  if (model.input.includes("image")) tags.push("image");
  tags.push(`${Math.round(model.contextWindow / 1000)}k context`);
  return tags.join(" · ");
};

const sessionSettings = (piSession: AgentSession): SessionControls => ({
  controls: [
    {
      key: "model",
      kind: "select",
      label: "model",
      value: piSession.model ? modelControlValue(piSession.model) : "",
      options: piSession.modelRegistry.getAvailable().map((model) => ({
        value: modelControlValue(model),
        label: model.name,
        description: modelControlDescription(piSession, model),
      })),
    },
    {
      key: "thinkingLevel",
      kind: "select",
      label: "thinking level",
      value: piSession.thinkingLevel,
      options: piSession.getAvailableThinkingLevels().map((level) => ({ value: level, label: level })),
    },
    {
      key: "steeringMode",
      kind: "select",
      label: "steering while running",
      value: piSession.steeringMode,
      options: queueModeOptions,
    },
    {
      key: "followUpMode",
      kind: "select",
      label: "follow-up delivery",
      value: piSession.followUpMode,
      options: queueModeOptions,
    },
    {
      key: "autoCompaction",
      kind: "boolean",
      label: "auto compact",
      value: piSession.autoCompactionEnabled,
    },
    {
      key: "autoRetry",
      kind: "boolean",
      label: "auto retry",
      value: piSession.autoRetryEnabled,
    },
  ],
});

const requireString = (key: string, value: string | boolean): string => {
  if (typeof value !== "string") throw new PiError(`${key} requires a string value`);
  return value;
};

const requireBoolean = (key: string, value: string | boolean): boolean => {
  if (typeof value !== "boolean") throw new PiError(`${key} requires a boolean value`);
  return value;
};

const requireOption = <T extends string>(key: string, value: string, options: readonly T[]): T => {
  if (!options.includes(value as T)) throw new PiError(`${key} does not support value: ${value}`);
  return value as T;
};

const setSessionSetting = async (piSession: AgentSession, key: string, value: string | boolean): Promise<SessionControls> => {
  switch (key) {
    case "model": {
      const selected = requireString(key, value);
      const model = piSession.modelRegistry.getAvailable().find((candidate) => modelControlValue(candidate) === selected);
      if (!model) throw new PiError(`model not found: ${selected}`);
      await piSession.setModel(model);
      break;
    }
    case "thinkingLevel":
      piSession.setThinkingLevel(requireOption(key, requireString(key, value), piSession.getAvailableThinkingLevels()));
      break;
    case "steeringMode":
      piSession.setSteeringMode(requireOption(key, requireString(key, value), ["all", "one-at-a-time"]));
      break;
    case "followUpMode":
      piSession.setFollowUpMode(requireOption(key, requireString(key, value), ["all", "one-at-a-time"]));
      break;
    case "autoCompaction":
      piSession.setAutoCompactionEnabled(requireBoolean(key, value));
      break;
    case "autoRetry":
      piSession.setAutoRetryEnabled(requireBoolean(key, value));
      break;
    default:
      throw new PiError(`unknown setting: ${key}`);
  }
  return sessionSettings(piSession);
};

const flattenSessionTree = (piSession: AgentSession): SessionTree => {
  const roots = piSession.sessionManager.getTree();
  const currentId = piSession.sessionManager.getLeafId();
  const byId = new Map<string, { parentId: string | null }>();
  const currentPath = new Set<string>();
  const scan = (nodes: typeof roots) => {
    for (const node of nodes) {
      byId.set(node.entry.id, { parentId: node.entry.parentId });
      scan(node.children);
    }
  };
  scan(roots);
  for (let id = currentId; id;) {
    currentPath.add(id);
    id = byId.get(id)?.parentId ?? null;
  }

  const entries: TreeEntry[] = [];
  const visit = (nodes: typeof roots, depth: number) => {
    for (const node of nodes) {
      const entry: SessionEntry = node.entry;
      const role = entry.type === "message" ? entry.message.role : undefined;
      let text = "";
      if (entry.type === "message") text = "content" in entry.message ? textFromContent(entry.message.content) : "";
      else if (entry.type === "branch_summary" || entry.type === "compaction") text = entry.summary;
      else if (entry.type === "thinking_level_change") text = `thinking ${entry.thinkingLevel}`;
      else if (entry.type === "model_change") text = `${entry.provider}/${entry.modelId}`;
      entries.push({
        id: entry.id,
        parentId: entry.parentId,
        type: entry.type,
        ...(role ? { role } : {}),
        text: text.trim().slice(0, 500),
        timestamp: entry.timestamp,
        depth,
        current: entry.id === currentId,
        onCurrentPath: currentPath.has(entry.id),
        ...(node.label ? { label: node.label } : {}),
        childCount: node.children.length,
      });

      visit(node.children, node.children.length > 1 ? depth + 1 : depth);
    }
  };
  visit(roots, 0);
  return { currentId, entries };
};

const toolCallBase = (id: string) => ({
  kind: "tool_call" as const,
  id,
  at: Date.now(),
  status: "running" as const,
});

// A tool call is built when the call arrives, then updated in place once its
// result streams in, so the working copy in `byToolCallId` is mutable.
type Mutable<T> = T extends unknown ? { -readonly [K in keyof T]: T[K] } : never;

// Tool args are model-generated JSON — the SDK types them `any`, so this is
// the one boundary that turns them into a typed value. Decode against the
// builtin schema; if the model emitted a shape we don't model, degrade to a
// custom tool-call rather than throwing. (The bridge only forwards these for
// rendering — it never executes them — so a generic render is a fine fallback,
// and a throw here would fail the live turn and make the session unreplayable.)
const normalizeToolCall = (
  id: string,
  toolName: string,
  rawArgs: unknown,
): ToolCallMessage => {
  const base = toolCallBase(id);

  switch (toolName) {
    case "read": {
      const r = Schema.decodeUnknownOption(ReadToolArgs)(rawArgs);
      if (Option.isSome(r)) return { ...base, toolKind: "builtin", tool: "read", args: r.value };
      break;
    }
    case "write": {
      const r = Schema.decodeUnknownOption(WriteToolArgs)(rawArgs);
      if (Option.isSome(r)) return { ...base, toolKind: "builtin", tool: "write", args: r.value };
      break;
    }
    case "edit": {
      const r = Schema.decodeUnknownOption(EditToolArgs)(rawArgs);
      if (Option.isSome(r)) return { ...base, toolKind: "builtin", tool: "edit", args: r.value };
      break;
    }
    case "bash": {
      const r = Schema.decodeUnknownOption(BashToolArgs)(rawArgs);
      if (Option.isSome(r)) return { ...base, toolKind: "builtin", tool: "bash", args: r.value };
      break;
    }
  }

  const custom = Schema.decodeUnknownOption(CustomToolArgs)(rawArgs);
  return { ...base, toolKind: "custom", tool: toolName, args: Option.getOrElse(custom, (): CustomToolArgs => ({})) };
};

const assistantText = (content: PiAssistantMessage["content"]): string =>
  content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

const sessionStatsWithCwd = (stats: PiSdkSessionStats, cwd: string): SessionStats => ({
  ...(stats.sessionFile ? { sessionFile: stats.sessionFile } : {}),
  sessionId: stats.sessionId,
  cwd,
  userMessages: stats.userMessages,
  assistantMessages: stats.assistantMessages,
  toolCalls: stats.toolCalls,
  toolResults: stats.toolResults,
  totalMessages: stats.totalMessages,
  tokens: { ...stats.tokens },
  cost: stats.cost,
  ...(stats.contextUsage ? { contextUsage: stats.contextUsage } : {}),
});

const logEntriesFromCurrentBranch = (piSession: AgentSession): LogEntry[] => {
  const logEntries: LogEntry[] = [];
  const byToolCallId = new Map<string, Mutable<ToolCallMessage>>();

  for (const entry of piSession.sessionManager.getBranch()) {
    const at = new Date(entry.timestamp).getTime();

    if (entry.type === "compaction") {
      logEntries.push({
        kind: "compaction",
        id: entry.id,
        at,
        status: "success",
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
      });
      continue;
    }

    if (entry.type !== "message") continue;
    const message = entry.message;

    if (message.role === "user") {
      logEntries.push({
        kind: "user",
        id: entry.id,
        at,
        text: textFromContent(message.content),
      });
      continue;
    }

    if (message.role === "assistant") {
      logEntries.push({
        kind: "assistant",
        id: entry.id,
        at,
        text: assistantText(message.content),
        streaming: false,
        ...(message.stopReason ? { stopReason: message.stopReason } : {}),
        ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
        ...(message.usage ? { usage: message.usage } : {}),
      });

      for (const part of message.content) {
        if (part.type !== "toolCall") continue;
        const toolCall = normalizeToolCall(part.id, part.name, part.arguments);
        byToolCallId.set(part.id, toolCall);
        logEntries.push(toolCall);
      }
      continue;
    }

    if (message.role === "toolResult") {
      const toolCall = byToolCallId.get(message.toolCallId);
      if (!toolCall) continue;
      const resultContent = projectToolResultContent(message.content);
      toolCall.status = message.isError ? "error" : "ok";
      toolCall.result = textFromContent(message.content);
      if (resultContent) toolCall.resultContent = resultContent;
      if ("details" in message && message.details !== undefined) toolCall.details = message.details;
      toolCall.durationMs = 0;
    }
  }

  // A tool call without a result is only legitimate while a turn is executing.
  // When no turn is live (e.g. a session freshly resumed after the bridge was
  // killed mid-command), any lingering "running" tool is an orphan from the
  // dead process — mark it interrupted so the log doesn't replay a spinner
  // that never resolves. isStreaming spans the whole turn including tool
  // execution, so this never touches a genuinely in-flight tool.
  if (!piSession.isStreaming) {
    for (const toolCall of byToolCallId.values()) {
      if (toolCall.status !== "running") continue;
      toolCall.status = "error";
      toolCall.result = "Interrupted — the bridge restarted while this command was running.";
      toolCall.durationMs = 0;
    }
  }

  return logEntries;
};

const DELTA_COALESCE_MS = 75;

const wirePiSession = (
  piSession: AgentSession,
  meta: SessionMeta,
): Effect.Effect<PiSession> =>
  Effect.gen(function* () {
    const q = yield* Queue.unbounded<PiEmission>();

    // Coalesce per-token assistant deltas into ~75ms chunks so each chunk is
    // one persisted event and one WS frame instead of one per token. Every
    // other emission flushes the buffer first to preserve log order.
    let pendingDelta: { id: string; text: string } | null = null;
    let deltaTimer: ReturnType<typeof setTimeout> | null = null;

    const flushDelta = () => {
      if (deltaTimer) {
        clearTimeout(deltaTimer);
        deltaTimer = null;
      }
      if (!pendingDelta) return;
      const delta = pendingDelta;
      pendingDelta = null;
      Queue.unsafeOffer(q, { t: "assistant_delta", id: delta.id, text: delta.text });
    };

    const offer = (emission: PiEmission) => {
      if (emission.t === "assistant_delta") {
        if (pendingDelta?.id === emission.id) {
          pendingDelta.text += emission.text;
        } else {
          flushDelta();
          pendingDelta = { id: emission.id, text: emission.text };
        }
        deltaTimer ??= setTimeout(flushDelta, DELTA_COALESCE_MS).unref();
        return;
      }
      flushDelta();
      Queue.unsafeOffer(q, emission);
    };

    const extensionUi = createMobileExtensionUiChannel((request) => {
      offer({ t: "extension_ui_request", request });
    });

    let assistantId: string | null = null;
    let compactionId: string | null = null;
    const toolStarts = new Map<string, { startedAt: number }>();

    const emitProviderAuthMissing = (): boolean => {
      if (piSession.modelRegistry.getAvailable().length > 0) return false;
      offer({
        t: "assistant_end",
        id: randomUUIDv7(),
        stopReason: "error",
        errorMessage: "No model provider is signed in or configured yet.",
        errorCode: "provider_auth_missing",
      });
      offer({ t: "status", status: "error" });
      return true;
    };

    const mapEvent = (event: AgentSessionEvent): void => {
      switch (event.type) {
        case "message_update": {
          const inner = event.assistantMessageEvent;
          if (inner?.type !== "text_delta") return;
          const id = assistantId ?? randomUUIDv7();
          assistantId = id;
          offer({
            t: "assistant_delta",
            id,
            text: inner.delta,
          });
          return;
        }

        case "message_end": {
          const message = event.message;
          if (message.role !== "assistant") return;

          const id = assistantId ?? randomUUIDv7();
          if (!assistantId) {
            const text = assistantText(message.content);
            if (text.length > 0) offer({ t: "assistant_delta", id, text });
          }

          offer({
            t: "assistant_end",
            id,
            ...(message.stopReason ? { stopReason: message.stopReason } : {}),
            ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
            ...(message.usage ? { usage: message.usage } : {}),
          });
          assistantId = null;

          const stats = piSession.getSessionStats();
          offer({
            t: "cost",
            tokensIn: stats.tokens.input,
            tokensOut: stats.tokens.output,
            costUsd: stats.cost,
          });
          return;
        }

        case "tool_execution_start": {
          const id = event.toolCallId;
          toolStarts.set(id, { startedAt: Date.now() });

          offer({
            t: "tool_call",
            entry: normalizeToolCall(id, event.toolName, event.args),
          });
          return;
        }

        case "tool_execution_update": {
          const result = projectToolResult(event.partialResult);

          offer({
            t: "tool_update",
            id: event.toolCallId,
            result: result.text,
            ...(result.content ? { resultContent: result.content } : {}),
            ...(result.details !== undefined ? { details: result.details } : {}),
          });
          return;
        }

        case "tool_execution_end": {
          const start = toolStarts.get(event.toolCallId);
          toolStarts.delete(event.toolCallId);

          const result = projectToolResult(event.result);

          offer({
            t: "tool_result",
            id: event.toolCallId,
            result: result.text,
            ...(result.content ? { resultContent: result.content } : {}),
            ...(result.details !== undefined ? { details: result.details } : {}),
            status: event.isError ? "error" : "ok",
            durationMs: start ? Date.now() - start.startedAt : 0,
          });
          return;
        }

        case "queue_update":
          offer({
            t: "queue",
            steering: [...event.steering],
            followUp: [...event.followUp],
          });
          return;

        case "compaction_start": {
          const id = randomUUIDv7();
          compactionId = id;
          offer({
            t: "compaction",
            entry: {
              kind: "compaction",
              id,
              at: Date.now(),
              status: "running",
              reason: event.reason,
            },
          });
          return;
        }

        case "compaction_end": {
          const id = compactionId ?? randomUUIDv7();
          compactionId = null;
          offer({
            t: "compaction",
            entry: {
              kind: "compaction",
              id,
              at: Date.now(),
              status: event.aborted ? "aborted" : event.errorMessage ? "error" : "success",
              reason: event.reason,
              ...(event.result?.summary ? { summary: event.result.summary } : {}),
              ...(event.result?.tokensBefore !== undefined ? { tokensBefore: event.result.tokensBefore } : {}),
              ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
              ...(event.willRetry ? { willRetry: true } : {}),
            },
          });
          return;
        }

        case "turn_start":
          offer({ t: "status", status: "thinking" });
          return;

        case "turn_end":
          offer({ t: "status", status: "idle" });
          return;

        case "auto_retry_start":
          offer({
            t: "auto_retry_start",
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            delayMs: event.delayMs,
            errorMessage: event.errorMessage,
          });
          return;

        case "auto_retry_end":
          offer({
            t: "auto_retry_end",
            success: event.success,
            attempt: event.attempt,
            ...(event.finalError ? { finalError: event.finalError } : {}),
          });
          return;

        default:
          return;
      }
    };

    const unsub = piSession.subscribe(mapEvent);

    yield* Effect.tryPromise({
      try: () => piSession.bindExtensions({
        uiContext: extensionUi.uiContext,
        onError: (error) => {
          offer({
            t: "extension_ui_request",
            request: {
              kind: "notify",
              id: randomUUIDv7(),
              message: error instanceof Error ? error.message : String(error),
              level: "error",
            },
          });
        },
      }),
      catch: (e) => new PiError(`bindExtensions failed: ${String(e)}`, { cause: e }),
    }).pipe(Effect.catchAll((e) => Effect.logError("[pi] extension bind failed", e)));

    return {
      meta,
      events: Stream.fromQueue(q),
      send: (text, mode, images) =>
        Effect.gen(function* () {
          if (emitProviderAuthMissing()) return;
          yield* Queue.offer(q, { t: "status", status: "thinking" });

          const isStreaming = piSession.isStreaming;
          const piImages =
            images && images.length > 0
              ? images.map((i) => ({
                  type: "image" as const,
                  data: i.data,
                  mimeType: i.mimeType,
                }))
              : undefined;

          if (!isStreaming) {
            yield* Effect.forkDaemon(
              Effect.tryPromise({
                try: async () => {
                  await piSession.prompt(text, piImages ? { images: piImages } : undefined);
                },
                catch: (e) =>
                  new PiError(`prompt failed: ${String(e)}`, { cause: e }),
              }).pipe(
                Effect.tap(() =>
                  Queue.offer(q, { t: "status", status: "idle" }),
                ),
                Effect.tapError((e) =>
                  Effect.logError("[pi] prompt error", e),
                ),
              ),
            );
            return;
          }

          const useFollowUp = mode === "follow_up";
          yield* Effect.tryPromise({
            try: async () => {
              if (useFollowUp) {
                await piSession.followUp(text, piImages);
              } else {
                await piSession.steer(text, piImages);
              }
            },
            catch: (e) =>
              new PiError(
                `${useFollowUp ? "followUp" : "steer"} failed: ${String(e)}`,
                { cause: e },
              ),
          });
        }),
      isCompacting: () => Effect.sync(() => piSession.isCompacting),
      flushAfterCompaction: (messages, opts) =>
        Effect.tryPromise({
          try: async () => {
            if (messages.length === 0) return;

            const queueIntoTurn = async (message: QueuedSend) => {
              const images = message.images && message.images.length > 0
                ? message.images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType }))
                : undefined;
              if (message.mode === "follow_up") await piSession.followUp(message.text, images);
              else await piSession.steer(message.text, images);
            };

            if (opts?.willRetry) {
              for (const message of messages) await queueIntoTurn(message);
              return;
            }

            const [first, ...rest] = messages;
            if (!first) return;
            const firstImages = first.images && first.images.length > 0
              ? first.images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType }))
              : undefined;
            offer({ t: "status", status: "thinking" });
            const prompt = piSession.prompt(first.text, firstImages ? { images: firstImages } : undefined);
            for (const message of rest) await queueIntoTurn(message);
            void prompt.catch((error) => console.error("[pi] queued post-compaction prompt failed:", error));
          },
          catch: (e) => new PiError(`flushAfterCompaction failed: ${String(e)}`, { cause: e }),
        }),
      interrupt: () =>
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: () => piSession.abort(),
            catch: (e) => new PiError(`abort failed: ${String(e)}`, { cause: e }),
          });
          yield* Queue.offer(q, { t: "status", status: "idle" });
        }),
      extensionUiResponse: (id, value) =>
        Effect.sync(() => {
          extensionUi.respond(id, value);
        }),
      approve: (_id, _choice) =>
        Effect.sync(() => {
        }),
      compact: (instructions) =>
        Effect.tryPromise({
          try: async () => {
            await piSession.compact(instructions?.trim() || undefined);
          },
          catch: (e) => new PiError(`compact failed: ${String(e)}`, { cause: e }),
        }),
      exportHtml: () =>
        Effect.tryPromise({
          try: async () => {
            await mkdir(EXPORT_DIR, { recursive: true });
            await cleanupOldExports();

            const base = `pi-session-${safeFilenamePart(piSession.sessionId)}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
            const tmpPath = join(EXPORT_DIR, `${base}-${randomUUIDv7()}.html.tmp`);
            const finalName = `${base}.html`;
            const finalPath = join(EXPORT_DIR, finalName);

            try {
              const exportedPath = await piSession.exportToHtml(tmpPath);
              await rename(exportedPath, finalPath);
            } catch (e) {
              await rm(tmpPath, { force: true }).catch(() => undefined);
              await rm(finalPath, { force: true }).catch(() => undefined);
              throw e;
            }

            const info = await stat(finalPath).catch(() => undefined);
            return {
              stream: Readable.toWeb(createReadStream(finalPath)) as ReadableStream<Uint8Array>,
              filename: finalName,
              ...(info ? { size: info.size } : {}),
            };
          },
          catch: (e) => new PiError(`exportHtml failed: ${String(e)}`, { cause: e }),
        }),
      listCommands: () =>
        Effect.sync(() => ({
          builtins: [],
          prompts: piSession.resourceLoader.getPrompts().prompts.map((p) => ({
            kind: "prompt" as const,
            name: p.name,
            description: p.description,
            takesArgs: true,
            source: p.filePath,
          })),
          skills: piSession.resourceLoader.getSkills().skills.map((s) => ({
            kind: "skill" as const,
            name: `skill:${s.name}`,
            description: s.description,
            takesArgs: true,
            source: s.filePath,
          })),
        })),
      getQueue: () =>
        Effect.sync(() => ({
          steering: [...piSession.getSteeringMessages()],
          followUp: [...piSession.getFollowUpMessages()],
        })),
      clearQueue: () => Effect.sync(() => piSession.clearQueue()),
      getSettings: () => Effect.sync(() => sessionSettings(piSession)),
      patchSession: (patch) =>
        Effect.sync(() => {
          if (patch.title !== undefined) piSession.setSessionName(patch.title);
        }),
      patchSetting: (key, value) =>
        Effect.tryPromise({
          try: () => setSessionSetting(piSession, key, value),
          catch: (e) => e instanceof PiError ? e : new PiError(`patchSetting failed: ${String(e)}`, { cause: e }),
        }),
      getStats: () => Effect.sync(() => sessionStatsWithCwd(piSession.getSessionStats(), meta.cwd)),
      getLog: () => Effect.sync(() => logEntriesFromCurrentBranch(piSession)),
      getTree: () => Effect.sync(() => flattenSessionTree(piSession)),
      navigateTree: (entryId, summarize) =>
        Effect.tryPromise({
          try: async () => {
            await piSession.navigateTree(entryId, { summarize });
            offer({ t: "log_reset", entries: logEntriesFromCurrentBranch(piSession) });
          },
          catch: (e) => new PiError(`navigateTree failed: ${String(e)}`, { cause: e }),
        }),
      close: () =>
        Effect.sync(() => {
          flushDelta();
          extensionUi.close();
          unsub();
          piSession.dispose();
        }),
    };
  });

const makeLiveSession = (
  services: AgentSessionServices,
  opts: {
    cwd: string;
    title: string;
  },
): Effect.Effect<PiSession, PiError> =>
  Effect.gen(function* () {
    const piSession = yield* Effect.tryPromise<AgentSession, PiError>({
      try: async () => {
        const sessionManager =
          PI_EPHEMERAL
            ? PiSessionManager.inMemory(opts.cwd)
            : PiSessionManager.create(opts.cwd);

        const { session } = await createAgentSessionFromServices({
          services,
          sessionManager,
        });

        return session;
      },
      catch: (e) => new PiError(`createAgentSession failed: ${String(e)}`, { cause: e }),
    });

    const meta: SessionMeta = {
      id: piSession.sessionId,
      title: opts.title,
      cwd: opts.cwd,
      status: "idle",
      updatedAt: new Date().toISOString(),
      tokens: { in: 0, out: 0 },
      costUsd: 0,
      archived: false,
    };

    return yield* wirePiSession(piSession, meta);
  });

const makeResumedSession = (
  services: AgentSessionServices,
  storedRecord: import("./session-record.ts").SessionRecord,
): Effect.Effect<PiSession, PiError | SessionNotFound> =>
  Effect.gen(function* () {
    const piSession = yield* Effect.tryPromise<
      AgentSession,
      PiError | SessionNotFound
    >({
      try: async () => {
        const infos = await PiSessionManager.list(storedRecord.cwd);
        const found = infos.find((i) => i.id === storedRecord.id);
        if (!found) {
          throw new SessionNotFound(storedRecord.id);
        }

        const sessionManager = PiSessionManager.open(found.path);

        const { session } = await createAgentSessionFromServices({
          services,
          sessionManager,
        });

        return session;
      },
      catch: (e) => {
        if (e instanceof SessionNotFound) return e;
        return new PiError(`resume failed: ${String(e)}`, { cause: e });
      },
    });

    const meta: SessionMeta = {
      id: storedRecord.id,
      title: storedRecord.title,
      cwd: storedRecord.cwd,
      status: "idle",
      updatedAt: new Date().toISOString(),
      tokens: storedRecord.tokens,
      costUsd: storedRecord.costUsd,
      archived: storedRecord.archived,
    };

    return yield* wirePiSession(piSession, meta);
  });


const loadServices = (cwd: string) =>
  Effect.tryPromise({
    try: () => getAgentServices(cwd),
    catch: (e) => new PiError(`createAgentSessionServices failed: ${String(e)}`, { cause: e }),
  });

export const PiClientLive = Layer.succeed(PiClient, {
  create: (opts) =>
    Effect.flatMap(loadServices(opts.cwd), (services) =>
      makeLiveSession(services, opts),
    ),
  resume: (storedMeta) =>
    Effect.flatMap(loadServices(storedMeta.cwd), (services) =>
      makeResumedSession(services, storedMeta),
    ),
});

