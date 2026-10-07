import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Runtime from "effect/Runtime";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import { PiClient, type PiSession, type ExportedHtml, type LiveHooks, type LiveSession, PiError } from "./pi.ts";
import type {
  Commands,
  ExtensionUiResponseValue,
  HistoryPage,
  SendStatus,
  ServerMessage,
  SessionMeta,
  SessionControls,
  SessionStats,
  SessionTree,
} from "@pico/protocol";
import { Store } from "./store.ts";
import { toSessionMeta } from "./session-record.ts";
import { SessionNotFound } from "./errors.ts";

interface ManagedSession {
  readonly pi: PiSession;
  // Last lookup or viewer leaving; an idle session closes IDLE_EVICT_MS after.
  lastUsed: number;
}

type ReattachWaiter = Deferred.Deferred<ManagedSession, PiError | SessionNotFound>;
type ReattachMap = HashMap.HashMap<string, ReattachWaiter>;
type ReattachDecision = readonly [ReattachWaiter, ReattachMap];

type SendInput = Parameters<LiveSession["send"]>[0];

export class SessionManager extends Context.Tag("SessionManager")<
  SessionManager,
  {
    readonly create: (opts: {
      cwd: string;
      title: string;
    }) => Effect.Effect<SessionMeta, PiError>;
    readonly list: (filter?: { archived?: boolean }) => Effect.Effect<SessionMeta[]>;
    readonly subscribe: (
      id: string,
      head: string | null,
      cids: readonly string[],
    ) => Stream.Stream<ServerMessage, PiError | SessionNotFound>;
    readonly send: (id: string, input: SendInput) => Effect.Effect<SendStatus, PiError | SessionNotFound>;
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
    readonly clearQueue: (
      id: string,
    ) => Effect.Effect<{ steering: string[]; followUp: string[] }, PiError | SessionNotFound>;
    readonly getSettings: (id: string) => Effect.Effect<SessionControls, PiError | SessionNotFound>;
    readonly patchSetting: (
      id: string,
      key: string,
      value: string | boolean,
    ) => Effect.Effect<SessionControls, PiError | SessionNotFound>;
    readonly getStats: (id: string) => Effect.Effect<SessionStats, PiError | SessionNotFound>;
    readonly history: (id: string, before: string, limit?: number) => Effect.Effect<HistoryPage, PiError | SessionNotFound>;
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

// A viewer this many messages behind is dropped; it reconnects from its bookmark.
const MAX_BEHIND_MESSAGES = 2048;

// Graceful shutdown waits this long for a running turn to stop.
const STOP_TIMEOUT = "10 seconds";

const make = Effect.gen(function* () {
  const pi = yield* PiClient;
  const store = yield* Store;
  const sessions = yield* Ref.make(HashMap.empty<string, ManagedSession>());
  const runSync = Runtime.runSync(yield* Effect.runtime<never>());
  let stopping = false;

  const reattachInFlight = yield* Ref.make(
    HashMap.empty<
      string,
      Deferred.Deferred<ManagedSession, PiError | SessionNotFound>
    >(),
  );

  // Called from pi's notifications, which can't wait.
  const hooks: LiveHooks = {
    persist: (meta) =>
      runSync(
        store.updateSession(meta.id, {
          status: meta.status,
          tokens: meta.tokens,
          costUsd: meta.costUsd,
          updatedAtMs: Date.parse(meta.updatedAt),
        }),
      ),
    log: (event, fields) => runSync(Effect.logInfo(event).pipe(Effect.annotateLogs(fields))),
  };

  // Sessions nobody watches, with nothing running or queued, close after a while.
  const evictIdle = Effect.gen(function* () {
    const now = Date.now();
    for (const [id, ms] of yield* Ref.get(sessions)) {
      const { live } = ms.pi;
      if (!live.idle || now - Math.max(ms.lastUsed, Date.parse(live.meta.updatedAt)) < IDLE_EVICT_MS) continue;
      // Unpublish before closing, so a concurrent lookup reattaches a fresh
      // session instead of getting this one mid-close.
      yield* Ref.update(sessions, HashMap.remove(id));
      yield* Effect.logInfo("session_evicted").pipe(Effect.annotateLogs({ session_id: id }));
      yield* ms.pi.close();
    }
  });
  yield* evictIdle.pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.forkScoped);

  const create = (opts: { cwd: string; title: string }) =>
    Effect.gen(function* () {
      const piSession = yield* pi.create(opts, hooks);
      const meta = piSession.live.meta;

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

      yield* Ref.update(sessions, HashMap.set(meta.id, { pi: piSession, lastUsed: Date.now() }));
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

      const piSession = yield* pi.resume(storedRecord, hooks);
      // Shutdown began while this was opening; closeAll has already run.
      if (stopping) {
        yield* piSession.close();
        return yield* Effect.fail(new PiError({ message: "The host is restarting; try again in a moment." }));
      }
      yield* Effect.ignoreLogged(piSession.patchSession({ title: storedRecord.title }));
      const ms: ManagedSession = { pi: piSession, lastUsed: Date.now() };
      yield* Ref.update(sessions, HashMap.set(id, ms));
      return ms;
    });

  const lookupOrReattach = (
    id: string,
  ): Effect.Effect<ManagedSession, PiError | SessionNotFound> =>
    Effect.gen(function* () {
      if (stopping) return yield* Effect.fail(new PiError({ message: "The host is restarting; try again in a moment." }));
      const existing = HashMap.get(yield* Ref.get(sessions), id);
      if (Option.isSome(existing)) {
        existing.value.lastUsed = Date.now();
        return existing.value;
      }

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

      // Another leader may have finished between our lookup and the claim.
      const attached = HashMap.get(yield* Ref.get(sessions), id);
      const reattach = Option.isSome(attached) ? Effect.succeed(attached.value) : reattachOne(id);
      return yield* reattach.pipe(
        Effect.onExit((exit) =>
          Ref.update(reattachInFlight, HashMap.remove(id)).pipe(
            Effect.andThen(Deferred.done(ours, exit)),
          ),
        ),
      );
    });

  const list = (filter?: { archived?: boolean }) =>
    Effect.map(store.listSessions(filter), (records) => records.map(toSessionMeta));

  const subscribe = (id: string, head: string | null, cids: readonly string[]) =>
    Stream.unwrapScoped(
      Effect.gen(function* () {
        const ms = yield* lookupOrReattach(id);
        // Full means too far behind: push() then returns false and the viewer is ended.
        const queue = yield* Queue.bounded<ServerMessage>(MAX_BEHIND_MESSAGES);
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            ms.pi.live.attach(head, cids, {
              push: (message) => Queue.unsafeOffer(queue, message),
              // Ends the stream; the phone reconnects from its bookmark.
              end: () => void Effect.runFork(Queue.shutdown(queue)),
            }),
          ),
          (detach) =>
            Effect.sync(() => {
              detach();
              ms.lastUsed = Date.now();
            }),
        );
        return Stream.fromQueue(queue);
      }),
    );

  const send = (id: string, input: SendInput) =>
    Effect.flatMap(lookupOrReattach(id), (ms) =>
      Effect.tryPromise({
        try: () => ms.pi.live.send(input),
        catch: (e) => new PiError({ message: e instanceof Error ? e.message : String(e), cause: e }),
      }),
    );

  const interrupt = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.interrupt());

  const extensionUiResponse = (
    id: string,
    requestId: string,
    value: ExtensionUiResponseValue,
  ) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.extensionUiResponse(requestId, value));

  const compact = (id: string, instructions?: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.compact(instructions));

  const exportHtml = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.exportHtml());

  const listCommands = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.listCommands());

  const clearQueue = (id: string) =>
    Effect.map(lookupOrReattach(id), (ms) => ms.pi.live.clearQueue());

  const getSettings = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.getSettings());

  const patchSetting = (id: string, key: string, value: string | boolean) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.patchSetting(key, value));

  const getStats = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.getStats());

  const history = (id: string, before: string, limit?: number) =>
    Effect.map(lookupOrReattach(id), (ms) => ms.pi.live.history(before, limit));

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

      // Write and merge only the changed fields: a live session may have moved
      // status or cost on since the read above.
      const changes = {
        ...(p.title !== undefined ? { title: p.title } : {}),
        ...(p.archived !== undefined ? { archived: p.archived } : {}),
      };
      const updatedAtMs = Date.now();
      yield* store.updateSession(id, { ...changes, updatedAtMs });

      const live = HashMap.get(yield* Ref.get(sessions), id);
      if (Option.isNone(live)) return toSessionMeta({ ...existing.value, ...changes, updatedAtMs });
      live.value.pi.live.patchMeta(changes);
      if (p.title !== undefined) {
        yield* Effect.ignoreLogged(live.value.pi.patchSession({ title: p.title }));
      }
      return live.value.pi.live.meta;
    });

  const remove = (id: string): Effect.Effect<void, SessionNotFound> =>
    Effect.gen(function* () {
      const existing = yield* store.getSession(id);
      if (Option.isNone(existing))
        return yield* Effect.fail(new SessionNotFound({ id }));

      const live = HashMap.get(yield* Ref.get(sessions), id);
      if (Option.isSome(live)) {
        yield* Ref.update(sessions, HashMap.remove(id));
        // Also ends open streams, so viewers don't wait on a deleted session.
        yield* live.value.pi.close();
      }
      yield* store.deleteSession(id);
    });

  // On shutdown: refuse new work, stop running turns so pi saves what they
  // have, then close every session.
  const closeAll = () =>
    Effect.gen(function* () {
      stopping = true;
      const map = yield* Ref.getAndSet(sessions, HashMap.empty<string, ManagedSession>());
      yield* Effect.forEach(
        HashMap.values(map),
        (ms) =>
          Effect.promise(() => ms.pi.live.stop()).pipe(
            Effect.timeout(STOP_TIMEOUT),
            Effect.catchAllCause((cause) =>
              Effect.logWarning("session_stop_failed", cause).pipe(Effect.annotateLogs({ session_id: ms.pi.live.meta.id })),
            ),
            Effect.andThen(ms.pi.close()),
          ),
        { concurrency: "unbounded", discard: true },
      );
    });

  return SessionManager.of({
    create,
    list,
    subscribe,
    send,
    interrupt,
    extensionUiResponse,
    compact,
    exportHtml,
    listCommands,
    clearQueue,
    getSettings,
    patchSetting,
    getStats,
    history,
    getTree,
    navigateTree,
    patch,
    remove,
    closeAll,
  });
});

// Scoped so the server scope tears sessions down on shutdown (stops turns, closes pi).
export const SessionManagerLive = Layer.scoped(
  SessionManager,
  Effect.tap(make, (manager) => Effect.addFinalizer(() => manager.closeAll())),
);
