/**
 * Session manager — durable via Store, live via PubSub.
 *
 * Each managed session:
 *   - has its meta row persisted in the Store (and reflected in a Ref for
 *     fast in-process reads)
 *   - has its event log persisted via Store.appendEvent (no in-memory cap)
 *   - publishes live events to subscribers via a PubSub
 *
 * Subscribers replay via Store.loadEventsAfter(cursor) then attach to the
 * PubSub for live deltas, with a small dedup window to handle the race
 * between "captured snapshot" and "subscribed to live".
 */
import {
  Context,
  Effect,
  Deferred,
  Layer,
  PubSub,
  Ref,
  Stream,
  Fiber,
  HashMap,
  Option,
  pipe,
} from "effect";
import { PiClient, type PiSession, type PiEmission, PiError } from "./pi.ts";
import { parseWireEvent } from "@pi-mobile/protocol";
import type {
  AuthLoginJob,
  AuthProvider,
  ModelSummary,
  PermissionChoice,
  SessionMeta,
  SessionSettings,
  SessionSettingsPatch,
  SessionStats,
  SessionTree,
  WireEvent,
} from "@pi-mobile/protocol";
import { Store } from "./store.ts";

interface ManagedSessionState {
  readonly meta: Ref.Ref<SessionMeta>;
  readonly pi: PiSession;
  readonly pubsub: PubSub.PubSub<WireEvent>;
  readonly seq: Ref.Ref<number>;
  /**
   * In-memory buffers for streaming assistant messages, keyed by message id.
   * Per-token deltas accumulate here during streaming and are flushed to the
   * Store as a single coalesced row when the message ends. Live subscribers
   * still see the per-token deltas via the PubSub.
   */
  readonly deltaBuffers: Ref.Ref<Map<string, { text: string; seq: number }>>;
}

interface ManagedSession extends ManagedSessionState {
  readonly pumpFiber: Fiber.RuntimeFiber<void, PiError>;
}

export class SessionManager extends Context.Tag("SessionManager")<
  SessionManager,
  {
    readonly create: (opts: {
      cwd: string;
      title?: string;
      branch?: string;
    }) => Effect.Effect<SessionMeta, PiError>;
    readonly list: () => Effect.Effect<ReadonlyArray<SessionMeta>>;
    readonly get: (id: string) => Effect.Effect<Option.Option<SessionMeta>>;
    readonly subscribe: (
      id: string,
      fromCursor: number,
    ) => Stream.Stream<WireEvent, PiError | SessionNotFound>;
    readonly send: (
      id: string,
      text: string,
      mode?: import("./pi.ts").SendMode,
      images?: import("./pi.ts").SendImage[],
    ) => Effect.Effect<void, PiError | SessionNotFound>;
    readonly interrupt: (
      id: string,
    ) => Effect.Effect<void, PiError | SessionNotFound>;
    readonly approve: (
      id: string,
      msgId: string,
      choice: PermissionChoice,
    ) => Effect.Effect<void, PiError | SessionNotFound>;
    readonly listModels: (
      id: string,
    ) => Effect.Effect<{ current?: ModelSummary; models: ModelSummary[] }, PiError | SessionNotFound>;
    readonly setModel: (
      id: string,
      provider: string,
      modelId: string,
    ) => Effect.Effect<void, PiError | SessionNotFound>;
    readonly compact: (
      id: string,
      instructions?: string,
    ) => Effect.Effect<void, PiError | SessionNotFound>;
    readonly listAuthProviders: (id: string) => Effect.Effect<{ providers: AuthProvider[] }, PiError | SessionNotFound>;
    readonly startAuthLogin: (id: string, providerId: string) => Effect.Effect<AuthLoginJob, PiError | SessionNotFound>;
    readonly getAuthLogin: (id: string, jobId: string) => Effect.Effect<AuthLoginJob, PiError | SessionNotFound>;
    readonly submitAuthLoginInput: (id: string, jobId: string, value: string) => Effect.Effect<AuthLoginJob, PiError | SessionNotFound>;
    readonly cancelAuthLogin: (id: string, jobId: string) => Effect.Effect<void, PiError | SessionNotFound>;
    readonly getSettings: (id: string) => Effect.Effect<SessionSettings, PiError | SessionNotFound>;
    readonly patchSettings: (
      id: string,
      patch: SessionSettingsPatch,
    ) => Effect.Effect<SessionSettings, PiError | SessionNotFound>;
    readonly getStats: (id: string) => Effect.Effect<SessionStats, PiError | SessionNotFound>;
    readonly getTree: (id: string) => Effect.Effect<SessionTree, PiError | SessionNotFound>;
    readonly navigateTree: (
      id: string,
      entryId: string,
      summarize?: boolean,
    ) => Effect.Effect<void, PiError | SessionNotFound>;
    /** Partial update — title and/or archived state. Returns the new meta. */
    readonly patch: (
      id: string,
      patch: { title?: string; archived?: boolean },
    ) => Effect.Effect<SessionMeta, SessionNotFound>;
    /** Hard delete. Live PiSession is disposed, events table is purged. */
    readonly remove: (
      id: string,
    ) => Effect.Effect<void, SessionNotFound>;
  }
