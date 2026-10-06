import { v7 as randomUUIDv7 } from "uuid";
import {
  Cause,
  Context,
  Effect,
  Deferred,
  Layer,
  PubSub,
  Ref,
  Runtime,
  Stream,
  Fiber,
  HashMap,
  Option,
  pipe,
} from "effect";
import {
  capabilitiesForRuntime,
  DurableRuntimeFactory,
  PiError,
  type ExportedHtml,
  type PresenceSessionRuntime,
  type SessionEmission,
  type SessionRuntime,
} from "./session-runtime.ts";
import { parseWireEvent } from "@pico/protocol";
import { emptyLog, reconcileOrphanedToolCalls, reduceLog } from "@pico/protocol/log";
import type {
  Commands,
  ExtensionUiResponseValue,
  ImageContent,
  LogEntry,
  LogPage,
  SendMode,
  SessionMeta,
  QueuedMessage,
  QueueState,
  UserMessage,
  SessionControls,
  SessionStats,
  SessionTree,
  SessionCapability,
  WireEvent,
} from "@pico/protocol";
import { Store } from "./store.ts";
import { toSessionMeta } from "./session-record.ts";
import { SessionNotFound } from "./errors.ts";
import { parsePiSessionBinding } from "./pi-compatibility.ts";

interface TerminalReleaseLease {
  readonly id: string;
  readonly runtimeSessionId: string;
  readonly expiresAt: number;
}

interface PendingSend extends QueuedMessage {
  readonly at: number;
  readonly phase: "held_for_compaction" | "sdk_queue";
  readonly images?: ImageContent[];
}

export interface TerminalSessionRelease {
  readonly id: string;
  readonly leaseId: string;
  readonly runtimeSessionId: string;
  readonly runtimeSessionFile: string;
  readonly cwd: string;
  readonly title: string;
}

export interface PresenceHandoffTarget {
  readonly runtimeSessionId: string;
  readonly runtimeSessionFile: string;
  readonly ownerPid: number;
}

export interface PresenceHandoffLease extends PresenceHandoffTarget {
  readonly leaseId: string;
  readonly generation: number;
}

interface ManagedSessionState {
  readonly meta: Ref.Ref<SessionMeta>;
  readonly runtime: SessionRuntime;
  readonly generation: number;
  readonly operationGate: Effect.Semaphore;
  readonly handoff: Ref.Ref<Option.Option<PresenceHandoffLease>>;
  readonly pubsub: PubSub.PubSub<WireEvent>;
  readonly seq: Ref.Ref<number>;
  readonly subscribers: Ref.Ref<number>;
  readonly idleEvictionTimer: Ref.Ref<ReturnType<typeof setTimeout> | null>;
  readonly pendingSends: Ref.Ref<PendingSend[]>;
  readonly compacting: Ref.Ref<boolean>;
  readonly queueEventsToIgnore: Ref.Ref<number>;
  /** Newest last; retries with a seen id are dropped. */
  readonly seenClientIds: Ref.Ref<string[]>;
}

interface ManagedSession extends ManagedSessionState {
  readonly pumpFiber: Fiber.RuntimeFiber<void, PiError>;
}

type ReattachWaiter = Deferred.Deferred<ManagedSession, PiError | SessionNotFound>;
type ReattachMap = HashMap.HashMap<string, ReattachWaiter>;
type ReattachDecision = readonly [ReattachWaiter, ReattachMap];

function queuedCounts(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function consumeQueued(counts: Map<string, number>, text: string): boolean {
  const count = counts.get(text) ?? 0;
  if (count <= 0) return false;
  if (count === 1) counts.delete(text);
  else counts.set(text, count - 1);
  return true;
}

function reconcileSdkQueue(
  pending: PendingSend[],
  queue: { steering: readonly string[]; followUp: readonly string[] },
): PendingSend[] {
  const steering = queuedCounts([...queue.steering]);
  const followUp = queuedCounts([...queue.followUp]);
  const next: PendingSend[] = [];

  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const message = pending[index];
    if (message.phase === "held_for_compaction") {
      next.push(message);
      continue;
    }

    const counts = message.mode === "follow_up" ? followUp : steering;
    if (consumeQueued(counts, message.text)) next.push(message);
  }

  return next.reverse();
}

function projectQueue(pending: readonly PendingSend[]): QueueState {
  return {
    queued: pending.map(({ id, text, images, mode }) => ({ id, text, images, mode })),
  };
}

function withPendingUserEntries(entries: readonly LogEntry[], pending: readonly PendingSend[]): LogEntry[] {
  const ids = new Set(entries.map((entry) => entry.id));
  const pendingEntries: LogEntry[] = pending
    .filter((message) => !ids.has(message.id))
    .map(({ id, at, text, images, mode }) => ({
      kind: "user",
      id,
      at,
      text,
      images,
      queued: true,
      mode,
    }));
  return [...entries, ...pendingEntries];
}

export class SessionManager extends Context.Tag("SessionManager")<
  SessionManager,
  {
    readonly create: (opts: {
      cwd: string;
      title: string;
    }) => Effect.Effect<SessionMeta, PiError>;
    readonly attachPresence: (runtime: PresenceSessionRuntime) => Effect.Effect<SessionMeta, PiError>;
    readonly detachPresence: (id: string, runtime: PresenceSessionRuntime) => Effect.Effect<void>;
    readonly preparePresenceHandoff: (
      id: string,
      runtime: PresenceSessionRuntime,
      target: PresenceHandoffTarget,
    ) => Effect.Effect<PresenceHandoffLease, PiError>;
    readonly cancelPresenceHandoff: (
      id: string,
      runtime: PresenceSessionRuntime,
      lease: PresenceHandoffLease,
    ) => Effect.Effect<void>;
    readonly completePresenceHandoff: (
      id: string,
      runtime: PresenceSessionRuntime,
      lease: PresenceHandoffLease,
    ) => Effect.Effect<void>;
    readonly list: (filter?: { archived?: boolean }) => Effect.Effect<SessionMeta[]>;
    readonly get: (id: string) => Effect.Effect<Option.Option<SessionMeta>>;
    readonly subscribe: (
      id: string,
      fromCursor: number,
    ) => Stream.Stream<WireEvent, PiError | SessionNotFound>;
    readonly send: (
      id: string,
      text: string,
      mode: SendMode,
      images: ImageContent[] | undefined,
      clientId: string,
    ) => Effect.Effect<void, PiError | SessionNotFound>;
    readonly interrupt: (
      id: string,
    ) => Effect.Effect<void, PiError | SessionNotFound>;
    readonly requestBackground: (
      id: string,
    ) => Effect.Effect<void, PiError | SessionNotFound>;
    readonly releaseToTerminal: (
      id: string,
    ) => Effect.Effect<TerminalSessionRelease, PiError | SessionNotFound>;
    readonly consumeTerminalRelease: (
      leaseId: string,
      id: string,
    ) => Effect.Effect<string, PiError>;
    readonly extensionUiResponse: (
      id: string,
      requestId: string,
      value: ExtensionUiResponseValue,
    ) => Effect.Effect<void, PiError | SessionNotFound>;
    readonly compact: (
      id: string,
      instructions?: string,
    ) => Effect.Effect<void, PiError | SessionNotFound>;
    readonly exportHtml: (id: string) => Effect.Effect<ExportedHtml, PiError | SessionNotFound>;
    readonly listCommands: (id: string) => Effect.Effect<Commands, PiError | SessionNotFound>;
    readonly getQueue: (id: string) => Effect.Effect<QueueState, PiError | SessionNotFound>;
    readonly clearQueue: (id: string) => Effect.Effect<QueueState, PiError | SessionNotFound>;
    readonly removeQueued: (id: string, messageId: string) => Effect.Effect<QueueState, PiError | SessionNotFound>;
    readonly getSettings: (id: string) => Effect.Effect<SessionControls, PiError | SessionNotFound>;
    readonly patchSetting: (
      id: string,
      key: string,
      value: string | boolean,
    ) => Effect.Effect<SessionControls, PiError | SessionNotFound>;
    readonly getStats: (id: string) => Effect.Effect<SessionStats, PiError | SessionNotFound>;
    readonly getLogBefore: (id: string, beforeId: string, limit?: number) => Effect.Effect<LogPage, PiError | SessionNotFound>;
    readonly getTree: (id: string) => Effect.Effect<SessionTree, PiError | SessionNotFound>;
    readonly navigateTree: (
      id: string,
      entryId: string,
      summarize?: boolean,
    ) => Effect.Effect<void, PiError | SessionNotFound>;
    readonly patch: (
      id: string,
      patch: { title?: string; archived?: boolean },
    ) => Effect.Effect<SessionMeta, PiError | SessionNotFound>;
    readonly remove: (
      id: string,
    ) => Effect.Effect<void, SessionNotFound>;
    readonly closeAll: () => Effect.Effect<void>;
  }
