/**
 * pi.dev integration boundary.
 *
 * Two implementations of the same `PiClient` Tag:
 *
 *   PiClientLive  →  the real @earendil-works/pi-coding-agent SDK
 *   PiClientMock  →  scripted in-process flow for dev without API keys
 *
 * Toggle via $PI_USE_MOCK=1.
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
  Ref,
  Random,
  Fiber,
} from "effect";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager as PiSessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxText,
  registerFauxProvider,
} from "@earendil-works/pi-ai";
import type {
  PermissionChoice,
  ModelSummary,
  PermissionRequest,
  SessionMeta,
  SessionStatus,
  ToolCallMessage,
} from "@pi-mobile/protocol";
import { SessionNotFound } from "./errors.ts";

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

/**
 * Usage shape on AssistantMessage from `@earendil-works/pi-ai`.
 * We type it locally to avoid pulling pi-ai's types just for this. Pi's
 * own types are richer (totalTokens, cacheRead/Write etc.) but we only
 * need three fields here.
 */
interface PiUsage {
  input?: number;
  output?: number;
  cost?: { total?: number };
}

/**
 * Register pi-ai's faux provider with a small set of scripted responses
 * and return the model object suitable for `session.setModel(...)`.
 *
 * Used for shaking down the real pi pipeline end-to-end without API
 * keys. The faux provider's `setResponses` is called after registration
 * so each prompt() picks the next response in sequence (cycling once
 * exhausted via `appendResponses`).
 *
 * Idempotent across calls: if a faux provider is already registered
 * under the same provider/model id, pi-ai reuses it.
 */
let fauxRegistration: ReturnType<typeof registerFauxProvider> | null = null;
const registerFaux = () => {
  if (!fauxRegistration) {
    fauxRegistration = registerFauxProvider({
      provider: "shakedown",
      // Unique api id so we don't collide with pi-ai's built-in
      // providers (anthropic-messages, openai-chat, etc.). pi-coding-agent
      // re-registers the built-ins during ModelRegistry.create, which
      // would otherwise overwrite our faux entry on a shared api key.
      api: "faux",
      models: [
        {
          id: "shakedown-1",
          name: "Faux Shakedown",
          input: ["text"],
          contextWindow: 100_000,
          maxTokens: 4096,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
      // Slow it down a bit so we can observe streaming events.
      tokensPerSecond: 40,
      tokenSize: { min: 3, max: 7 },
    });
  }
  // Each call seeds a fresh canned response. Two modes:
  //   PI_FAUX=1 alone:               normal stopReason:"stop" success path
  //   PI_FAUX=1 + PI_FAUX_ERROR=1:   stopReason:"error" with errorMessage,
  //                                  for exercising the error-surfacing
  //                                  pipeline (mobile bubble banner)
  // Both modes share the same registration; only the canned response
  // differs.
  if (process.env.PI_FAUX_ERROR === "1") {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        // Empty content mirrors what pi-ai actually emits when the
        // provider fails before any tokens stream (auth/network/etc.).
        // The mobile must surface this as a failed turn even with no
        // streamed text.
        fauxText(""),
        {
          stopReason: "error",
          errorMessage:
            "Connection error. (faux: simulated provider failure)",
        },
      ),
    ]);
  } else {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        fauxText(
          "Acknowledged. Running a quick shakedown of the live pi event pipeline. " +
            "If you can read this in the chat, **streaming markdown** works.",
        ),
        { stopReason: "stop" },
      ),
    ]);
  }
  return fauxRegistration.getModel();
};

/* ──────────────────────────────────────────────────────────────────────
   LIVE — wraps the real pi AgentSession.

   Pi 0.73's event subscriber callback is synchronous: we use plain
   closure state and Queue.unsafeOffer rather than awaiting per-event
   Effect runtimes. See the `mapEvent` switch below for the exact event
   shapes (typed from @earendil-works/pi-coding-agent imports).
   ────────────────────────────────────────────────────────────────────── */

/**
 * If PI_FAUX=1 is set, register the deterministic faux provider and
 * stash a fake auth credential. Returns the faux model (so caller can
 * pin it on the session) or null when not in faux mode. Idempotent;
 * see {@link registerFaux} for the underlying registration cache.
 */
