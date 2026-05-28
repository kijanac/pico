/**
 * pi.dev integration boundary.
 *
 * Live implementation of the `PiClient` Tag backed by the real
 * @earendil-works/pi-coding-agent SDK.
 *
 * The real SDK shape (mid-2026):
 *
 *   const { session } = await createAgentSession({
 *     sessionManager: PiSessionManager.inMemory(),
 *     authStorage,
 *     modelRegistry,
 *   });
 *   session.subscribe((event) => { … });
 *   await session.prompt(text);
 *
 * Permission handling is not in this v0. Pi's permission flow is an
 * extension surface, not a core event — we'll wire that up in a follow-up
 * by registering a small extension that bridges pi's permission asks into
 * our wire protocol.
 */
import {
  Context,
  Effect,
  Layer,
  Stream,
  Queue,
} from "effect";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager as PiSessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type BashToolInput,
  type EditToolInput,
  type ReadToolInput,
  type WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import * as v from "valibot";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  BashToolArgs,
  CustomToolArgs,
  type AuthLoginJob,
  type AuthProvider,
  type Commands,
  EditToolArgs,
  ReadToolArgs,
  WriteToolArgs,
  type PermissionChoice,
  type ModelSummary,
  type PermissionRequest,
  type QueueMode,
  type QueueState,
  type SessionMeta,
  type SessionSettings,
  type SessionSettingsPatch,
  type SessionStats,
  type SessionStatus,
  type SessionTree,
  type ThinkingLevel,
  type ToolCallMessage,
  type TreeEntry,
} from "@pi-mobile/protocol";
import { SessionNotFound } from "./errors.ts";
import { setupFauxIfEnabled } from "./pi-faux.ts";

/* ── public types ────────────────────────────────────────────────────── */

export type PiEmission =
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
    }
  | { t: "tool_call"; entry: ToolCallMessage }
  | {
      t: "tool_result";
      id: string;
      result: string;
      status: "ok" | "error";
      durationMs: number;
    }
  | { t: "permission"; entry: PermissionRequest }
  | { t: "status"; status: SessionStatus }
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
    };

export class PiError extends Error {
  readonly _tag = "PiError";
}

export type SendMode = "steer" | "follow_up";

/** Inline image attached to a send. Matches pi-ai's ImageContent shape. */
export interface SendImage {
  data: string;
  mimeType: string;
}

export interface ExportedHtml {
  readonly stream: ReadableStream<Uint8Array>;
  readonly size?: number;
}

export interface PiSession {
  readonly meta: SessionMeta;
  readonly events: Stream.Stream<PiEmission, PiError>;
  readonly send: (
    text: string,
    mode?: SendMode,
    images?: SendImage[],
  ) => Effect.Effect<void, PiError>;
  readonly interrupt: () => Effect.Effect<void, PiError>;
  readonly approve: (
    id: string,
    choice: PermissionChoice,
  ) => Effect.Effect<void, PiError>;
  readonly listModels: () => Effect.Effect<{ current?: ModelSummary; models: ModelSummary[] }, PiError>;
  readonly setModel: (provider: string, modelId: string) => Effect.Effect<void, PiError>;
  readonly compact: (instructions?: string) => Effect.Effect<void, PiError>;
  readonly exportHtml: () => Effect.Effect<ExportedHtml, PiError>;
  readonly listCommands: () => Effect.Effect<Commands, PiError>;
  readonly getQueue: () => Effect.Effect<QueueState, PiError>;
  readonly clearQueue: () => Effect.Effect<QueueState, PiError>;
  readonly listAuthProviders: () => Effect.Effect<{ providers: AuthProvider[] }, PiError>;
  readonly startAuthLogin: (providerId: string) => Effect.Effect<AuthLoginJob, PiError>;
  readonly getAuthLogin: (jobId: string) => Effect.Effect<AuthLoginJob, PiError>;
  readonly submitAuthLoginInput: (jobId: string, value: string) => Effect.Effect<AuthLoginJob, PiError>;
  readonly cancelAuthLogin: (jobId: string) => Effect.Effect<void, PiError>;
  readonly getSettings: () => Effect.Effect<SessionSettings, PiError>;
  readonly patchSession: (patch: { title?: string }) => Effect.Effect<void, PiError>;
  readonly patchSettings: (patch: SessionSettingsPatch) => Effect.Effect<SessionSettings, PiError>;
  readonly getStats: () => Effect.Effect<SessionStats, PiError>;
  readonly getTree: () => Effect.Effect<SessionTree, PiError>;
  readonly navigateTree: (entryId: string, summarize?: boolean) => Effect.Effect<void, PiError>;
  readonly close: () => Effect.Effect<void>;
}