>() {}

export { SessionNotFound } from "./errors.ts";

const IDLE_EVICT_MS = 15 * 60 * 1000;

// A subscriber that falls this far behind loses oldest events; heals on reconnect via cursor replay.
const LIVE_BUFFER_CAPACITY = 4096;

// Backstop against a runaway client queueing sends forever.
const MAX_PENDING_SENDS = 200;

// Retries only race acks over seconds, so a small dedupe window is plenty.
const MAX_SEEN_CLIENT_IDS = 64;
const INITIAL_LOG_TAIL_ENTRIES = 120;
const LOG_PAGE_LIMIT = 120;
const MAX_LOG_PAGE_LIMIT = 240;
const HANDOFF_PROCESS_EXIT_TIMEOUT_MS = 15_000;
const HANDOFF_PROCESS_POLL_MS = 50;
const TERMINAL_RELEASE_LEASE_MS = 2 * 60_000;

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

const waitForProcessExit = async (pid: number): Promise<void> => {
  const deadline = Date.now() + HANDOFF_PROCESS_EXIT_TIMEOUT_MS;
  while (processIsAlive(pid)) {
    if (Date.now() >= deadline) throw new Error(`Pi process ${pid} did not exit after handoff`);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, HANDOFF_PROCESS_POLL_MS).unref();
    });
  }
};

const unsupported = (capability: SessionCapability) =>
  new PiError({ message: `${capability} is not available for this session` });

const runtimeSupports = (runtime: SessionRuntime, capability: SessionCapability): boolean =>
  capabilitiesForRuntime(runtime).includes(capability);

const handoffInProgress = () => new PiError({ message: "session ownership handoff is in progress" });

const sameHandoffLease = (left: PresenceHandoffLease, right: PresenceHandoffLease): boolean =>
  left.leaseId === right.leaseId && left.generation === right.generation;