const setupFauxIfEnabled = (
  authStorage: ReturnType<typeof AuthStorage.create>,
): ReturnType<typeof registerFaux> | null => {
  if (process.env.PI_FAUX !== "1") return null;
  const fauxModel = registerFaux();
  // The faux provider doesn't need real auth, but pi's model selection
  // enforces that AuthStorage has *something* for the provider.
  // setRuntimeApiKey stores in-memory only — never hits the auth file.
  authStorage.setRuntimeApiKey("shakedown", "faux");
  return fauxModel;
};

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
          });
          assistantId = null;

          if (msg.usage) {
            Queue.unsafeOffer(q, {
              t: "cost",
              tokensIn: msg.usage.input ?? 0,
              tokensOut: msg.usage.output ?? 0,
              costUsd: msg.usage.cost?.total ?? 0,
            });
          }
          return;
        }

        case "tool_execution_start": {
          const id = event.toolCallId;
          toolStarts.set(id, { startedAt: Date.now() });

          const tool = (
            ["read", "write", "edit", "bash"].includes(event.toolName)
              ? event.toolName
              : "bash"
          ) as ToolCallMessage["tool"];

          Queue.unsafeOffer(q, {
            t: "tool_call",
            entry: {
              kind: "tool_call",
              id,
              at: Date.now(),
              tool,
              // `event.args` is `any` in pi's types; we accept whatever
              // shape and let the mobile renderer pattern-match on tool.
              args: (event.args as Record<string, unknown>) ?? {},
              status: "running",
            },
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
          const resultText = toolResultToText(event.result);

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
                  Effect.sync(() =>
                    console.error("[pi] prompt error:", e),
                  ),
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

const PiClientLive = Layer.succeed(PiClient, {
  create: (opts) => makeLiveSession(opts),
  resume: (storedMeta) => makeResumedSession(storedMeta),
});

/* ──────────────────────────────────────────────────────────────────────
   MOCK — scripted in-process flow, no API keys required.
   ────────────────────────────────────────────────────────────────────── */

const sleepRand = (minMs: number, spreadMs: number) =>
  Effect.flatMap(Random.next, (r) =>
    Effect.sleep(`${minMs + Math.floor(r * spreadMs)} millis`),
  );

function* chunks(s: string, min: number, max: number): Generator<string> {
  let i = 0;
  while (i < s.length) {
    const n = min + Math.floor(Math.random() * (max - min + 1));
    yield s.slice(i, i + n);
    i += n;
  }
}

const SCRIPT_REPLY_1 =
  "Looking at the auth middleware first to understand the current shape.";
const SCRIPT_REPLY_2 =
  "Three call sites. I'll swap the algorithm in `lib/jwt.ts`, load the public key from `KEYS_DIR/public.pem`, and update the test fixture to sign with RS256.";

/* Realistic edit demo — HS256 → RS256 in a JWT verifier. Picked because
   it exercises every diff-viewer code path: removed lines, added lines,
   surrounding context, all in a single segment. */
const EDIT_OLD = `import jwt from "jsonwebtoken";

export function verifyToken(token: string) {
  return jwt.verify(token, process.env.JWT_SECRET!, {
    algorithms: ["HS256"],
  });
}`;

const EDIT_NEW = `import jwt from "jsonwebtoken";
import { readFileSync } from "node:fs";

const PUBLIC_KEY = readFileSync(
  \`\${process.env.KEYS_DIR}/public.pem\`,
  "utf8",
);

export function verifyToken(token: string) {
  return jwt.verify(token, PUBLIC_KEY, {
    algorithms: ["RS256"],
  });
}`;

function toolResultToText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result == null) return "";

  if (typeof result === "object" && "content" in result) {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (typeof part === "string") return part;
          if (
            part &&
            typeof part === "object" &&
            "text" in part &&
            typeof (part as { text?: unknown }).text === "string"
          ) {
            return (part as { text: string }).text;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
      if (text) return text;
    }
  }

  return JSON.stringify(result);
}

const scriptedFlow = (q: Queue.Queue<PiEmission>, userText: string) =>
  Effect.gen(function* () {
    yield* Queue.offer(q, { t: "status", status: "thinking" });
    yield* Effect.sleep("400 millis");

    const id1 = nextId("m");
    for (const chunk of chunks(SCRIPT_REPLY_1, 3, 5)) {
      yield* Queue.offer(q, { t: "assistant_delta", id: id1, text: chunk });
      yield* sleepRand(25, 60);
    }
    yield* Queue.offer(q, { t: "assistant_end", id: id1 });

    const tcId = nextId("t");
    yield* Queue.offer(q, {
      t: "tool_call",
      entry: {
        kind: "tool_call",
        id: tcId,
        at: Date.now(),
        tool: "read",
        args: { path: "src/middleware/auth.ts" },
        status: "running",
      },
    });
    yield* sleepRand(60, 80);
    yield* Queue.offer(q, {
      t: "tool_result",
      id: tcId,
      result: "42 lines",
      status: "ok",
      durationMs: 14,
    });

    const id2 = nextId("m");
    for (const chunk of chunks(SCRIPT_REPLY_2, 3, 5)) {
      yield* Queue.offer(q, { t: "assistant_delta", id: id2, text: chunk });
      yield* sleepRand(20, 50);
    }
    yield* Queue.offer(q, { t: "assistant_end", id: id2 });

    /* edit tool call — demonstrates the diff viewer */
    const editId = nextId("t");
    yield* Queue.offer(q, {
      t: "tool_call",
      entry: {
        kind: "tool_call",
        id: editId,
        at: Date.now(),
        tool: "edit",
        args: {
          path: "lib/jwt.ts",
          oldText: EDIT_OLD,
          newText: EDIT_NEW,
        },
        status: "running",
      },
    });
    yield* sleepRand(80, 120);
    yield* Queue.offer(q, {
      t: "tool_result",
      id: editId,
      result: "Edited lib/jwt.ts (1 replacement, +5 -1 lines)",
      status: "ok",
      durationMs: 31,
    });

    yield* Queue.offer(q, {
      t: "permission",
      entry: {
        kind: "permission",
        id: nextId("p"),
        at: Date.now(),
        tool: "bash",
        args: { cmd: "openssl genrsa -out keys/private.pem 2048" },
        rationale: `Need an RSA key for the test fixture (echoing your prompt: "${userText.slice(0, 40)}").`,
      },
    });
    yield* Queue.offer(q, { t: "status", status: "waiting" });
  }).pipe(Effect.catchAll((e) => Effect.fail(new PiError(String(e)))));

const makeMockSession = (opts: {
  cwd: string;
  title?: string;
  branch?: string;
}): Effect.Effect<PiSession, PiError> =>
  Effect.gen(function* () {
    const q = yield* Queue.unbounded<PiEmission>();
    const currentFiber = yield* Ref.make<Fiber.RuntimeFiber<
      void,
      PiError
    > | null>(null);

    const meta: SessionMeta = {
      id: nextId("s"),
      title: opts.title ?? "untitled session",
      cwd: opts.cwd,
      branch: opts.branch,
      status: "idle",
      updatedAt: Date.now(),
      tokens: { in: 0, out: 0 },
      costUsd: 0,
    };

    return {
      meta,
      events: Stream.fromQueue(q),
      send: (text, _mode) =>
        Effect.gen(function* () {
          const prev = yield* Ref.get(currentFiber);
          if (prev) yield* Fiber.interrupt(prev);
          const f = yield* Effect.forkDaemon(scriptedFlow(q, text));
          yield* Ref.set(currentFiber, f);
        }),
      interrupt: () =>
        Effect.gen(function* () {
          const prev = yield* Ref.get(currentFiber);
          if (prev) yield* Fiber.interrupt(prev);
          yield* Queue.offer(q, { t: "status", status: "idle" });
        }),
      approve: (id) =>
        Effect.gen(function* () {
          yield* Queue.offer(q, { t: "status", status: "thinking" });
          yield* sleepRand(120, 80);
          yield* Queue.offer(q, {
            t: "tool_result",
            id,
            result: "Generating RSA private key, 2048 bit long modulus",
            status: "ok",
            durationMs: 240,
          });
          yield* Queue.offer(q, { t: "status", status: "idle" });
        }),
      listModels: () =>
        Effect.succeed({
          current: {
            provider: "mock",
            id: "mock-1",
            name: "Mock Model",
            reasoning: false,
            input: ["text"],
            contextWindow: 100_000,
            maxTokens: 4096,
            current: true,
            usingOAuth: false,
          },
          models: [
            {
              provider: "mock",
              id: "mock-1",
              name: "Mock Model",
              reasoning: false,
              input: ["text"],
              contextWindow: 100_000,
              maxTokens: 4096,
              current: true,
              usingOAuth: false,
            },
          ],
        }),
      setModel: () => Effect.void,
      compact: () => Effect.void,
      close: () =>
        Effect.gen(function* () {
          const prev = yield* Ref.get(currentFiber);
          if (prev) yield* Fiber.interrupt(prev);
          yield* Queue.shutdown(q);
        }),
    };
  });

const PiClientMock = Layer.succeed(PiClient, {
  create: (opts) => makeMockSession(opts),
  // The mock has no persistence — a bridge restart loses all state.
  // We surface that honestly rather than fabricating a fake session.
  resume: (storedMeta) =>
    Effect.fail(new SessionNotFound(storedMeta.id)),
});

/** Pick the impl based on $PI_USE_MOCK. */
export const PiClientFromEnv =
  process.env.PI_USE_MOCK === "1" ? PiClientMock : PiClientLive;
