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
import { randomUUID } from "node:crypto";
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
      executionCwd: string;
      title?: string;
      branch?: string;
    }) => Effect.Effect<PiSession, PiError>;
    readonly resume: (
      storedRecord: import("./session-record.ts").SessionRecord,
    ) => Effect.Effect<PiSession, PiError | SessionNotFound>;
  }
>() {}


const nextId = (prefix: string) => `${prefix}_${randomUUID()}`;

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

// Compatibility boundary for tool argument shapes emitted by older pi agents.
// Keep canonical protocol schemas strict; normalize legacy inputs here, then
// remove these adapters after one release once all supported agents emit the
// canonical shapes.
const LegacyEditToolArgs = v.object({
  path: v.string(),
  oldText: v.string(),
  newText: v.string(),
});

const LegacyBashToolArgs = v.object({
  cmd: v.string(),
  timeout: v.optional(v.number()),
});

const normalizeEditArgs = (rawArgs: unknown): EditToolInput => {
  const current = v.safeParse(EditToolArgs, rawArgs);
  if (current.success) return current.output;

  const legacy = v.parse(LegacyEditToolArgs, rawArgs);
  return { path: legacy.path, edits: [{ oldText: legacy.oldText, newText: legacy.newText }] };
};

const normalizeBashArgs = (rawArgs: unknown): BashToolInput => {
  const current = v.safeParse(BashToolArgs, rawArgs);
  if (current.success) return current.output;

  const legacy = v.parse(LegacyBashToolArgs, rawArgs);
  return { command: legacy.cmd, timeout: legacy.timeout };
};

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
      const args = normalizeEditArgs(rawArgs);
      return { ...base, toolKind: "builtin", tool: "edit", args };
    }
    case "bash": {
      const args = normalizeBashArgs(rawArgs);
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


const wirePiSession = (
  piSession: AgentSession,
  meta: SessionMeta,
): Effect.Effect<PiSession> =>
  Effect.gen(function* () {
    const q = yield* Queue.unbounded<PiEmission>();

    let assistantId: string | null = null;
    const toolStarts = new Map<string, { startedAt: number }>();

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

          let id = assistantId;
          if (!id) {
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
          return;
      }
    };

    const unsub = piSession.subscribe(mapEvent);
    const authJobs = new Map<string, AuthJobState>();

    return {
      meta,
      events: Stream.fromQueue(q),
      send: (text, mode, images) =>
        Effect.gen(function* () {
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
          yield* Effect.tryPromise({
            try: () => piSession.abort(),
            catch: (e) => new PiError(`abort failed: ${String(e)}`),
          });
          yield* Queue.offer(q, { t: "status", status: "idle" });
        }),
      approve: (_id, _choice) =>
        Effect.sync(() => {
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

const makeLiveSession = (opts: {
  cwd: string;
  executionCwd: string;
  title?: string;
  branch?: string;
}): Effect.Effect<PiSession, PiError> =>
  Effect.gen(function* () {
    const piSession = yield* Effect.tryPromise<AgentSession, PiError>({
      try: async () => {
        const authStorage = AuthStorage.create();
        const modelRegistry = ModelRegistry.create(authStorage);

        const fauxModel = setupFauxIfEnabled(authStorage);

        const sessionCwd = opts.executionCwd;
        const sessionManager =
          process.env.PI_EPHEMERAL === "1"
            ? PiSessionManager.inMemory()
            : PiSessionManager.create(sessionCwd);

        const { session } = await createAgentSession({
          sessionManager,
          authStorage,
          modelRegistry,
          cwd: sessionCwd,
        });

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
      updatedAt: new Date().toISOString(),
      tokens: { in: 0, out: 0 },
      costUsd: 0,
      archived: false,
    };

    return yield* wirePiSession(piSession, meta);
  });

const makeResumedSession = (
  storedRecord: import("./session-record.ts").SessionRecord,
): Effect.Effect<PiSession, PiError | SessionNotFound> =>
  Effect.gen(function* () {
    const piSession = yield* Effect.tryPromise<
      AgentSession,
      PiError | SessionNotFound
    >({
      try: async () => {
        const sessionCwd = storedRecord.runtime.executionCwd;
        const infos = await PiSessionManager.list(sessionCwd);
        const found = infos.find((i) => i.id === storedRecord.id);
        if (!found) {
          throw new SessionNotFound(storedRecord.id);
        }

        const authStorage = AuthStorage.create();
        const modelRegistry = ModelRegistry.create(authStorage);

        const fauxModel = setupFauxIfEnabled(authStorage);

        const sessionManager = PiSessionManager.open(found.path);

        const { session } = await createAgentSession({
          sessionManager,
          authStorage,
          modelRegistry,
          cwd: sessionCwd,
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

    const meta: SessionMeta = {
      id: storedRecord.id,
      title: storedRecord.title,
      cwd: storedRecord.cwd,
      branch: storedRecord.branch,
      status: "idle",
      updatedAt: new Date().toISOString(),
      tokens: storedRecord.tokens,
      costUsd: storedRecord.costUsd,
      archived: storedRecord.archived,
    };

    return yield* wirePiSession(piSession, meta);
  });


export const PiClientLive = Layer.succeed(PiClient, {
  create: (opts) => makeLiveSession(opts),
  resume: (storedMeta) => makeResumedSession(storedMeta),
});

