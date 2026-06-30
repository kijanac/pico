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
import { PiClient, type PiSession, type PiEmission, type ExportedHtml, PiError } from "./pi.ts";
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
  WireEvent,
} from "@pico/protocol";
import { Store } from "./store.ts";
import { toSessionMeta } from "./session-record.ts";
import { SessionNotFound } from "./errors.ts";

interface PendingSend extends QueuedMessage {
  readonly at: number;
  readonly phase: "held_for_compaction" | "sdk_queue";
  readonly images?: ImageContent[];
}

interface ManagedSessionState {
  readonly meta: Ref.Ref<SessionMeta>;
  readonly pi: PiSession;
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
      images?: ImageContent[],
      clientId?: string,
    ) => Effect.Effect<void, PiError | SessionNotFound>;
    readonly interrupt: (
      id: string,
    ) => Effect.Effect<void, PiError | SessionNotFound>;
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
    ) => Effect.Effect<SessionMeta, SessionNotFound>;
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

const make = Effect.gen(function* () {
  const pi = yield* PiClient;
  const store = yield* Store;
  const sessions = yield* Ref.make(HashMap.empty<string, ManagedSession>());
  // Runs the idle-eviction timer on the host runtime (its logger config) instead of the Effect default.
  const timerRuntime = yield* Effect.runtime<never>();

  const reattachInFlight = yield* Ref.make(
    HashMap.empty<
      string,
      Deferred.Deferred<ManagedSession, PiError | SessionNotFound>
    >(),
  );

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
      yield* Ref.update(ms.queueEventsToIgnore, (count) => count + 1 + sdkQueued.length);
      yield* ms.pi.clearQueue();

      const meta = yield* Ref.get(ms.meta);
      if (meta.status !== "thinking" && meta.status !== "tool") return;

      for (const message of sdkQueued) {
        yield* ms.pi.send(message.text, message.mode, message.images);
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

      yield* ms.pi.flushAfterCompaction(messagesForSdk, opts).pipe(
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
      yield* Ref.set(ms.idleEvictionTimer, null);
      if (!(yield* isEvictable(ms))) return;

      yield* Effect.logInfo(`[session] evict idle session=${sessionId}`);
      yield* Fiber.interrupt(ms.pumpFiber);
      yield* ms.pi.close();
      yield* Ref.update(sessions, (m) => HashMap.remove(m, sessionId));
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
      ms.pi.events,
      Stream.runForEach((emission: PiEmission) =>
        Effect.gen(function* () {
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
            // A decode mismatch (PiEmission drifting from WireEvent) must not throw:
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
              yield* flushCompactionQueue(ms, sessionId, { willRetry: event.entry.willRetry });
              yield* scheduleIdleEviction(sessionId, ms);
            }
          } else if (event.t === "status" && (event.status === "idle" || event.status === "error")) {
            yield* scheduleIdleEviction(sessionId, ms);
          } else if (event.t === "status") {
            yield* clearIdleEviction(ms);
          }
        }),
      ),
    );

  const buildManagedSession = (
    sessionId: string,
    piSession: PiSession,
  ): Effect.Effect<ManagedSession, PiError> =>
    Effect.gen(function* () {
      const state: ManagedSessionState = {
        meta: yield* Ref.make(piSession.meta),
        pi: piSession,
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
      const piSession = yield* pi.create({
        cwd: opts.cwd,
        title: opts.title,
      });
      const meta = piSession.meta;

      yield* store.insertSession({
        id: meta.id,
        title: meta.title,
        cwd: meta.cwd,
        status: meta.status,
        updatedAtMs: Date.parse(meta.updatedAt),
        tokens: meta.tokens,
        costUsd: meta.costUsd,
        archived: meta.archived,
      });

      const ms = yield* buildManagedSession(meta.id, piSession);
      yield* Ref.update(sessions, HashMap.set(meta.id, ms));
      return meta;
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
      const storedMeta = toSessionMeta(storedRecord);

      const piSession = yield* pi.resume(storedRecord);
      yield* Effect.ignoreLogged(piSession.patchSession({ title: storedMeta.title }));
      const ms = yield* buildManagedSession(id, piSession);
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
    Effect.map(store.listSessions(filter), (records) => records.map(toSessionMeta));

  const get = (id: string) => Effect.map(store.getSession(id), Option.map(toSessionMeta));

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
        const queueSnapshotEvent = queueEvent(0, pending);

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
          Stream.fromIterable<WireEvent>([helloEvent, ...replayEvents, queueSnapshotEvent]),
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
    images?: ImageContent[],
    clientId?: string,
  ) =>
    Effect.gen(function* () {
      const ms = yield* lookupOrReattach(id);
      // Duplicate of a send that already landed; the original user_message is the ack.
      if (clientId && (yield* Ref.get(ms.seenClientIds)).includes(clientId)) return;
      const currentMeta = yield* Ref.get(ms.meta);
      const compacting = (yield* Ref.get(ms.compacting)) || (yield* ms.pi.isCompacting());
      const queued = compacting || currentMeta.status === "thinking" || currentMeta.status === "tool";
      if (queued && (yield* Ref.get(ms.pendingSends)).length >= MAX_PENDING_SENDS) {
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
      yield* store.appendEvent(id, userEvent);
      if (clientId) {
        yield* Ref.update(ms.seenClientIds, (seen) => [...seen, clientId].slice(-MAX_SEEN_CLIENT_IDS));
      }
      yield* PubSub.publish(ms.pubsub, userEvent);

      if (compacting) {
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

      if (queued) {
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
        yield* ms.pi.send(text, mode, images).pipe(
          Effect.catchAll((error) =>
            Ref.update(ms.pendingSends, (pending) => pending.filter((message) => message.id !== userMessageId)).pipe(
              Effect.andThen(publishQueueSnapshot(ms, id)),
              Effect.andThen(Effect.fail(error)),
            ),
          ),
        );
        return;
      }

      yield* ms.pi.send(text, mode, images);
    });

  const interrupt = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.interrupt());

  const extensionUiResponse = (
    id: string,
    requestId: string,
    value: ExtensionUiResponseValue,
  ) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.extensionUiResponse(requestId, value));


  const compact = (id: string, instructions?: string) =>
    Effect.gen(function* () {
      const ms = yield* lookupOrReattach(id);
      if ((yield* Ref.get(ms.compacting)) || (yield* ms.pi.isCompacting())) return;
      yield* Ref.set(ms.compacting, true);
      yield* ms.pi.compact(instructions).pipe(
        Effect.onExit(() =>
          Ref.get(ms.compacting).pipe(
            Effect.flatMap((stillCompacting) => stillCompacting ? Ref.set(ms.compacting, false) : Effect.void),
          ),
        ),
      );
    });

  const exportHtml = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.exportHtml());

  const listCommands = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.listCommands());

  const getQueue = (id: string) =>
    Effect.gen(function* () {
      const ms = yield* lookupOrReattach(id);
      return projectQueue(yield* Ref.get(ms.pendingSends));
    });

  const clearQueue = (id: string) =>
    Effect.gen(function* () {
      const ms = yield* lookupOrReattach(id);
      const pending = yield* Ref.get(ms.pendingSends);
      yield* Ref.set(ms.pendingSends, []);
      yield* ms.pi.clearQueue();
      for (const message of pending) yield* publishUserMessageRemoved(ms, id, message.id);
      yield* publishQueueSnapshot(ms, id);
      return { queued: [] };
    });

  const removeQueued = (id: string, messageId: string) =>
    Effect.gen(function* () {
      const ms = yield* lookupOrReattach(id);
      const pending = yield* Ref.get(ms.pendingSends);
      const removed = pending.find((message) => message.id === messageId);
      if (!removed) return projectQueue(pending);

      const next = pending.filter((message) => message.id !== messageId);
      yield* Ref.set(ms.pendingSends, next);
      if (removed.phase === "sdk_queue") yield* resyncSdkQueue(ms, next);
      yield* publishUserMessageRemoved(ms, id, messageId);
      yield* publishQueueSnapshot(ms, id);
      return projectQueue(next);
    });

  const getSettings = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.getSettings());

  const patchSetting = (id: string, key: string, value: string | boolean) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.patchSetting(key, value));

  const getStats = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.getStats());

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

      const entries = withPendingUserEntries(yield* ms.pi.getLog(), pending);
      return pageBefore(entries, beforeId, limit);
    });

  const getTree = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.getTree());

  const navigateTree = (id: string, entryId: string, summarize?: boolean) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.navigateTree(entryId, summarize));

  const patch = (
    id: string,
    p: { title?: string; archived?: boolean },
  ): Effect.Effect<SessionMeta, SessionNotFound> =>
    Effect.gen(function* () {
      const existing = yield* store.getSession(id);
      if (Option.isNone(existing))
        return yield* Effect.fail(new SessionNotFound({ id }));

      const nextRecord = {
        ...existing.value,
        ...(p.title !== undefined ? { title: p.title } : {}),
        ...(p.archived !== undefined ? { archived: p.archived } : {}),
        updatedAtMs: Date.now(),
      };
      const next = toSessionMeta(nextRecord);
      yield* store.updateSession(id, nextRecord);

      const map = yield* Ref.get(sessions);
      const live = HashMap.get(map, id);
      if (Option.isSome(live)) {
        yield* Ref.set(live.value.meta, next);
        if (p.title !== undefined) {
          yield* Effect.ignoreLogged(live.value.pi.patchSession({ title: p.title }));
        }
      }
      return next;
    });

  const remove = (id: string): Effect.Effect<void, SessionNotFound> =>
    Effect.gen(function* () {
      const existing = yield* store.getSession(id);
      if (Option.isNone(existing))
        return yield* Effect.fail(new SessionNotFound({ id }));

      const map = yield* Ref.get(sessions);
      const live = HashMap.get(map, id);
      if (Option.isSome(live)) {
        yield* clearIdleEviction(live.value);
        yield* Fiber.interrupt(live.value.pumpFiber);
        yield* live.value.pi.close();
        yield* Ref.update(sessions, (m) => HashMap.remove(m, id));
      }
      yield* store.deleteSession(id);
    });

  const closeAll = () =>
    Effect.gen(function* () {
      const map = yield* Ref.get(sessions);
      yield* Effect.forEach(HashMap.values(map), (live) =>
        Effect.all([
          clearIdleEviction(live),
          Fiber.interrupt(live.pumpFiber),
          live.pi.close(),
        ], { discard: true }).pipe(Effect.ignoreLogged),
      );
      yield* Ref.set(sessions, HashMap.empty<string, ManagedSession>());
    });

  return SessionManager.of({
    create,
    list,
    get,
    subscribe,
    send,
    interrupt,
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