const make = Effect.gen(function* () {
  const durableRuntimes = yield* DurableRuntimeFactory;
  const store = yield* Store;
  // Presence runtimes are discoverable only while their owner is connected.
  // Remove crash residue before exposing the persisted session list.
  yield* store.deletePresenceSessions();
  const sessions = yield* Ref.make(HashMap.empty<string, ManagedSession>());
  const presenceLifecycle = yield* Effect.makeSemaphore(1);
  const terminalReleaseLeases = yield* Ref.make(
    HashMap.empty<string, TerminalReleaseLease>(),
  );
  // Runs the idle-eviction timer on the host runtime (its logger config) instead of the Effect default.
  const timerRuntime = yield* Effect.runtime<never>();

  const reattachInFlight = yield* Ref.make(
    HashMap.empty<
      string,
      Deferred.Deferred<ManagedSession, PiError | SessionNotFound>
    >(),
  );

  const withActiveRuntime = <A, E, R>(
    ms: ManagedSessionState,
    use: (runtime: SessionRuntime) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | PiError, R> =>
    ms.operationGate.withPermits(1)(
      Effect.flatMap(
        Ref.get(ms.handoff),
        (handoff): Effect.Effect<A, E | PiError, R> =>
          Option.isSome(handoff) ? Effect.fail(handoffInProgress()) : use(ms.runtime),
      ),
    );

  const removeManagedIfCurrent = (sessionId: string, expected: ManagedSession): Effect.Effect<void> =>
    Ref.update(sessions, (current) => {
      const found = HashMap.get(current, sessionId);
      return Option.isSome(found) && found.value === expected
        ? HashMap.remove(current, sessionId)
        : current;
    });

  const queueEvent = (seq: number, pending: readonly PendingSend[]): WireEvent =>
    parseWireEvent({ t: "queue", seq, ...projectQueue(pending) });

  const userMessageRemovedEvent = (seq: number, id: string): WireEvent =>
    parseWireEvent({ t: "user_message_removed", seq, id });

  const reduceEventsToEntries = (events: readonly WireEvent[], status: SessionMeta["status"]): LogEntry[] => {
    const log = emptyLog();
    for (const event of events) reduceLog(log, event, Date.now());
    if (status === "idle" || status === "error") reconcileOrphanedToolCalls(log);
    return log.entries as LogEntry[];
  };

  const retainedLogEntries = (
    id: string,
    pending: readonly PendingSend[],
    status: SessionMeta["status"],
  ): Effect.Effect<{ entries: LogEntry[]; prunedThrough: number }> =>
    Effect.gen(function* () {
      const prunedThrough = yield* store.prunedThrough(id);
      const entries = withPendingUserEntries(
        reduceEventsToEntries(yield* store.loadEventsAfter(id, prunedThrough), status),
        pending,
      );
      return { entries, prunedThrough };
    });

  const retainedLogTail = (
    id: string,
    pending: readonly PendingSend[],
    status: SessionMeta["status"],
  ): Effect.Effect<LogPage> =>
    retainedLogEntries(id, pending, status).pipe(
      Effect.map(({ entries, prunedThrough }) => {
        const start = Math.max(0, entries.length - INITIAL_LOG_TAIL_ENTRIES);
        return {
          entries: entries.slice(start),
          hasMoreBefore: start > 0 || prunedThrough > 0,
        };
      }),
    );

  const pageBefore = (entries: readonly LogEntry[], beforeId: string, limit?: number): LogPage => {
    const end = entries.findIndex((entry) => entry.id === beforeId);
    if (end <= 0) return { entries: [], hasMoreBefore: false };

    const size = Math.min(Math.max(Math.floor(limit ?? LOG_PAGE_LIMIT), 1), MAX_LOG_PAGE_LIMIT);
    const start = Math.max(0, end - size);
    return {
      entries: entries.slice(start, end),
      hasMoreBefore: start > 0,
    };
  };

  const publishStatus = (
    ms: ManagedSessionState,
    sessionId: string,
    status: SessionMeta["status"],
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const now = Date.now();
      const seq = yield* Ref.updateAndGet(ms.seq, (n) => n + 1);
      const event = parseWireEvent({ t: "status", seq, status });
      yield* Ref.update(ms.meta, (meta) => ({
        ...meta,
        status,
        updatedAt: new Date(now).toISOString(),
      }));
      yield* store.updateSession(sessionId, { status, updatedAtMs: now });
      yield* store.appendEvent(sessionId, event);
      yield* PubSub.publish(ms.pubsub, event);
    });

  const publishQueueSnapshot = (
    ms: ManagedSessionState,
    sessionId: string,
  ): Effect.Effect<void, PiError> =>
    Effect.gen(function* () {
      const seq = yield* Ref.updateAndGet(ms.seq, (n) => n + 1);
      const event = queueEvent(seq, yield* Ref.get(ms.pendingSends));
      yield* store.appendEvent(sessionId, event);
      yield* PubSub.publish(ms.pubsub, event);
    });

  const publishUserMessageRemoved = (
    ms: ManagedSessionState,
    sessionId: string,
    messageId: string,
  ): Effect.Effect<void, PiError> =>
    Effect.gen(function* () {
      const seq = yield* Ref.updateAndGet(ms.seq, (n) => n + 1);
      const event = userMessageRemovedEvent(seq, messageId);
      yield* store.appendEvent(sessionId, event);
      yield* PubSub.publish(ms.pubsub, event);
    });

  const resyncSdkQueue = (
    ms: ManagedSessionState,
    pending: readonly PendingSend[],
  ): Effect.Effect<void, PiError> =>
    Effect.gen(function* () {
      const sdkQueued = pending.filter((message) => message.phase === "sdk_queue");
      if (!ms.runtime.clearQueue) return yield* Effect.fail(unsupported("queue"));
      yield* Ref.update(ms.queueEventsToIgnore, (count) => count + 1 + sdkQueued.length);
      yield* ms.runtime.clearQueue();

      const meta = yield* Ref.get(ms.meta);
      if (meta.status !== "thinking" && meta.status !== "tool") return;

      for (const message of sdkQueued) {
        yield* ms.runtime.send(message.text, message.mode, message.images);
      }
    });

  const flushCompactionQueue = (
    ms: ManagedSessionState,
    sessionId: string,
    opts?: { willRetry?: boolean },
  ): Effect.Effect<void, PiError> =>
    Effect.gen(function* () {
      const pending = yield* Ref.get(ms.pendingSends);
      const held = pending.filter((message) => message.phase === "held_for_compaction");
      if (held.length === 0) return;

      const unheld = pending.filter((message) => message.phase !== "held_for_compaction");
      const sdkQueued = (opts?.willRetry ? held : held.slice(1)).map(
        (message): PendingSend => ({ ...message, phase: "sdk_queue" }),
      );
      const afterFlush = [...unheld, ...sdkQueued];
      const messagesForSdk = held.map(({ text, mode, images }) => ({ text, mode, images }));

      if (!ms.runtime.flushAfterCompaction) return yield* Effect.fail(unsupported("queue"));

      yield* ms.runtime.flushAfterCompaction(messagesForSdk, opts).pipe(
        Effect.tap(() =>
          Ref.set(ms.pendingSends, afterFlush).pipe(
            Effect.andThen(publishQueueSnapshot(ms, sessionId)),
          ),
        ),
        Effect.catchAll((error) =>
          Ref.set(ms.pendingSends, pending).pipe(
            Effect.andThen(publishQueueSnapshot(ms, sessionId)),
            Effect.andThen(Effect.logError("[session] failed to flush compaction queue", error)),
          ),
        ),
      );
    });

  const isEvictable = (ms: ManagedSession): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      if (ms.runtime.lifecycle.kind === "presence") return false;
      if (Option.isSome(yield* Ref.get(ms.handoff))) return false;
      const [subscribers, pending, compacting, meta] = yield* Effect.all([
        Ref.get(ms.subscribers),
        Ref.get(ms.pendingSends),
        Ref.get(ms.compacting),
        Ref.get(ms.meta),
      ]);

      return subscribers === 0 &&
        pending.length === 0 &&
        !compacting &&
        (meta.status === "idle" || meta.status === "error");
    });

  const clearIdleEviction = (ms: ManagedSessionState): Effect.Effect<void> =>
    Ref.modify(ms.idleEvictionTimer, (timer) => {
      if (timer) clearTimeout(timer);
      return [undefined, null];
    });

  const evictIfIdle = (sessionId: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const map = yield* Ref.get(sessions);
      const current = HashMap.get(map, sessionId);
      if (Option.isNone(current)) return;

      const ms = current.value;
      yield* ms.operationGate.withPermits(1)(Effect.gen(function* () {
        yield* Ref.set(ms.idleEvictionTimer, null);
        if (!(yield* isEvictable(ms))) return;

        yield* Effect.logInfo(`[session] evict idle session=${sessionId}`);
        yield* Fiber.interrupt(ms.pumpFiber);
        yield* ms.runtime.close();
        yield* Ref.update(sessions, (m) => HashMap.remove(m, sessionId));
      }));
    });

  const scheduleIdleEviction = (sessionId: string, ms: ManagedSessionState): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* clearIdleEviction(ms);
      yield* Ref.set(
        ms.idleEvictionTimer,
        setTimeout(() => {
          void Runtime.runPromise(timerRuntime)(evictIfIdle(sessionId).pipe(Effect.ignoreLogged));
        }, IDLE_EVICT_MS).unref(),
      );
    });

  const startPump = (
    ms: ManagedSessionState,
    sessionId: string,
  ): Effect.Effect<void, PiError> =>
    pipe(
      ms.runtime.events,
      Stream.runForEach((emission: SessionEmission) =>
        ms.operationGate.withPermits(1)(Effect.gen(function* () {
          // Once a handoff lease is granted, this generation is read-only.
          // Any late presence emissions are stale and must not cross the lease.
          if (Option.isSome(yield* Ref.get(ms.handoff))) return;

          // Mobile submissions are journaled by SessionManager before dispatch.
          // A runtime may echo the same accepted input (presence runtimes do);
          // clientId makes that echo recognizable without source-specific logic.
          if (emission.t === "user_message" && emission.entry.clientId) {
            const submittedHere = (yield* Ref.get(ms.seenClientIds)).includes(emission.entry.clientId);
            if (submittedHere) return;
          }

          let event: WireEvent;
          if (emission.t === "queue") {
            const ignore = yield* Ref.modify(ms.queueEventsToIgnore, (count) =>
              count > 0 ? [true, count - 1] : [false, 0],
            );
            if (ignore) return;

            const seq = yield* Ref.updateAndGet(ms.seq, (n) => n + 1);
            event = queueEvent(
              seq,
              yield* Ref.updateAndGet(ms.pendingSends, (pending) => reconcileSdkQueue(pending, emission)),
            );
          } else {
            const seq = yield* Ref.updateAndGet(ms.seq, (n) => n + 1);
            // A decode mismatch (SessionEmission drifting from WireEvent) must not throw:
            // a defect here kills the pump fiber and zombifies the session. Drop it.
            const decoded = yield* Effect.either(Effect.try(() => parseWireEvent({ ...emission, seq })));
            if (decoded._tag === "Left") {
              yield* Effect.logError(`[pi] dropped undecodable emission (t=${emission.t}): ${String(decoded.left)}`);
              return;
            }
            event = decoded.right;
          }

          if (event.t === "status") {
            yield* Ref.update(ms.meta, (m) => ({
              ...m,
              status: event.status,
              updatedAt: new Date().toISOString(),
            }));
            yield* store.updateSession(sessionId, {
              status: event.status,
              updatedAtMs: Date.now(),
            });
          } else if (event.t === "cost") {
            const patch = {
              tokens: { in: event.tokensIn, out: event.tokensOut },
              costUsd: event.costUsd,
              updatedAt: new Date().toISOString(),
            };
            yield* Ref.update(ms.meta, (m) => ({ ...m, ...patch }));
            yield* store.updateSession(sessionId, {
              tokens: patch.tokens,
              costUsd: patch.costUsd,
              updatedAtMs: Date.now(),
            });
          } else {
            yield* Ref.update(ms.meta, (m) => ({ ...m, updatedAt: new Date().toISOString() }));
          }

          if (event.t !== "extension_ui_request" && event.t !== "tool_update") {
            yield* store.appendEvent(sessionId, event);
          }

          yield* PubSub.publish(ms.pubsub, event);

          if (event.t === "compaction") {
            if (event.entry.status === "running") {
              yield* Ref.set(ms.compacting, true);
              yield* clearIdleEviction(ms);
            } else {
              yield* Ref.set(ms.compacting, false);
              if (ms.runtime.flushAfterCompaction) {
                yield* flushCompactionQueue(ms, sessionId, { willRetry: event.entry.willRetry });
              }
              yield* scheduleIdleEviction(sessionId, ms);
            }
          } else if (event.t === "status" && (event.status === "idle" || event.status === "error")) {
            yield* scheduleIdleEviction(sessionId, ms);
          } else if (event.t === "status") {
            yield* clearIdleEviction(ms);
          }
        })),
      ),
    );

  const buildManagedSession = (
    sessionId: string,
    runtime: SessionRuntime,
    generation = 1,
  ): Effect.Effect<ManagedSession, PiError> =>
    Effect.gen(function* () {
      const runtimeMeta: SessionMeta = {
        ...runtime.meta,
        execution: runtime.lifecycle.kind === "durable" ? "host" : runtime.meta.execution ?? "terminal",
        canBackground: Boolean(runtime.requestBackground),
        capabilities: [...capabilitiesForRuntime(runtime)],
      };
      const state: ManagedSessionState = {
        meta: yield* Ref.make(runtimeMeta),
        runtime,
        generation,
        operationGate: yield* Effect.makeSemaphore(1),
        handoff: yield* Ref.make(Option.none<PresenceHandoffLease>()),
        pubsub: yield* PubSub.sliding<WireEvent>(LIVE_BUFFER_CAPACITY),
        seq: yield* Ref.make(yield* store.maxSeq(sessionId)),
        subscribers: yield* Ref.make(0),
        idleEvictionTimer: yield* Ref.make<ReturnType<typeof setTimeout> | null>(null),
        pendingSends: yield* Ref.make<PendingSend[]>([]),
        compacting: yield* Ref.make(false),
        queueEventsToIgnore: yield* Ref.make(0),
        seenClientIds: yield* Ref.make<string[]>([]),
      };
      // A pump death silently zombifies the session: pi keeps running but no events reach store or subscribers.
      const pumpFiber = yield* Effect.forkDaemon(
        startPump(state, sessionId).pipe(
          Effect.tapErrorCause((cause) =>
            Cause.isInterruptedOnly(cause)
              ? Effect.void
              : Effect.logError(`[session] event pump died session=${sessionId}: ${Cause.pretty(cause)}`),
          ),
        ),
      );
      return { ...state, pumpFiber };
    });

  const create = (opts: { cwd: string; title: string }) =>
    Effect.gen(function* () {
      const runtime = yield* durableRuntimes.create({
        cwd: opts.cwd,
        title: opts.title,
      });
      const meta = runtime.meta;

      yield* store.insertSession({
        id: meta.id,
        title: meta.title,
        cwd: meta.cwd,
        status: meta.status,
        updatedAtMs: Date.parse(meta.updatedAt),
        tokens: meta.tokens,
        costUsd: meta.costUsd,
        archived: meta.archived,
        lifecycle: "durable",
        runtimeSessionId: meta.id,
      });

      const ms = yield* buildManagedSession(meta.id, runtime);
      yield* Ref.update(sessions, HashMap.set(meta.id, ms));
      return yield* Ref.get(ms.meta);
    });

  const attachPresence = (runtime: PresenceSessionRuntime): Effect.Effect<SessionMeta, PiError> =>
    presenceLifecycle.withPermits(1)(Effect.gen(function* () {
      const meta = runtime.meta;
      if (meta.archived || !Number.isFinite(Date.parse(meta.updatedAt))) {
        return yield* Effect.fail(new PiError({ message: "invalid presence session metadata" }));
      }
      const current = HashMap.get(yield* Ref.get(sessions), meta.id);
      if (Option.isSome(current)) {
        return yield* Effect.fail(new PiError({ message: `session is already present: ${meta.id}` }));
      }
      const persisted = yield* store.getSession(meta.id);
      if (Option.isSome(persisted) && persisted.value.lifecycle === "durable") {
        return yield* Effect.fail(new PiError({ message: `session is already host-owned: ${meta.id}` }));
      }

      const snapshot = yield* runtime.getLog();
      const initialEvent = parseWireEvent({
        t: "log_reset",
        seq: 1,
        entries: snapshot,
      });
      // The row and initial snapshot commit together before the presence
      // session becomes discoverable.
      yield* store.replaceSessionWithInitialEvent({
        id: meta.id,
        title: meta.title,
        cwd: meta.cwd,
        status: meta.status,
        updatedAtMs: Date.parse(meta.updatedAt),
        tokens: meta.tokens,
        costUsd: meta.costUsd,
        archived: meta.archived,
        lifecycle: "presence",
        runtimeSessionId: meta.id,
      }, initialEvent);

      const managed = yield* buildManagedSession(meta.id, runtime);
      yield* Ref.update(sessions, HashMap.set(meta.id, managed));
      return yield* Ref.get(managed.meta);
    }));

  const detachPresence = (id: string, runtime: PresenceSessionRuntime): Effect.Effect<void> =>
    presenceLifecycle.withPermits(1)(Effect.gen(function* () {
      const current = HashMap.get(yield* Ref.get(sessions), id);
      if (Option.isNone(current) || current.value.runtime !== runtime) return;
      const managed = current.value;
      yield* managed.operationGate.withPermits(1)(Effect.gen(function* () {
        // A leased transport close is completed by completePresenceHandoff instead.
        if (Option.isSome(yield* Ref.get(managed.handoff))) return;
        yield* clearIdleEviction(managed);
        yield* Fiber.interrupt(managed.pumpFiber);
        const seq = yield* Ref.updateAndGet(managed.seq, (n) => n + 1);
        const event = parseWireEvent({ t: "status", seq, status: "error" });
        yield* PubSub.publish(managed.pubsub, event);
        yield* removeManagedIfCurrent(id, managed);
        yield* store.deleteSession(id);
      }));
    }));

  const preparePresenceHandoff = (
    id: string,
    runtime: PresenceSessionRuntime,
    target: PresenceHandoffTarget,
  ): Effect.Effect<PresenceHandoffLease, PiError> =>
    presenceLifecycle.withPermits(1)(Effect.gen(function* () {
      if (target.ownerPid === process.pid) {
        return yield* Effect.fail(new PiError({ message: "refusing to hand a session to its current process" }));
      }
      if (!processIsAlive(target.ownerPid)) {
        return yield* Effect.fail(new PiError({ message: `Pi process ${target.ownerPid} is not running` }));
      }
      if (!target.runtimeSessionId || !target.runtimeSessionFile) {
        return yield* Effect.fail(new PiError({ message: "handoff runtime session binding is required" }));
      }

      const current = HashMap.get(yield* Ref.get(sessions), id);
      if (Option.isNone(current) || current.value.runtime !== runtime) {
        return yield* Effect.fail(new PiError({ message: "attached session is no longer current" }));
      }
      const managed = current.value;
      const awaitIdleProjection = (remaining: number): Effect.Effect<void, PiError> =>
        Effect.flatMap(Ref.get(managed.meta), (meta) => {
          if (meta.status === "idle") return Effect.void;
          if (remaining <= 0) {
            return Effect.fail(new PiError({ message: "session must be fully idle before backgrounding" }));
          }
          return Effect.sleep("25 millis").pipe(Effect.andThen(awaitIdleProjection(remaining - 1)));
        });
      // The extension writes its final idle event immediately before the
      // handoff request. Give the event pump time to project that ordered line.
      yield* awaitIdleProjection(40);

      return yield* managed.operationGate.withPermits(1)(Effect.gen(function* () {
        if (Option.isSome(yield* Ref.get(managed.handoff))) {
          return yield* Effect.fail(handoffInProgress());
        }
        const [meta, compacting, pending] = yield* Effect.all([
          Ref.get(managed.meta),
          Ref.get(managed.compacting),
          Ref.get(managed.pendingSends),
        ]);
        if (meta.status !== "idle" || compacting || pending.length > 0) {
          return yield* Effect.fail(new PiError({ message: "session must be fully idle before backgrounding" }));
        }

        const lease: PresenceHandoffLease = {
          ...target,
          leaseId: randomUUIDv7(),
          generation: managed.generation,
        };
        yield* store.updateSession(id, {
          runtimeSessionId: target.runtimeSessionId,
          runtimeSessionFile: target.runtimeSessionFile,
        });
        yield* Ref.update(managed.meta, (meta) => ({ ...meta, execution: "transferring" as const }));
        yield* publishStatus(managed, id, "waiting");
        yield* Ref.set(managed.handoff, Option.some(lease));
        return lease;
      }));
    }));

  const cancelPresenceHandoff = (
    id: string,
    runtime: PresenceSessionRuntime,
    lease: PresenceHandoffLease,
  ): Effect.Effect<void> =>
    presenceLifecycle.withPermits(1)(Effect.gen(function* () {
      const current = HashMap.get(yield* Ref.get(sessions), id);
      if (Option.isNone(current) || current.value.runtime !== runtime) return;
      const managed = current.value;
      yield* managed.operationGate.withPermits(1)(Effect.gen(function* () {
        const active = yield* Ref.get(managed.handoff);
        if (Option.isNone(active) || !sameHandoffLease(active.value, lease)) return;
        yield* Ref.set(managed.handoff, Option.none());
        yield* Ref.update(managed.meta, (meta) => ({ ...meta, execution: "terminal" as const }));
        yield* publishStatus(managed, id, "idle");
      }));
    }));

  const dropPresenceHandoff = (
    id: string,
    runtime: PresenceSessionRuntime,
    lease: PresenceHandoffLease,
    reason: string,
  ): Effect.Effect<void> =>
    presenceLifecycle.withPermits(1)(Effect.gen(function* () {
      const current = HashMap.get(yield* Ref.get(sessions), id);
      if (Option.isNone(current) || current.value.runtime !== runtime) return;
      const managed = current.value;
      yield* managed.operationGate.withPermits(1)(Effect.gen(function* () {
        const active = yield* Ref.get(managed.handoff);
        if (Option.isNone(active) || !sameHandoffLease(active.value, lease)) return;
        yield* Effect.logError("session_background_handoff_failed").pipe(
          Effect.annotateLogs({ session_id: id, reason }),
        );
        yield* publishStatus(managed, id, "error");
        yield* clearIdleEviction(managed);
        yield* Fiber.interrupt(managed.pumpFiber);
        yield* managed.runtime.close();
        yield* removeManagedIfCurrent(id, managed);
        yield* store.deleteSession(id);
        yield* PubSub.shutdown(managed.pubsub);
      }));
    }));

  const completePresenceHandoff = (
    id: string,
    runtime: PresenceSessionRuntime,
    lease: PresenceHandoffLease,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const ownerExit = yield* Effect.either(Effect.tryPromise({
        try: () => waitForProcessExit(lease.ownerPid),
        catch: (cause) => cause,
      }));
      if (ownerExit._tag === "Left") {
        yield* dropPresenceHandoff(id, runtime, lease, String(ownerExit.left));
        return;
      }

      const current = HashMap.get(yield* Ref.get(sessions), id);
      if (Option.isNone(current) || current.value.runtime !== runtime) return;
      const managed = current.value;

      yield* managed.operationGate.withPermits(1)(Effect.gen(function* () {
        const active = yield* Ref.get(managed.handoff);
        if (
          Option.isNone(active) ||
          !sameHandoffLease(active.value, lease) ||
          active.value.generation !== managed.generation
        ) return;

        const stored = yield* store.getSession(id);
        if (Option.isNone(stored)) return;
        const committed = {
          ...stored.value,
          lifecycle: "durable" as const,
          runtimeSessionId: lease.runtimeSessionId,
          runtimeSessionFile: lease.runtimeSessionFile,
          status: "idle" as const,
          updatedAtMs: Date.now(),
        };

        // The old process is gone, so committing durable ownership before SDK
        // resume is safe. If the host crashes after this write, lazy reattach
        // will recover the logical session using the persisted runtime binding.
        yield* store.updateSession(id, committed);
        const replacement = yield* Effect.either(
          durableRuntimes.resume(committed).pipe(
            Effect.flatMap((nextRuntime) =>
              Effect.gen(function* () {
                // The JSONL is authoritative at the ownership boundary. A
                // terminal turn can finish while graceful shutdown is pending,
                // so replace the presence journal with a bounded SDK snapshot.
                const authoritativeLog = yield* nextRuntime.getLog();
                const entries = authoritativeLog.slice(-INITIAL_LOG_TAIL_ENTRIES);
                const seq = yield* Ref.updateAndGet(managed.seq, (value) => value + 1);
                const reset: Extract<WireEvent, { t: "log_reset" }> = {
                  t: "log_reset",
                  seq,
                  entries,
                  ...(entries.length < authoritativeLog.length ? { hasMoreBefore: true } : {}),
                };
                yield* store.replaceEventJournal(id, reset);
                const nextManaged = yield* buildManagedSession(id, nextRuntime, managed.generation + 1);
                return { nextRuntime, nextManaged };
              }).pipe(Effect.onError(() => nextRuntime.close())),
            ),
          ),
        );

        if (replacement._tag === "Left") {
          yield* Effect.logError("session_background_resume_failed").pipe(
            Effect.annotateLogs({ session_id: id, reason: String(replacement.left) }),
          );
          yield* publishStatus(managed, id, "error");
          yield* clearIdleEviction(managed);
          yield* Fiber.interrupt(managed.pumpFiber);
          yield* managed.runtime.close();
          yield* removeManagedIfCurrent(id, managed);
          yield* PubSub.shutdown(managed.pubsub);
          return;
        }

        const installed = yield* Ref.modify(sessions, (all) => {
          const found = HashMap.get(all, id);
          return Option.isSome(found) && found.value === managed
            ? [true, HashMap.set(all, id, replacement.right.nextManaged)] as const
            : [false, all] as const;
        });
        if (!installed) {
          yield* Fiber.interrupt(replacement.right.nextManaged.pumpFiber);
          yield* replacement.right.nextRuntime.close();
          yield* PubSub.shutdown(replacement.right.nextManaged.pubsub);
          return;
        }

        yield* scheduleIdleEviction(id, replacement.right.nextManaged);
        yield* clearIdleEviction(managed);
        yield* Fiber.interrupt(managed.pumpFiber);
        yield* managed.runtime.close();
        // Completing old subscriptions makes clients reconnect to the same
        // logical id and receive a fresh hello with durable capabilities.
        yield* PubSub.shutdown(managed.pubsub);
        yield* Effect.logInfo("session_background_handoff_completed").pipe(
          Effect.annotateLogs({
            session_id: id,
            generation: managed.generation + 1,
          }),
        );
      }));
    });

  const reattachOne = (
    id: string,
  ): Effect.Effect<ManagedSession, PiError | SessionNotFound> =>
    Effect.gen(function* () {
      const storedOpt = yield* store.getSession(id);
      if (Option.isNone(storedOpt)) {
        return yield* Effect.fail(new SessionNotFound({ id }));
      }
      const storedRecord = storedOpt.value;
      // Presence rows should be removed at startup/disconnect and can never be
      // resumed as a second writer if their owner is gone.
      if (storedRecord.lifecycle === "presence") {
        return yield* Effect.fail(new SessionNotFound({ id }));
      }
      const storedMeta = toSessionMeta(storedRecord);

      const runtime = yield* durableRuntimes.resume(storedRecord);
      if (runtime.patchSession) {
        yield* Effect.ignoreLogged(runtime.patchSession({ title: storedMeta.title }));
      }
      const ms = yield* buildManagedSession(id, runtime);
      yield* Ref.update(sessions, HashMap.set(id, ms));
      return ms;
    });

  const lookupOrReattach = (
    id: string,
  ): Effect.Effect<ManagedSession, PiError | SessionNotFound> =>
    Effect.gen(function* () {
      const map = yield* Ref.get(sessions);
      const existing = HashMap.get(map, id);
      if (Option.isSome(existing)) return existing.value;

      const ours = yield* Deferred.make<
        ManagedSession,
        PiError | SessionNotFound
      >();
      const leader = yield* Ref.modify(reattachInFlight, (m): ReattachDecision =>
        Option.match(HashMap.get(m, id), {
          onNone: (): ReattachDecision => [ours, HashMap.set(m, id, ours)],
          onSome: (existing): ReattachDecision => [existing, m],
        }),
      );

      if (leader !== ours) return yield* Deferred.await(leader);

      return yield* reattachOne(id).pipe(
        Effect.onExit((exit) =>
          Ref.update(reattachInFlight, HashMap.remove(id)).pipe(
            Effect.andThen(Deferred.done(ours, exit)),
          ),
        ),
      );
    });

  const list = (filter?: { archived?: boolean }) =>
    Effect.gen(function* () {
      const records = yield* store.listSessions(filter);
      const live = yield* Ref.get(sessions);
      return yield* Effect.forEach(records, (record) =>
        Option.match(HashMap.get(live, record.id), {
          onNone: () => Effect.succeed(toSessionMeta(record)),
          onSome: (managed) => Ref.get(managed.meta),
        }),
      );
    });

  const get = (id: string) =>
    Effect.gen(function* () {
      const live = HashMap.get(yield* Ref.get(sessions), id);
      if (Option.isSome(live)) return Option.some(yield* Ref.get(live.value.meta));
      return Option.map(yield* store.getSession(id), toSessionMeta);
    });

  const subscribe = (id: string, fromCursor: number) =>
    Stream.unwrapScoped(
      Effect.gen(function* () {
        const ms = yield* lookupOrReattach(id);
        const liveQueue = yield* PubSub.subscribe(ms.pubsub);
        const currentMeta = yield* Ref.get(ms.meta);
        const cursorAtSubscribe = yield* Ref.get(ms.seq);
        const pending = yield* Ref.get(ms.pendingSends);

        const helloEvent: WireEvent = {
          t: "hello",
          seq: 0,
          session: currentMeta,
          cursor: cursorAtSubscribe,
        };
        const queueSnapshot = runtimeSupports(ms.runtime, "queue") ? [queueEvent(0, pending)] : [];

        let replayEvents: WireEvent[];
        const prunedThrough = yield* store.prunedThrough(id);
        if (fromCursor < 0 || fromCursor > cursorAtSubscribe || fromCursor < prunedThrough) {
          const page = yield* retainedLogTail(id, pending, currentMeta.status);
          replayEvents = [{
            t: "log_reset",
            seq: cursorAtSubscribe,
            entries: page.entries,
            hasMoreBefore: page.hasMoreBefore,
          }];
        } else {
          const storedEvents = yield* store.loadEventsAfter(id, fromCursor);
          replayEvents = storedEvents.filter((event) => event.seq <= cursorAtSubscribe);
        }

        const liveStream = pipe(
          Stream.fromQueue(liveQueue),
          Stream.filter((e) => e.seq > cursorAtSubscribe),
        );

        yield* clearIdleEviction(ms);
        yield* Ref.update(ms.subscribers, (n) => n + 1);

        return pipe(
          Stream.fromIterable<WireEvent>([helloEvent, ...replayEvents, ...queueSnapshot]),
          Stream.concat(liveStream),
          Stream.ensuring(
            Ref.update(ms.subscribers, (n) => Math.max(0, n - 1)).pipe(
              Effect.andThen(scheduleIdleEviction(id, ms)),
            ),
          ),
        );
      }),
    );

  const send = (
    id: string,
    text: string,
    mode: SendMode,
    images: ImageContent[] | undefined,
    clientId: string,
  ) =>
    Effect.gen(function* () {
      const ms = yield* lookupOrReattach(id);
      return yield* withActiveRuntime(ms, (runtime) => Effect.gen(function* () {
        if (images && images.length > 0 && !runtime.acceptsImages) {
          return yield* Effect.fail(unsupported("images"));
        }

        // Atomically claim this clientId. A duplicate is a send that already landed
        // (the original user_message is the ack) — drop it before any work. Checking and
        // claiming in one Ref.modify closes the retry-vs-ack race: without it, two
        // concurrent sends with the same clientId both read an empty set and each mint a
        // fresh userMessageId, double-posting the turn to pi. The claim is released below
        // on any path that fails before the event is durably appended.
        const duplicate = yield* Ref.modify(ms.seenClientIds, (seen) =>
          seen.includes(clientId)
            ? ([true, seen] as const)
            : ([false, [...seen, clientId].slice(-MAX_SEEN_CLIENT_IDS)] as const),
        );
        if (duplicate) return;
        const releaseClaim = Ref.update(ms.seenClientIds, (seen) => seen.filter((c) => c !== clientId));

        const currentMeta = yield* Ref.get(ms.meta);
        const managesQueue = runtimeSupports(runtime, "queue");
        const compacting = (yield* Ref.get(ms.compacting)) ||
          (runtime.isCompacting ? (yield* runtime.isCompacting()) : false);
        const queued = compacting || currentMeta.status === "thinking" || currentMeta.status === "tool";
        if (managesQueue && queued && (yield* Ref.get(ms.pendingSends)).length >= MAX_PENDING_SENDS) {
          yield* releaseClaim;
          return yield* Effect.fail(new PiError({ message: `send queue full (${MAX_PENDING_SENDS})` }));
        }
        const userMessageId = randomUUIDv7();
        const at = Date.now();
        const seq = yield* Ref.updateAndGet(ms.seq, (n) => n + 1);
        const baseEntry = {
          kind: "user" as const,
          id: userMessageId,
          at,
          text,
          images,
          clientId,
        };
        const entry: UserMessage = queued ? { ...baseEntry, queued: true, mode } : baseEntry;
        const userEvent: WireEvent = { t: "user_message", seq, entry };
        // Release the claim if the event never lands, so a legitimate retry isn't swallowed.
        yield* store.appendEvent(id, userEvent).pipe(Effect.tapError(() => releaseClaim));
        yield* PubSub.publish(ms.pubsub, userEvent);

        if (managesQueue && compacting) {
          const pendingSend: PendingSend = {
            id: userMessageId,
            at,
            text,
            images,
            mode,
            phase: "held_for_compaction",
          };
          yield* Ref.update(ms.pendingSends, (pending) => [...pending, pendingSend]);
          yield* publishQueueSnapshot(ms, id);
          return;
        }

        if (managesQueue && queued) {
          const pendingSend: PendingSend = {
            id: userMessageId,
            at,
            text,
            images,
            mode,
            phase: "sdk_queue",
          };
          yield* Ref.update(ms.pendingSends, (pending) => [...pending, pendingSend]);
          yield* publishQueueSnapshot(ms, id);
          yield* runtime.send(text, mode, images, clientId).pipe(
            Effect.catchAll((error) =>
              Ref.update(ms.pendingSends, (pending) => pending.filter((message) => message.id !== userMessageId)).pipe(
                Effect.andThen(publishQueueSnapshot(ms, id)),
                Effect.andThen(Effect.fail(error)),
              ),
            ),
          );
          return;
        }

        yield* runtime.send(text, mode, images, clientId);
      }));
    });

  const interrupt = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) =>
      withActiveRuntime(ms, (runtime) =>
        runtime.interrupt ? runtime.interrupt() : Effect.fail(unsupported("interrupt")),
      ),
    );

  const requestBackground = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) =>
      withActiveRuntime(ms, (runtime) =>
        runtime.requestBackground
          ? runtime.requestBackground()
          : Effect.fail(new PiError({ message: "background handoff is not available for this session" })),
      ),
    );

  const releaseToTerminal = (selector: string): Effect.Effect<
    TerminalSessionRelease,
    PiError | SessionNotFound
  > =>
    Effect.gen(function* () {
      const normalized = selector.trim().toLowerCase();
      const records = yield* store.listSessions();
      const exact = records.find((record) => record.id === selector);
      const matches = exact ? [exact] : records.filter((record) =>
        record.id.startsWith(selector) || record.title.trim().toLowerCase() === normalized
      );
      if (matches.length === 0) return yield* Effect.fail(new SessionNotFound({ id: selector }));
      if (matches.length > 1) {
        return yield* Effect.fail(new PiError({
          message: `session selector is ambiguous: ${selector}`,
        }));
      }
      const id = matches[0]!.id;
      const managed = yield* lookupOrReattach(id);
      return yield* managed.operationGate.withPermits(1)(Effect.gen(function* () {
        if (Option.isSome(yield* Ref.get(managed.handoff))) {
          return yield* Effect.fail(handoffInProgress());
        }
        const runtime = managed.runtime;
        if (runtime.lifecycle.kind !== "durable") {
          return yield* Effect.fail(new PiError({ message: "session is already terminal-owned" }));
        }
        const [meta, compacting, pending, stored] = yield* Effect.all([
          Ref.get(managed.meta),
          Ref.get(managed.compacting),
          Ref.get(managed.pendingSends),
          store.getSession(id),
        ]);
        if (Option.isNone(stored)) return yield* Effect.fail(new SessionNotFound({ id }));
        if (meta.status !== "idle" || compacting || pending.length > 0) {
          return yield* Effect.fail(new PiError({
            message: "session must be fully idle before returning to the terminal",
          }));
        }
        if (!runtime.getStats) return yield* Effect.fail(unsupported("stats"));
        const stats = yield* runtime.getStats();
        if (!stats.sessionFile) {
          return yield* Effect.fail(new PiError({ message: "ephemeral sessions cannot return to the terminal" }));
        }
        const binding = yield* Effect.tryPromise({
          try: () => parsePiSessionBinding(stats.sessionFile!, stored.value.runtimeSessionId),
          catch: (error) => error instanceof PiError
            ? error
            : new PiError({ message: String(error), cause: error }),
        });

        // No terminal process is started until this call returns. Closing the
        // SDK before deleting Pico's durable record therefore leaves every
        // crash point single-writer and recoverable from Pi's JSONL.
        yield* clearIdleEviction(managed);
        yield* Fiber.interrupt(managed.pumpFiber);
        yield* runtime.close();
        yield* removeManagedIfCurrent(id, managed);
        yield* store.deleteSession(id);
        yield* PubSub.shutdown(managed.pubsub);

        const leaseId = randomUUIDv7();
        const expiresAt = Date.now() + TERMINAL_RELEASE_LEASE_MS;
        yield* Ref.update(
          terminalReleaseLeases,
          HashMap.set(leaseId, { id, runtimeSessionId: binding.runtimeSessionId, expiresAt }),
        );
        setTimeout(() => {
          void Runtime.runPromise(timerRuntime)(
            Ref.update(terminalReleaseLeases, (leases) => HashMap.remove(leases, leaseId)),
          );
        }, TERMINAL_RELEASE_LEASE_MS).unref();

        return {
          id,
          leaseId,
          runtimeSessionId: binding.runtimeSessionId,
          runtimeSessionFile: binding.runtimeSessionFile,
          cwd: meta.cwd,
          title: meta.title,
        };
      }));
    });

  const consumeTerminalRelease = (leaseId: string, id: string): Effect.Effect<string, PiError> =>
    Ref.modify<HashMap.HashMap<string, TerminalReleaseLease>, Option.Option<string>>(
      terminalReleaseLeases,
      (leases) => {
        const found = HashMap.get(leases, leaseId);
        const remaining = HashMap.remove(leases, leaseId);
        return Option.isSome(found) && found.value.id === id && found.value.expiresAt >= Date.now()
          ? [Option.some(found.value.runtimeSessionId), remaining]
          : [Option.none(), remaining];
      },
    ).pipe(
      Effect.flatMap((runtimeSessionId) => Option.isSome(runtimeSessionId)
        ? Effect.succeed(runtimeSessionId.value)
        : Effect.fail(new PiError({ message: "terminal reclaim lease is invalid or expired" }))),
    );

  const extensionUiResponse = (
    id: string,
    requestId: string,
    value: ExtensionUiResponseValue,
  ) =>
    Effect.flatMap(lookupOrReattach(id), (ms) =>
      withActiveRuntime(ms, (runtime) =>
        runtime.extensionUiResponse
          ? runtime.extensionUiResponse(requestId, value)
          : Effect.fail(unsupported("extension-ui")),
      ),
    );


  const compact = (id: string, instructions?: string) =>
    Effect.gen(function* () {
      const ms = yield* lookupOrReattach(id);
      return yield* withActiveRuntime(ms, (runtime) => Effect.gen(function* () {
        if (!runtime.compact) return yield* Effect.fail(unsupported("compact"));
        if ((yield* Ref.get(ms.compacting)) ||
          (runtime.isCompacting ? (yield* runtime.isCompacting()) : false)) return;
        yield* Ref.set(ms.compacting, true);
        yield* runtime.compact(instructions).pipe(
          Effect.onExit(() =>
            Ref.get(ms.compacting).pipe(
              Effect.flatMap((stillCompacting) => stillCompacting ? Ref.set(ms.compacting, false) : Effect.void),
            ),
          ),
        );
      }));
    });

  const exportHtml = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) =>
      withActiveRuntime(ms, (runtime) =>
        runtime.exportHtml ? runtime.exportHtml() : Effect.fail(unsupported("export")),
      ),
    );

  const listCommands = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) =>
      withActiveRuntime(ms, (runtime) =>
        runtime.listCommands ? runtime.listCommands() : Effect.fail(unsupported("commands")),
      ),
    );

  const getQueue = (id: string) =>
    Effect.gen(function* () {
      const ms = yield* lookupOrReattach(id);
      return yield* withActiveRuntime(ms, (runtime) => Effect.gen(function* () {
        if (!runtimeSupports(runtime, "queue")) return yield* Effect.fail(unsupported("queue"));
        return projectQueue(yield* Ref.get(ms.pendingSends));
      }));
    });

  const clearQueue = (id: string) =>
    Effect.gen(function* () {
      const ms = yield* lookupOrReattach(id);
      return yield* withActiveRuntime(ms, (runtime) => Effect.gen(function* () {
        if (!runtime.clearQueue) return yield* Effect.fail(unsupported("queue"));
        const pending = yield* Ref.get(ms.pendingSends);
        yield* Ref.set(ms.pendingSends, []);
        yield* runtime.clearQueue();
        for (const message of pending) yield* publishUserMessageRemoved(ms, id, message.id);
        yield* publishQueueSnapshot(ms, id);
        return { queued: [] };
      }));
    });

  const removeQueued = (id: string, messageId: string) =>
    Effect.gen(function* () {
      const ms = yield* lookupOrReattach(id);
      return yield* withActiveRuntime(ms, (runtime) => Effect.gen(function* () {
        if (!runtime.clearQueue) return yield* Effect.fail(unsupported("queue"));
        const pending = yield* Ref.get(ms.pendingSends);
        const removed = pending.find((message) => message.id === messageId);
        if (!removed) return projectQueue(pending);

        const next = pending.filter((message) => message.id !== messageId);
        yield* Ref.set(ms.pendingSends, next);
        if (removed.phase === "sdk_queue") yield* resyncSdkQueue(ms, next);
        yield* publishUserMessageRemoved(ms, id, messageId);
        yield* publishQueueSnapshot(ms, id);
        return projectQueue(next);
      }));
    });

  const getSettings = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) =>
      withActiveRuntime(ms, (runtime) =>
        runtime.getSettings ? runtime.getSettings() : Effect.fail(unsupported("settings")),
      ),
    );

  const patchSetting = (id: string, key: string, value: string | boolean) =>
    Effect.flatMap(lookupOrReattach(id), (ms) =>
      withActiveRuntime(ms, (runtime) =>
        runtime.patchSetting ? runtime.patchSetting(key, value) : Effect.fail(unsupported("settings")),
      ),
    );

  const getStats = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) =>
      withActiveRuntime(ms, (runtime) =>
        runtime.getStats
          ? Effect.map(runtime.getStats(), (stats) => ({ ...stats, sessionId: id }))
          : Effect.fail(unsupported("stats")),
      ),
    );

  const getLogBefore = (id: string, beforeId: string, limit?: number) =>
    Effect.gen(function* () {
      const ms = yield* lookupOrReattach(id);
      const [pending, meta] = yield* Effect.all([Ref.get(ms.pendingSends), Ref.get(ms.meta)]);
      const retained = yield* retainedLogEntries(id, pending, meta.status);
      const retainedIndex = retained.entries.findIndex((entry) => entry.id === beforeId);

      if (retainedIndex > 0) {
        const page = pageBefore(retained.entries, beforeId, limit);
        return { ...page, hasMoreBefore: page.hasMoreBefore || retained.prunedThrough > 0 };
      }

      if (retained.prunedThrough <= 0) return { entries: [], hasMoreBefore: false };

      return yield* withActiveRuntime(ms, (runtime) => Effect.gen(function* () {
        if (!runtime.getLog) return { entries: [], hasMoreBefore: false };
        const entries = withPendingUserEntries(yield* runtime.getLog(), pending);
        return pageBefore(entries, beforeId, limit);
      }));
    });

  const getTree = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) =>
      withActiveRuntime(ms, (runtime) =>
        runtime.getTree ? runtime.getTree() : Effect.fail(unsupported("tree")),
      ),
    );

  const navigateTree = (id: string, entryId: string, summarize?: boolean) =>
    Effect.flatMap(lookupOrReattach(id), (ms) =>
      withActiveRuntime(ms, (runtime) =>
        runtime.navigateTree
          ? runtime.navigateTree(entryId, summarize)
          : Effect.fail(unsupported("tree")),
      ),
    );

  const patch = (
    id: string,
    p: { title?: string; archived?: boolean },
  ): Effect.Effect<SessionMeta, PiError | SessionNotFound> =>
    Effect.gen(function* () {
      const existing = yield* store.getSession(id);
      if (Option.isNone(existing)) {
        return yield* Effect.fail(new SessionNotFound({ id }));
      }

      const live = HashMap.get(yield* Ref.get(sessions), id);
      const applyPatch = (managed?: ManagedSession, runtime?: SessionRuntime) => Effect.gen(function* () {
        const current = managed ? yield* store.getSession(id) : existing;
        if (Option.isNone(current)) return yield* Effect.fail(new SessionNotFound({ id }));
        if (current.value.lifecycle === "presence" && p.archived !== undefined) {
          return yield* Effect.fail(unsupported("archive"));
        }
        if (p.title !== undefined && runtime) {
          if (!runtime.patchSession) return yield* Effect.fail(unsupported("rename"));
          yield* runtime.patchSession({ title: p.title });
        }

        const nextRecord = {
          ...current.value,
          ...(p.title !== undefined ? { title: p.title } : {}),
          ...(p.archived !== undefined ? { archived: p.archived } : {}),
          updatedAtMs: Date.now(),
        };
        const next = toSessionMeta(nextRecord);
        yield* store.updateSession(id, nextRecord);
        if (!managed || !runtime) return next;

        yield* Ref.set(managed.meta, {
          ...next,
          capabilities: [...capabilitiesForRuntime(runtime)],
        });
        return yield* Ref.get(managed.meta);
      });

      return Option.isSome(live)
        ? yield* withActiveRuntime(live.value, (runtime) => applyPatch(live.value, runtime))
        : yield* applyPatch();
    });

  const remove = (id: string): Effect.Effect<void, SessionNotFound> =>
    Effect.gen(function* () {
      const existing = yield* store.getSession(id);
      if (Option.isNone(existing)) {
        return yield* Effect.fail(new SessionNotFound({ id }));
      }

      const live = HashMap.get(yield* Ref.get(sessions), id);
      if (Option.isSome(live)) {
        const removed = yield* live.value.operationGate.withPermits(1)(Effect.gen(function* () {
          const current = HashMap.get(yield* Ref.get(sessions), id);
          if (Option.isNone(current) || current.value !== live.value) return false;
          yield* clearIdleEviction(live.value);
          yield* Fiber.interrupt(live.value.pumpFiber);
          yield* live.value.runtime.close();
          yield* removeManagedIfCurrent(id, live.value);
          yield* PubSub.shutdown(live.value.pubsub);
          yield* store.deleteSession(id);
          return true;
        }));
        // A handoff may have swapped generations while remove waited for the
        // old operation gate. Retry against the current binding in that case.
        if (!removed) return yield* Effect.suspend(() => remove(id));
        return;
      }
      yield* store.deleteSession(id);
    });

  const closeAll = () =>
    Effect.gen(function* () {
      const map = yield* Ref.getAndSet(sessions, HashMap.empty<string, ManagedSession>());
      yield* Effect.forEach(HashMap.values(map), (live) =>
        live.operationGate.withPermits(1)(
          Effect.all([
            clearIdleEviction(live),
            Fiber.interrupt(live.pumpFiber),
            live.runtime.close(),
            PubSub.shutdown(live.pubsub),
          ], { discard: true }).pipe(Effect.ignoreLogged),
        ),
      );
    });

  return SessionManager.of({
    create,
    attachPresence,
    detachPresence,
    preparePresenceHandoff,
    cancelPresenceHandoff,
    completePresenceHandoff,
    list,
    get,
    subscribe,
    send,
    interrupt,
    requestBackground,
    releaseToTerminal,
    consumeTerminalRelease,
    extensionUiResponse,
    compact,
    exportHtml,
    listCommands,
    getQueue,
    clearQueue,
    removeQueued,
    getSettings,
    patchSetting,
    getStats,
    getLogBefore,
    getTree,
    navigateTree,
    patch,
    remove,
    closeAll,
  });
});

// Scoped so the server scope tears sessions down on shutdown (closes pi, interrupts pump fibers).
export const SessionManagerLive = Layer.scoped(
  SessionManager,
  Effect.tap(make, (manager) => Effect.addFinalizer(() => manager.closeAll())),
);