>() {}

export { SessionNotFound } from "./errors.ts";
import { SessionNotFound } from "./errors.ts";

const make = Effect.gen(function* () {
  const pi = yield* PiClient;
  const store = yield* Store;
  // In-memory map only tracks LIVE sessions (ones with an active pi handle
  // in this bridge process). Sessions from previous runs live in the Store
  // but are not in this map until reattached.
  const sessions = yield* Ref.make(HashMap.empty<string, ManagedSession>());

  /**
   * Per-id leadership table for reattach. When a request arrives for a
   * dormant session, the first caller becomes the "leader" — it does
   * the actual `pi.resume` + ManagedSession build — and any concurrent
   * callers ("followers") await the leader's Deferred. After the
   * leader settles (success or failure), it removes its entry; future
   * calls hit the fast path (already-live) or start a fresh leader.
   *
   * Without this, two simultaneous WS connections to the same dormant
   * session would each spin up their own PiSession and race to insert
   * into `sessions`, leaking one of the two pi AgentSessions.
   */
  const reattachInFlight = yield* Ref.make(
    HashMap.empty<
      string,
      Deferred.Deferred<ManagedSession, PiError | SessionNotFound>
    >(),
  );

  /**
   * Pump pi emissions: stamp seq, persist, publish.
   *
   * Persistence is per-event with one exception: `assistant_delta` events
   * are buffered per message id and flushed as a single coalesced row when
   * the matching `assistant_end` arrives. This collapses ~50 rows per
   * message down to 1 — the SQLite `events` table now stores conversations
   * at roughly the same granularity as pi's own JSONL, instead of duplicating
   * every streamed token.
   *
   * Live subscribers still see per-token deltas via the PubSub. The trade-off:
   * a client that connects mid-stream (and resumes with a cursor older than
   * the in-progress message's start) won't see the prefix replayed — they'll
   * see live deltas from their attach point onwards. Acceptable for v0 given
   * partysocket reconnects in well under a second.
   */
  const startPump = (
    ms: ManagedSessionState,
    sessionId: string,
  ): Effect.Effect<void, PiError> =>
    pipe(
      ms.pi.events,
      Stream.runForEach((emission: PiEmission) =>
        Effect.gen(function* () {
          const seq = yield* Ref.updateAndGet(ms.seq, (n) => n + 1);
          const event = parseWireEvent({ ...emission, seq });

          // ── meta reflection ────────────────────────────────────────────
          if (event.t === "status") {
            yield* Ref.update(ms.meta, (m) => ({
              ...m,
              status: event.status,
              updatedAt: Date.now(),
            }));
            yield* store.updateSession(sessionId, {
              status: event.status,
              updatedAt: Date.now(),
            });
          } else if (event.t === "cost") {
            const patch = {
              tokens: { in: event.tokensIn, out: event.tokensOut },
              costUsd: event.costUsd,
              updatedAt: Date.now(),
            };
            yield* Ref.update(ms.meta, (m) => ({ ...m, ...patch }));
            yield* store.updateSession(sessionId, patch);
          } else {
            yield* Ref.update(ms.meta, (m) => ({ ...m, updatedAt: Date.now() }));
          }

          // ── persistence ────────────────────────────────────────────────
          if (event.t === "assistant_delta") {
            yield* Ref.update(ms.deltaBuffers, (m) => {
              const next = new Map(m);
              const cur = next.get(event.id);
              next.set(event.id, {
                text: cur ? cur.text + event.text : event.text,
                seq: event.seq,
              });
              return next;
            });
          } else if (event.t === "assistant_end") {
            // Flush the buffer as one row, then persist the end.
            const buffers = yield* Ref.get(ms.deltaBuffers);
            const buf = buffers.get(event.id);
            if (buf) {
              const coalesced: WireEvent = {
                t: "assistant_delta",
                seq: buf.seq,
                id: event.id,
                text: buf.text,
              };
              yield* store.appendEvent(sessionId, coalesced);
              yield* Ref.update(ms.deltaBuffers, (m) => {
                const next = new Map(m);
                next.delete(event.id);
                return next;
              });
            }
            yield* store.appendEvent(sessionId, event);
          } else {
            yield* store.appendEvent(sessionId, event);
          }

          // ── live fan-out (always per-event, never coalesced) ───────────
          yield* PubSub.publish(ms.pubsub, event);
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
        pubsub: yield* PubSub.unbounded<WireEvent>(),
        seq: yield* Ref.make(yield* store.maxSeq(sessionId)),
        deltaBuffers: yield* Ref.make(
          new Map<string, { text: string; seq: number }>(),
        ),
      };
      const pumpFiber = yield* Effect.forkDaemon(startPump(state, sessionId));
      return { ...state, pumpFiber };
    });

  const create = (opts: { cwd: string; title?: string; branch?: string }) =>
    Effect.gen(function* () {
      const piSession = yield* pi.create(opts);
      const meta = piSession.meta;

      // Persist the session row before we start emitting events.
      yield* store.insertSession(meta);

      const ms = yield* buildManagedSession(meta.id, piSession);
      yield* Ref.update(sessions, HashMap.set(meta.id, ms));
      return meta;
    });

  /**
   * Build a fresh ManagedSession from a stored row. Used by reattach
   * only. Pulls the latest meta from the store, calls `pi.resume`, builds
   * the in-memory scaffolding, forks the pump, and inserts into `sessions`.
   *
   * Does not handle the leader/follower coordination — that's
   * `lookupOrReattach`'s job. Calling this directly without the lock
   * risks duplicate PiSessions.
   */
  const reattachOne = (
    id: string,
  ): Effect.Effect<ManagedSession, PiError | SessionNotFound> =>
    Effect.gen(function* () {
      const storedOpt = yield* store.getSession(id);
      if (Option.isNone(storedOpt)) {
        return yield* Effect.fail(new SessionNotFound(id));
      }
      const storedMeta = storedOpt.value;

      const piSession = yield* pi.resume(storedMeta);
      const ms = yield* buildManagedSession(id, piSession);
      yield* Ref.update(sessions, HashMap.set(id, ms));
      return ms;
    });

  /**
   * Resolve a session id to a live ManagedSession. Fast path: it's
   * already in the in-memory `sessions` map. Slow path: rehydrate
   * from the store by reopening pi's session file and rebuilding the
   * pump.
   *
   * The slow path is leader-elected per id: the first caller does the
   * work; concurrent callers await the same `Deferred`. This
   * preserves the invariant "at most one live PiSession per id" even
   * under simultaneous WS reconnects.
   *
   * Fails with `SessionNotFound` when neither the in-memory map nor
   * the store knows the id, or when the on-disk pi file is missing
   * (typically: $PI_EPHEMERAL was set in the prior run, or the file
   * was manually deleted).
   */
  const lookupOrReattach = (
    id: string,
  ): Effect.Effect<ManagedSession, PiError | SessionNotFound> =>
    Effect.gen(function* () {
      // Fast path: live HashMap.
      const map = yield* Ref.get(sessions);
      const existing = HashMap.get(map, id);
      if (Option.isSome(existing)) return existing.value;

      // Slow path: atomically claim the reattach slot. We pre-create
      // a Deferred and try to install it; if one's already there we
      // get that one back instead. Reference equality (`leader === ours`)
      // tells us which case we hit.
      const ours = yield* Deferred.make<
        ManagedSession,
        PiError | SessionNotFound
      >();
      const leader = yield* Ref.modify(reattachInFlight, (m) =>
        Option.match(HashMap.get(m, id), {
          onNone: () => [ours, HashMap.set(m, id, ours)] as const,
          onSome: (existing) => [existing, m] as const,
        }),
      );

      if (leader !== ours) return yield* Deferred.await(leader);

      // Leader path: run the reattach, then onExit both unregister
      // ourselves from the in-flight map AND signal followers — in
      // that order so a follower that observes the Deferred can't
      // race a future fast-path miss against a stale slot.
      return yield* reattachOne(id).pipe(
        Effect.onExit((exit) =>
          Ref.update(reattachInFlight, HashMap.remove(id)).pipe(
            Effect.andThen(Deferred.done(ours, exit)),
          ),
        ),
      );
    });

  const list = () => store.listSessions();

  const get = (id: string) => store.getSession(id);

  const subscribe = (id: string, fromCursor: number) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const ms = yield* lookupOrReattach(id);
        const currentMeta = yield* Ref.get(ms.meta);
        // Snapshot the current seq BEFORE subscribing so we know where the
        // historical/live boundary lives.
        const cursorAtAttach = yield* Ref.get(ms.seq);

        // Pull historical events from the store.
        const replay = yield* store.loadEventsAfter(id, fromCursor);

        const helloEvent: WireEvent = {
          t: "hello",
          seq: 0,
          session: currentMeta,
          cursor: cursorAtAttach,
        };

        // Subscribe to live, then drop anything with seq <= cursorAtAttach
        // (already covered by the replay) to keep the seq sequence contiguous.
        const liveStream = pipe(
          Stream.unwrapScoped(
            Effect.map(PubSub.subscribe(ms.pubsub), Stream.fromQueue),
          ),
          Stream.filter((e) => e.seq > cursorAtAttach),
        );

        return pipe(
          Stream.fromIterable<WireEvent>([helloEvent, ...replay]),
          Stream.concat(liveStream),
        );
      }),
    );

  /** Echo the user's message into the stream so it appears in the log too. */
  const send = (
    id: string,
    text: string,
    mode?: import("./pi.ts").SendMode,
    images?: import("./pi.ts").SendImage[],
  ) =>
    Effect.gen(function* () {
      const ms = yield* lookupOrReattach(id);
      const seq = yield* Ref.updateAndGet(ms.seq, (n) => n + 1);
      const userEvent: WireEvent = {
        t: "user_message",
        seq,
        entry: {
          kind: "user",
          id: `u_${Date.now().toString(36)}`,
          at: Date.now(),
          text,
        },
      };
      yield* store.appendEvent(id, userEvent);
      yield* PubSub.publish(ms.pubsub, userEvent);
      yield* ms.pi.send(text, mode, images);
    });

  const interrupt = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.interrupt());

  const approve = (id: string, msgId: string, choice: PermissionChoice) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.approve(msgId, choice));

  const listModels = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.listModels());

  const setModel = (id: string, provider: string, modelId: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) =>
      ms.pi.setModel(provider, modelId),
    );

  const compact = (id: string, instructions?: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.compact(instructions));

  const listAuthProviders = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.listAuthProviders());

  const startAuthLogin = (id: string, providerId: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.startAuthLogin(providerId));

  const getAuthLogin = (id: string, jobId: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.getAuthLogin(jobId));

  const submitAuthLoginInput = (id: string, jobId: string, value: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.submitAuthLoginInput(jobId, value));

  const cancelAuthLogin = (id: string, jobId: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.cancelAuthLogin(jobId));

  const getSettings = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.getSettings());

  const patchSettings = (id: string, patch: SessionSettingsPatch) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.patchSettings(patch));

  const getStats = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.getStats());

  const getTree = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.getTree());

  const navigateTree = (id: string, entryId: string, summarize?: boolean) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.navigateTree(entryId, summarize));

  /**
   * Apply a partial update to the persisted SessionMeta and, when the
   * session is currently live, mirror the change into the in-process
   * meta Ref so subscribers see it on their next read. Returns the new
   * meta. Treated as a no-op for fields not supplied.
   */
  const patch = (
    id: string,
    p: { title?: string; archived?: boolean },
  ): Effect.Effect<SessionMeta, SessionNotFound> =>
    Effect.gen(function* () {
      const existing = yield* store.getSession(id);
      if (Option.isNone(existing))
        return yield* Effect.fail(new SessionNotFound(id));

      const next: SessionMeta = {
        ...existing.value,
        ...(p.title !== undefined ? { title: p.title } : {}),
        ...(p.archived !== undefined ? { archived: p.archived } : {}),
        updatedAt: Date.now(),
      };
      yield* store.updateSession(id, next);

      // If the session is live, update the in-process Ref so existing
      // WS subscribers' next hello/meta read sees the change. We don't
      // emit a wire event for this — clients learn on their next list.
      const map = yield* Ref.get(sessions);
      const live = HashMap.get(map, id);
      if (Option.isSome(live)) {
        yield* Ref.set(live.value.meta, next);
      }
      return next;
    });

  /**
   * Hard delete. If the session is live we dispose its pumpFiber and
   * pi resources before removing the rows; concurrent subscribers see
   * the stream close cleanly.
   */
  const remove = (id: string): Effect.Effect<void, SessionNotFound> =>
    Effect.gen(function* () {
      const existing = yield* store.getSession(id);
      if (Option.isNone(existing))
        return yield* Effect.fail(new SessionNotFound(id));

      // Tear down the live session if running. Interrupting the pump
      // fiber is enough — its cleanup releases pi and the queue.
      const map = yield* Ref.get(sessions);
      const live = HashMap.get(map, id);
      if (Option.isSome(live)) {
        yield* Fiber.interrupt(live.value.pumpFiber);
        yield* Ref.update(sessions, (m) => HashMap.remove(m, id));
      }
      yield* store.deleteSession(id);
    });

  return SessionManager.of({
    create,
    list,
    get,
    subscribe,
    send,
    interrupt,
    approve,
    listModels,
    setModel,
    compact,
    listAuthProviders,
    startAuthLogin,
    getAuthLogin,
    submitAuthLoginInput,
    cancelAuthLogin,
    getSettings,
    patchSettings,
    getStats,
    getTree,
    navigateTree,
    patch,
    remove,
  });
});

export const SessionManagerLive = Layer.effect(SessionManager, make);
