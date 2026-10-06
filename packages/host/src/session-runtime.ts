import { Context, Data, Effect, Stream } from "effect";
import type {
  Commands,
  CompactionEntry,
  ExtensionUiRequest,
  ExtensionUiResponseValue,
  HostErrorCode,
  ImageContent,
  LogEntry,
  MessageUsage,
  SendMode,
  SessionCapability,
  SessionControls,
  SessionMeta,
  SessionStats,
  SessionStatus,
  SessionTree,
  ToolCallMessage,
  ToolResultContent,
  UserMessage,
} from "@pico/protocol";
import { SessionNotFound } from "./errors.ts";
import type { SessionRuntimeLifecycle } from "./session-lifecycle.ts";
import type { SessionRecord } from "./session-record.ts";

export type { SessionRuntimeLifecycle } from "./session-lifecycle.ts";

export type SessionEmission =
  | { t: "log_reset"; entries: readonly LogEntry[] }
  | { t: "user_message"; entry: UserMessage }
  | { t: "assistant_delta"; id: string; text: string }
  | {
      t: "assistant_end";
      id: string;
      at: number;
      text: string;
      stopReason?: "stop" | "length" | "toolUse" | "error" | "aborted";
      errorMessage?: string;
      errorCode?: HostErrorCode;
      usage?: MessageUsage;
    }
  | { t: "tool_call"; entry: ToolCallMessage }
  | {
      t: "tool_update";
      id: string;
      result: string;
      resultContent?: readonly ToolResultContent[];
      details?: unknown;
    }
  | {
      t: "tool_result";
      id: string;
      result: string;
      resultContent?: readonly ToolResultContent[];
      details?: unknown;
      status: "ok" | "error";
      durationMs: number;
    }
  | { t: "compaction"; entry: CompactionEntry }
  | { t: "status"; status: SessionStatus }
  | { t: "queue"; steering: readonly string[]; followUp: readonly string[] }
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

export class PiError extends Data.TaggedError("PiError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ExportedHtml {
  readonly stream: Stream.Stream<Uint8Array>;
  readonly size?: number;
  readonly filename?: string;
}

export interface QueuedSend {
  readonly text: string;
  readonly mode: SendMode;
  readonly images?: ImageContent[];
}

export interface RuntimeQueueState {
  readonly steering: readonly string[];
  readonly followUp: readonly string[];
}

export type RuntimeSessionMeta = Omit<SessionMeta, "capabilities">;

interface SessionRuntimeBase {
  readonly lifecycle: SessionRuntimeLifecycle;
  readonly acceptsImages: boolean;
  readonly meta: RuntimeSessionMeta;
  readonly events: Stream.Stream<SessionEmission, PiError>;
  readonly send: (
    text: string,
    mode: SendMode,
    images?: ImageContent[],
    clientId?: string,
  ) => Effect.Effect<void, PiError>;
  readonly isCompacting?: () => Effect.Effect<boolean, PiError>;
  readonly flushAfterCompaction?: (
    messages: readonly QueuedSend[],
    opts?: { willRetry?: boolean },
  ) => Effect.Effect<void, PiError>;
  readonly interrupt?: () => Effect.Effect<void, PiError>;
  readonly requestBackground?: () => Effect.Effect<void, PiError>;
  readonly extensionUiResponse?: (
    id: string,
    value: ExtensionUiResponseValue,
  ) => Effect.Effect<void, PiError>;
  readonly compact?: (instructions?: string) => Effect.Effect<void, PiError>;
  readonly exportHtml?: () => Effect.Effect<ExportedHtml, PiError>;
  readonly listCommands?: () => Effect.Effect<Commands, PiError>;
  readonly getQueue?: () => Effect.Effect<RuntimeQueueState, PiError>;
  readonly clearQueue?: () => Effect.Effect<RuntimeQueueState, PiError>;
  readonly getSettings?: () => Effect.Effect<SessionControls, PiError>;
  readonly patchSession?: (patch: { title?: string }) => Effect.Effect<void, PiError>;
  readonly patchSetting?: (key: string, value: string | boolean) => Effect.Effect<SessionControls, PiError>;
  readonly getStats?: () => Effect.Effect<SessionStats, PiError>;
  readonly getLog?: () => Effect.Effect<LogEntry[], PiError>;
  readonly getTree?: () => Effect.Effect<SessionTree, PiError>;
  readonly navigateTree?: (entryId: string, summarize?: boolean) => Effect.Effect<void, PiError>;
  readonly close: () => Effect.Effect<void>;
}

type DurableOperation =
  | "isCompacting"
  | "flushAfterCompaction"
  | "interrupt"
  | "extensionUiResponse"
  | "compact"
  | "exportHtml"
  | "listCommands"
  | "getQueue"
  | "clearQueue"
  | "getSettings"
  | "patchSession"
  | "patchSetting"
  | "getStats"
  | "getLog"
  | "getTree"
  | "navigateTree";

// Durable runtimes back persisted Pico sessions. Dormant records intentionally
// omit capabilities for backward compatibility, so this variant guarantees the
// complete operation set that an omitted capability list means on the wire.
export type DurableSessionRuntime = SessionRuntimeBase &
  Required<Pick<SessionRuntimeBase, DurableOperation>> & {
    readonly lifecycle: { readonly kind: "durable" };
    readonly acceptsImages: true;
  };

// Presence runtimes must be able to seed Pico's event journal when they attach.
// Encoding that requirement here keeps attach handling total after the boundary parse.
export type PresenceSessionRuntime = SessionRuntimeBase & {
  readonly lifecycle: { readonly kind: "presence" };
  readonly getLog: () => Effect.Effect<LogEntry[], PiError>;
};

export type SessionRuntime = DurableSessionRuntime | PresenceSessionRuntime;

export class DurableRuntimeFactory extends Context.Tag("DurableRuntimeFactory")<
  DurableRuntimeFactory,
  {
    readonly create: (opts: {
      cwd: string;
      title: string;
    }) => Effect.Effect<DurableSessionRuntime, PiError>;
    readonly resume: (
      storedRecord: SessionRecord,
    ) => Effect.Effect<DurableSessionRuntime, PiError | SessionNotFound>;
  }
>() {}

// Runtime operations are the source of truth. The public capability list is a
// projection for clients, never independently authored adapter metadata.
export function capabilitiesForRuntime(runtime: SessionRuntime): readonly SessionCapability[] {
  const capabilities: SessionCapability[] = [];
  if (runtime.lifecycle.kind === "durable") capabilities.push("archive");
  if (runtime.patchSession) capabilities.push("rename");
  if (runtime.acceptsImages) capabilities.push("images");
  if (runtime.interrupt) capabilities.push("interrupt");
  if (runtime.getSettings && runtime.patchSetting) capabilities.push("settings");
  if (runtime.getStats) capabilities.push("stats");
  if (runtime.compact) capabilities.push("compact");
  if (runtime.getQueue && runtime.clearQueue && runtime.flushAfterCompaction) capabilities.push("queue");
  if (runtime.listCommands) capabilities.push("commands");
  if (runtime.getTree && runtime.navigateTree) capabilities.push("tree");
  if (runtime.exportHtml) capabilities.push("export");
  if (runtime.extensionUiResponse) capabilities.push("extension-ui");
  return capabilities;
}