export class PiClient extends Context.Tag("PiClient")<
  PiClient,
  {
    readonly create: (opts: {
      cwd: string;
      title?: string;
      branch?: string;
    }) => Effect.Effect<PiSession, PiError>;
    /** Reattach to an existing session by stored meta. Used by
     *  session.ts when a request arrives for an id that's in the
     *  store but not in the live HashMap (e.g., after a bridge
     *  restart). Returns SessionNotFound if pi's on-disk file is
     *  missing. */
    readonly resume: (
      storedMeta: SessionMeta,
    ) => Effect.Effect<PiSession, PiError | SessionNotFound>;
  }
>() {}

/* ── shared helpers ─────────────────────────────────────────────────── */

const nextId = (() => {
  let n = 0;
  return (prefix: string) =>
    `${prefix}_${++n}_${Math.random().toString(36).slice(2, 6)}`;
})();

const textFromContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text?: unknown }).text ?? "");
      }
      if (part && typeof part === "object" && "type" in part) {
        return `[${String((part as { type?: unknown }).type)}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
};

const sessionSettings = (piSession: AgentSession): SessionSettings => ({
  thinkingLevel: piSession.thinkingLevel as ThinkingLevel,
  availableThinkingLevels: piSession.getAvailableThinkingLevels() as ThinkingLevel[],
  steeringMode: piSession.steeringMode as QueueMode,
  followUpMode: piSession.followUpMode as QueueMode,
  autoCompaction: piSession.autoCompactionEnabled,
  autoRetry: piSession.autoRetryEnabled,
});

interface AuthJobState {
  job: AuthLoginJob;
  abort: AbortController;
  resolveInput?: (value: string) => void;
}

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
      const entry = node.entry as { id: string; parentId: string | null; type: string; timestamp: string; message?: { role?: string; content?: unknown }; summary?: string; thinkingLevel?: string; provider?: string; modelId?: string };
      const role = entry.message?.role;
      let text = "";
      if (entry.type === "message") text = textFromContent(entry.message?.content);
      else if (entry.type === "branch_summary" || entry.type === "compaction") text = entry.summary ?? "";
      else if (entry.type === "thinking_level_change") text = `thinking ${entry.thinkingLevel ?? ""}`;
      else if (entry.type === "model_change") text = `${entry.provider ?? ""}/${entry.modelId ?? ""}`;
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
      visit(node.children, depth + 1);
    }
  };
  visit(roots, 0);
  return { currentId, entries };
};

/**
 * Usage shape on AssistantMessage from `@earendil-works/pi-ai`.
 * We type it locally to avoid pulling pi-ai's types just for this. Pi's
 * own types are richer (totalTokens, cacheRead/Write etc.) but we only
 * need three fields here.
 */
interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { total?: number };
}

const toolCallBase = (id: string) => ({
  kind: "tool_call" as const,
  id,
  at: Date.now(),
  status: "running" as const,
});

/**
 * Pi's public event type exposes `args: any`, even though its built-in tool
 * definitions have typed TypeBox inputs. Normalize that loose SDK boundary into
 * our Valibot-validated wire protocol before storing or sending to mobile.
 */
const normalizeToolCall = (
  id: string,
  toolName: string,
  rawArgs: unknown,
): ToolCallMessage => {
  const base = toolCallBase(id);

  switch (toolName) {
    case "read": {
      const args: ReadToolInput = v.parse(ReadToolArgs, rawArgs);
      return { ...base, toolKind: "builtin", tool: "read", args };
    }
    case "write": {
      const args: WriteToolInput = v.parse(WriteToolArgs, rawArgs);
      return { ...base, toolKind: "builtin", tool: "write", args };
    }
    case "edit": {
      const raw = v.parse(CustomToolArgs, rawArgs);
      const legacyEdits =
        typeof raw.oldText === "string" || typeof raw.newText === "string"
          ? [{ oldText: raw.oldText ?? "", newText: raw.newText ?? "" }]
          : undefined;
      const args: EditToolInput = v.parse(EditToolArgs, {
        ...raw,
        edits: raw.edits ?? legacyEdits,
      });
      return { ...base, toolKind: "builtin", tool: "edit", args };
    }
    case "bash": {
      const raw = v.parse(CustomToolArgs, rawArgs);
      const args: BashToolInput = v.parse(BashToolArgs, {
        ...raw,
        command: raw.command ?? raw.cmd,
      });
      return { ...base, toolKind: "builtin", tool: "bash", args };
    }
    default:
      return {
        ...base,
        toolKind: "custom",
        tool: toolName,
        args: v.parse(CustomToolArgs, rawArgs),
      };
  }
};

/* ──────────────────────────────────────────────────────────────────────
   LIVE — wraps the real pi AgentSession.

   Pi 0.73's event subscriber callback is synchronous: we use plain
   closure state and Queue.unsafeOffer rather than awaiting per-event
   Effect runtimes. See the `mapEvent` switch below for the exact event
   shapes (typed from @earendil-works/pi-coding-agent imports).
   ────────────────────────────────────────────────────────────────────── */

/**
 * Given a live pi AgentSession and a session meta, build the full
 * PiSession surface: queue, event subscriber, send/interrupt/approve
 * methods, and dispose hook. Shared by both new-session creation and
 * resume — the upstream difference is only in how the AgentSession
 * itself is constructed.
 */
const wirePiSession = (
  piSession: AgentSession,
  meta: SessionMeta,
): Effect.Effect<PiSession> =>
  Effect.gen(function* () {
    const q = yield* Queue.unbounded<PiEmission>();

    /* ── event subscriber state ─────────────────────────────────────
       The subscriber callback runs synchronously from pi's event loop.
       We use plain closure variables (not Effect Refs) and push into
       the queue via Queue.unsafeOffer — both are appropriate for the
       non-Effect callback context and avoid spinning up a fresh runtime
       per event. */
    let assistantId: string | null = null;
    const toolStarts = new Map<string, { startedAt: number }>();

    /**
     * Map a pi event to PiEmission(s) and push into our queue.
     *
     * Pi 0.73.1 event types we observe today:
     *   message_update (with assistantMessageEvent text_delta) → assistant_delta
     *   message_end                                            → assistant_end + (if assistant) cost
     *   tool_execution_start                                   → tool_call
     *   tool_execution_end                                     → tool_result
     *   turn_start                                             → status thinking
     *   turn_end                                               → status idle
     *   auto_retry_start / auto_retry_end                      → same-named wire events
     *
     * Unmapped lifecycle events (intentionally silent):
     *   agent_start, agent_end, message_start, tool_execution_update,
     *   queue_update, compaction_start/end, session_info_changed,
     *   thinking_level_changed, model_select
     */
    const mapEvent = (event: AgentSessionEvent): void => {
      switch (event.type) {
        case "message_update": {
          const inner = event.assistantMessageEvent;
          if (inner?.type !== "text_delta") return;
          if (!assistantId) assistantId = nextId("m");
          Queue.unsafeOffer(q, {
            t: "assistant_delta",
            id: assistantId,
            text: inner.delta,
          });
          return;
        }

        case "message_end": {
          // Pi's AgentMessage union covers user/assistant/toolResult/custom.
          // Only assistants carry stopReason and usage; the rest are
          // bookkeeping echoes (user/tool-result messages we already
          // surfaced via their own events).
          const msg = event.message as {
            role?: string;
            stopReason?:
              | "stop"
              | "length"
              | "toolUse"
              | "error"
              | "aborted";
            errorMessage?: string;
            usage?: PiUsage;
          };

          if (msg.role !== "assistant") return;

          // Two shapes arrive here:
          //   (a) Normal turn: we saw text_delta events first and
          //       `assistantId` is set; emit assistant_end with the
          //       stopReason and clear the id.
          //   (b) Zero-delta turn: pi failed before any tokens streamed
          //       (auth, network, etc.) — assistantId is null but the
          //       message carries stopReason "error" with an
          //       errorMessage. Mint a fresh id so the mobile has a
          //       handle to render the failed turn against; the
          //       single assistant_end carries the error fields.
          let id = assistantId;
          if (!id) {
            // Don't manufacture an empty-bubble entry for completely
            // benign cases — only emit for failure modes. Pi shouldn't
            // ever produce a stopReason=stop with no text, but if it
            // does we still want to acknowledge the turn closed so
            // status state machines don't get stuck.
            id = nextId("m");
          }
          Queue.unsafeOffer(q, {
            t: "assistant_end",
            id,
            ...(msg.stopReason ? { stopReason: msg.stopReason } : {}),
            ...(msg.errorMessage ? { errorMessage: msg.errorMessage } : {}),
            ...(msg.usage
              ? {
                  usage: {
                    input: msg.usage.input ?? 0,
                    output: msg.usage.output ?? 0,
                    cacheRead: msg.usage.cacheRead ?? 0,
                    cacheWrite: msg.usage.cacheWrite ?? 0,
                    total:
                      msg.usage.totalTokens ??
                      (msg.usage.input ?? 0) +
                        (msg.usage.output ?? 0) +
                        (msg.usage.cacheRead ?? 0) +
                        (msg.usage.cacheWrite ?? 0),
                    cost: msg.usage.cost?.total ?? 0,
                  },
                }
              : {}),
          });
          assistantId = null;

          const stats = piSession.getSessionStats();
          Queue.unsafeOffer(q, {
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

          Queue.unsafeOffer(q, {
            t: "tool_call",
            entry: normalizeToolCall(id, event.toolName, event.args),
          });
          return;
        }

        case "tool_execution_end": {
          const start = toolStarts.get(event.toolCallId);
          toolStarts.delete(event.toolCallId);

          // Pi/tool adapters may return either a plain model-visible string
          // or an OpenAI-style content envelope:
          //   { content: [{ type: "text", text: "..." }] }
          // The mobile UI should render the text, not the transport JSON.
          const resultText =
            typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result ?? "");

          Queue.unsafeOffer(q, {
            t: "tool_result",
            id: event.toolCallId,
            result: resultText,
            status: event.isError ? "error" : "ok",
            durationMs: start ? Date.now() - start.startedAt : 0,
          });
          return;
        }

        case "turn_start":
          Queue.unsafeOffer(q, { t: "status", status: "thinking" });
          return;

        case "turn_end":
          Queue.unsafeOffer(q, { t: "status", status: "idle" });
          return;

        case "auto_retry_start":
          // Pi retries certain provider failures (rate limits, transient
          // network errors). We pass these through so the mobile can show
          // a transient "retrying N of M" indicator — the user otherwise
          // sees an unexplained pause between the failure and recovery.
          Queue.unsafeOffer(q, {
            t: "auto_retry_start",
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            delayMs: event.delayMs,
            errorMessage: event.errorMessage,
          });
          return;

        case "auto_retry_end":
          Queue.unsafeOffer(q, {
            t: "auto_retry_end",
            success: event.success,
            attempt: event.attempt,
            ...(event.finalError ? { finalError: event.finalError } : {}),
          });
          return;

        default:
          // Lifecycle events we don't surface (see comment above). If we
          // encounter a brand-new event type in a future pi release the
          // switch silently no-ops, which is the right default.
          return;
      }
    };

    // Wire pi → our queue. The subscribe callback is synchronous now,
    // so no catch needed — mapEvent doesn't throw.
    const unsub = piSession.subscribe(mapEvent);
    const authJobs = new Map<string, AuthJobState>();

    return {
      meta,
      events: Stream.fromQueue(q),
      send: (text, mode, images) =>
        Effect.gen(function* () {
          yield* Queue.offer(q, { t: "status", status: "thinking" });

          // Pi exposes three direct methods:
          //   - prompt(text, { images })     — fresh turn (only when not streaming)
          //   - steer(text, images)          — queue during streaming, deliver after
          //                                    current turn's tool calls finish
          //   - followUp(text, images)       — queue during streaming, deliver after
          //                                    the agent settles
          // We dispatch by state and the caller's mode. Pi's three call
          // signatures differ slightly (prompt takes options object,
          // steer/followUp take images positionally).
          const isStreaming = piSession.isStreaming;
          // Pi's ImageContent has a `type: "image"` discriminator; our
          // wire shape doesn't carry it (it's redundant — the array is
          // already known to be images), so we tack it on here.
          const piImages =
            images && images.length > 0
              ? images.map((i) => ({
                  type: "image" as const,
                  data: i.data,
                  mimeType: i.mimeType,
                }))
              : undefined;

          if (!isStreaming) {
            // Fork the prompt — pi resolves when the response is fully
            // drained; we don't want to block our caller on that.
            yield* Effect.forkDaemon(
              Effect.tryPromise({
                try: async () => {
                  await piSession.prompt(text, piImages ? { images: piImages } : undefined);
                },
                catch: (e) =>
                  new PiError(`prompt failed: ${String(e)}`),
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

          // Streaming — queue via the mode-appropriate method.
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
              ),
          });
        }),
      interrupt: () =>
        Effect.gen(function* () {
          // Pi's abort() cancels the in-flight LLM request and tool calls,
          // cascading through pi-ai's stream. Returns when the abort has
          // settled.
          yield* Effect.tryPromise({
            try: () => piSession.abort(),
            catch: (e) => new PiError(`abort failed: ${String(e)}`),
          });
          yield* Queue.offer(q, { t: "status", status: "idle" });
        }),
      approve: (_id, _choice) =>
        Effect.sync(() => {
          // No-op for v0. The permission extension will wire this up.
        }),
      listModels: () =>
        Effect.sync(() => {
          const current = piSession.model;
          const models = piSession.modelRegistry.getAvailable().map((m) => ({
            provider: m.provider,
            id: m.id,
            name: m.name,
            reasoning: m.reasoning,
            input: [...m.input],
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
            current: current?.provider === m.provider && current?.id === m.id,
            usingOAuth: piSession.modelRegistry.isUsingOAuth(m),
          }));
          return {
            current: models.find((m) => m.current),
            models,
          };
        }),
      setModel: (provider, modelId) =>
        Effect.tryPromise({
          try: async () => {
            const model = piSession.modelRegistry.find(provider, modelId);
            if (!model) throw new Error(`model not found: ${provider}/${modelId}`);
            await piSession.setModel(model);
          },
          catch: (e) => new PiError(`setModel failed: ${String(e)}`),
        }),
      compact: (instructions) =>
        Effect.tryPromise({
          try: async () => {
            await piSession.compact(instructions?.trim() || undefined);
          },
          catch: (e) => new PiError(`compact failed: ${String(e)}`),
        }),
      exportHtml: () =>
        Effect.tryPromise({
          try: async () => {
            const path = await piSession.exportToHtml();
            const info = await stat(path).catch(() => undefined);
            return {
              stream: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>,
              ...(info ? { size: info.size } : {}),
            };
          },
          catch: (e) => new PiError(`exportHtml failed: ${String(e)}`),
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
      listAuthProviders: () =>
        Effect.sync(() => ({
          providers: piSession.modelRegistry.authStorage.getOAuthProviders().map((p) => {
            const status = piSession.modelRegistry.authStorage.getAuthStatus(p.id);
            return {
              id: p.id,
              name: p.name,
              configured: status.configured,
              ...(status.source ? { source: status.source } : {}),
              ...(status.label ? { label: status.label } : {}),
            };
          }),
        })),
      startAuthLogin: (providerId) =>
        Effect.sync(() => {
          const provider = piSession.modelRegistry.authStorage.getOAuthProviders().find((p) => p.id === providerId);
          if (!provider) throw new PiError(`auth provider not found: ${providerId}`);
          const id = nextId("auth");
          const abort = new AbortController();
          const state: AuthJobState = {
            abort,
            job: { id, providerId, providerName: provider.name, status: "starting" },
          };
          authJobs.set(id, state);
          void piSession.modelRegistry.authStorage.login(providerId, {
            signal: abort.signal,
            onAuth: (info) => {
              state.job = { ...state.job, status: "auth", authUrl: info.url, instructions: info.instructions };
            },
            onDeviceCode: (info) => {
              state.job = { ...state.job, status: "device", userCode: info.userCode, verificationUri: info.verificationUri };
            },
            onProgress: (progress) => {
              state.job = { ...state.job, status: "progress", progress };
            },
            onSelect: async () => providerId,
            onPrompt: async (prompt) => {
              state.job = { ...state.job, status: "prompt", promptMessage: prompt.message, promptPlaceholder: prompt.placeholder };
              return await new Promise<string>((resolve) => { state.resolveInput = resolve; });
            },
            onManualCodeInput: async () => {
              state.job = { ...state.job, status: "manual", promptMessage: "Paste the authorization code or final redirect URL" };
              return await new Promise<string>((resolve) => { state.resolveInput = resolve; });
            },
          }).then(() => {
            state.job = { ...state.job, status: "success" };
          }).catch((e) => {
            state.job = { ...state.job, status: abort.signal.aborted ? "cancelled" : "failed", error: String(e) };
          });
          return state.job;
        }),
      getAuthLogin: (jobId) =>
        Effect.sync(() => {
          const state = authJobs.get(jobId);
          if (!state) throw new PiError(`auth job not found: ${jobId}`);
          return state.job;
        }),
      submitAuthLoginInput: (jobId, value) =>
        Effect.sync(() => {
          const state = authJobs.get(jobId);
          if (!state) throw new PiError(`auth job not found: ${jobId}`);
          state.resolveInput?.(value);
          state.resolveInput = undefined;
          state.job = { ...state.job, status: "progress", progress: "Submitted authentication input…" };
          return state.job;
        }),
      cancelAuthLogin: (jobId) =>
        Effect.sync(() => {
          const state = authJobs.get(jobId);
          if (!state) throw new PiError(`auth job not found: ${jobId}`);
          state.abort.abort();
          state.resolveInput?.("");
          state.job = { ...state.job, status: "cancelled" };
        }),
      getSettings: () => Effect.sync(() => sessionSettings(piSession)),
      patchSession: (patch) =>
        Effect.sync(() => {
          if (patch.title !== undefined) piSession.setSessionName(patch.title);
        }),
      patchSettings: (patch) =>
        Effect.sync(() => {
          if (patch.thinkingLevel) piSession.setThinkingLevel(patch.thinkingLevel);
          if (patch.steeringMode) piSession.setSteeringMode(patch.steeringMode);
          if (patch.followUpMode) piSession.setFollowUpMode(patch.followUpMode);
          if (patch.autoCompaction !== undefined) piSession.setAutoCompactionEnabled(patch.autoCompaction);
          if (patch.autoRetry !== undefined) piSession.setAutoRetryEnabled(patch.autoRetry);
          return sessionSettings(piSession);
        }),
      getStats: () => Effect.sync(() => piSession.getSessionStats() as SessionStats),
      getTree: () => Effect.sync(() => flattenSessionTree(piSession)),
      navigateTree: (entryId, summarize) =>
        Effect.tryPromise({
          try: async () => {
            await piSession.navigateTree(entryId, { summarize });
          },
          catch: (e) => new PiError(`navigateTree failed: ${String(e)}`),
        }),
      close: () =>
        Effect.sync(() => {
          unsub();
          piSession.dispose();
        }),
    };
  });

/**
 * Create a brand-new pi AgentSession + wire it into a PiSession.
 *
 * Honors $PI_FAUX (shakedown provider) and $PI_EPHEMERAL (in-memory
 * session storage, no disk persistence). Disk-persisted by default so
 * a bridge restart can reattach to running conversations.
 */
const makeLiveSession = (opts: {
  cwd: string;
  title?: string;
  branch?: string;
}): Effect.Effect<PiSession, PiError> =>
  Effect.gen(function* () {
    const piSession = yield* Effect.tryPromise<AgentSession, PiError>({
      try: async () => {
        const authStorage = AuthStorage.create();
        const modelRegistry = ModelRegistry.create(authStorage);

        const fauxModel = setupFauxIfEnabled(authStorage);

        const sessionManager =
          process.env.PI_EPHEMERAL === "1"
            ? PiSessionManager.inMemory()
            : PiSessionManager.create(opts.cwd);

        const { session } = await createAgentSession({
          sessionManager,
          authStorage,
          modelRegistry,
          cwd: opts.cwd,
        });

        // Pin the faux model when applicable. Real-provider sessions
        // pick up the active model from settings/auth automatically.
        if (fauxModel) {
          await session.setModel(fauxModel);
        }

        return session;
      },
      catch: (e) => new PiError(`createAgentSession failed: ${String(e)}`),
    });

    const meta: SessionMeta = {
      id: piSession.sessionId,
      title: opts.title ?? "untitled session",
      cwd: opts.cwd,
      branch: opts.branch,
      status: "idle",
      updatedAt: Date.now(),
      tokens: { in: 0, out: 0 },
      costUsd: 0,
    };

    return yield* wirePiSession(piSession, meta);
  });

/**
 * Reattach to an existing pi AgentSession by id. The session file
 * lives on disk under `~/.pi/agent/sessions/<encoded-cwd>/...` from
 * a previous bridge run. Pi's `SessionManager.list` enumerates them;
 * we match by id (the same id our bridge store has), then `open` the
 * file and hand it to `createAgentSession`.
 *
 * Pi's event subscriber only fires for future activity — historical
 * messages aren't replayed as events. Our bridge events table already
 * has the prior log, so the WS replay layer covers reconnects. New
 * sends extend both.
 *
 * Returns SessionNotFound when the on-disk file is missing — usually
 * means it was deleted out from under us, or `$PI_EPHEMERAL=1` was
 * set during the original run (the file never existed). The store
 * caller decides how to surface that (typically: also delete the
 * stale store row).
 */
const makeResumedSession = (
  storedMeta: SessionMeta,
): Effect.Effect<PiSession, PiError | SessionNotFound> =>
  Effect.gen(function* () {
    const piSession = yield* Effect.tryPromise<
      AgentSession,
      PiError | SessionNotFound
    >({
      try: async () => {
        // Find the .jsonl file pi wrote for this session. `list(cwd)`
        // returns SessionInfo[] with absolute paths; we match on
        // `info.id === storedMeta.id`. The list call does a single
        // pass over the cwd's session directory — for a personal-use
        // bridge with tens of sessions per cwd this is sub-millisecond.
        const infos = await PiSessionManager.list(storedMeta.cwd);
        const found = infos.find((i) => i.id === storedMeta.id);
        if (!found) {
          throw new SessionNotFound(storedMeta.id);
        }

        const authStorage = AuthStorage.create();
        const modelRegistry = ModelRegistry.create(authStorage);

        // Resumed sessions must re-register the faux provider if the
        // original session used it; pi's resume pipeline looks up the
        // model by id from its registry. If $PI_FAUX isn't set on the
        // resumed bridge but the original session used faux, model
        // resolution will fail and the next prompt will surface that
        // via stopReason:"error" (which mobile renders correctly).
        const fauxModel = setupFauxIfEnabled(authStorage);

        const sessionManager = PiSessionManager.open(found.path);

        const { session } = await createAgentSession({
          sessionManager,
          authStorage,
          modelRegistry,
          cwd: storedMeta.cwd,
        });

        if (fauxModel) {
          await session.setModel(fauxModel);
        }

        return session;
      },
      catch: (e) => {
        if (e instanceof SessionNotFound) return e;
        return new PiError(`resume failed: ${String(e)}`);
      },
    });

    // Use the stored meta as-is: it has the user's last-known title,
    // tokens, cost, archived state, etc. Status starts at "idle" — a
    // resumed session is never mid-turn (pi's pump only resumes from
    // a settled state).
    const meta: SessionMeta = {
      ...storedMeta,
      status: "idle",
      updatedAt: Date.now(),
    };

    return yield* wirePiSession(piSession, meta);
  });

/* ── Pi service tag, extended with `resume` ───────────────────────── */

export const PiClientLive = Layer.succeed(PiClient, {
  create: (opts) => makeLiveSession(opts),
  resume: (storedMeta) => makeResumedSession(storedMeta),
});

