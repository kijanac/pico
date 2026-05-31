import { randomUUID } from "node:crypto";
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
import { PiClient, type PiSession, type PiEmission, type ExportedHtml, PiError } from "./pi.ts";
import { parseWireEvent } from "@pi-mobile/protocol";
import type {
  Commands,
  PermissionChoice,
  SessionMeta,
  QueueState,
  SessionControls,
  SessionStats,
  SessionTree,
  WireEvent,
} from "@pi-mobile/protocol";
import { Store } from "./store.ts";
import { createSessionWorktree, removeSessionWorktree } from "./git.ts";
import { toSessionMeta, type WorkspaceBinding } from "./session-record.ts";

interface ManagedSessionState {
  readonly meta: Ref.Ref<SessionMeta>;
  readonly pi: PiSession;
  readonly pubsub: PubSub.PubSub<WireEvent>;
  readonly seq: Ref.Ref<number>;
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
      title: string;
      branch?: string;
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
    readonly compact: (
      id: string,
      instructions?: string,
    ) => Effect.Effect<void, PiError | SessionNotFound>;
    readonly exportHtml: (id: string) => Effect.Effect<ExportedHtml, PiError | SessionNotFound>;
    readonly listCommands: (id: string) => Effect.Effect<Commands, PiError | SessionNotFound>;
    readonly getQueue: (id: string) => Effect.Effect<QueueState, PiError | SessionNotFound>;
    readonly clearQueue: (id: string) => Effect.Effect<QueueState, PiError | SessionNotFound>;
    readonly getSettings: (id: string) => Effect.Effect<SessionControls, PiError | SessionNotFound>;
    readonly patchSetting: (
      id: string,
      key: string,
      value: string | boolean,
    ) => Effect.Effect<SessionControls, PiError | SessionNotFound>;
    readonly getStats: (id: string) => Effect.Effect<SessionStats, PiError | SessionNotFound>;
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
import { SessionNotFound } from "./errors.ts";

const make = Effect.gen(function* () {
  const pi = yield* PiClient;
  const store = yield* Store;
  const sessions = yield* Ref.make(HashMap.empty<string, ManagedSession>());

  const reattachInFlight = yield* Ref.make(
    HashMap.empty<
      string,
      Deferred.Deferred<ManagedSession, PiError | SessionNotFound>
    >(),
  );

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

  const create = (opts: { cwd: string; title: string; branch?: string }) =>
    Effect.gen(function* () {
      const worktree = yield* createSessionWorktree({ cwd: opts.cwd, branch: opts.branch });
      const displayCwd = worktree ? worktree.repoRoot : opts.cwd;
      const executionCwd = worktree ? worktree.worktreePath : opts.cwd;
      const branch = worktree?.baseBranch;
      const workspace: WorkspaceBinding = worktree
        ? {
            kind: "git-worktree",
            repoRoot: worktree.repoRoot,
            worktreePath: worktree.worktreePath,
            baseBranch: worktree.baseBranch,
            baseRef: worktree.baseRef,
            sessionBranch: worktree.sessionBranch,
            ownedBySession: true,
          }
        : { kind: "plain" };
      const piSession = yield* pi.create({
        cwd: displayCwd,
        executionCwd,
        title: opts.title,
        branch,
      });
      const meta = piSession.meta;

      yield* store.insertSession({
        id: meta.id,
        title: meta.title,
        cwd: meta.cwd,
        branch: meta.branch,
        status: meta.status,
        updatedAtMs: Date.parse(meta.updatedAt),
        tokens: meta.tokens,
        costUsd: meta.costUsd,
        archived: meta.archived,
        runtime: {
          executionCwd,
          workspace,
        },
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
        return yield* Effect.fail(new SessionNotFound(id));
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
      const leader = yield* Ref.modify(reattachInFlight, (m) =>
        Option.match(HashMap.get(m, id), {
          onNone: () => [ours, HashMap.set(m, id, ours)] as const,
          onSome: (existing) => [existing, m] as const,
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
        const replay = yield* store.loadEventsAfter(id, fromCursor);
        const replayCursor = replay.reduce(
          (max, event) => Math.max(max, event.seq),
          cursorAtSubscribe,
        );

        const helloEvent: WireEvent = {
          t: "hello",
          seq: 0,
          session: currentMeta,
          cursor: replayCursor,
        };

        const liveStream = pipe(
          Stream.fromQueue(liveQueue),
          Stream.filter((e) => e.seq > replayCursor),
        );

        return pipe(
          Stream.fromIterable<WireEvent>([helloEvent, ...replay]),
          Stream.concat(liveStream),
        );
      }),
    );

  const send = (
    id: string,
    text: string,
    mode?: import("./pi.ts").SendMode,
    images?: import("./pi.ts").SendImage[],
  ) =>
    Effect.gen(function* () {
      const ms = yield* lookupOrReattach(id);
      const currentMeta = yield* Ref.get(ms.meta);
      const queued = currentMeta.status === "thinking" || currentMeta.status === "tool";
      const queueKind = mode === "follow_up" ? "follow_up" : "steer";
      const seq = yield* Ref.updateAndGet(ms.seq, (n) => n + 1);
      const userEvent: WireEvent = {
        t: "user_message",
        seq,
        entry: {
          kind: "user",
          id: `u_${randomUUID()}`,
          at: Date.now(),
          text,
          ...(queued ? { queued: true, queueKind } : {}),
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

  const compact = (id: string, instructions?: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.compact(instructions));

  const exportHtml = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.exportHtml());

  const listCommands = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.listCommands());

  const getQueue = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.getQueue());

  const clearQueue = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.clearQueue());

  const getSettings = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.getSettings());

  const patchSetting = (id: string, key: string, value: string | boolean) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.patchSetting(key, value));

  const getStats = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.getStats());

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
        return yield* Effect.fail(new SessionNotFound(id));

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
        return yield* Effect.fail(new SessionNotFound(id));

      const map = yield* Ref.get(sessions);
      const live = HashMap.get(map, id);
      if (Option.isSome(live)) {
        yield* Fiber.interrupt(live.value.pumpFiber);
        yield* live.value.pi.close();
        yield* Ref.update(sessions, (m) => HashMap.remove(m, id));
      }
      if (existing.value.runtime.workspace.kind === "git-worktree" && existing.value.runtime.workspace.ownedBySession) {
        yield* Effect.ignoreLogged(
          removeSessionWorktree({
            repoRoot: existing.value.runtime.workspace.repoRoot,
            worktreePath: existing.value.runtime.workspace.worktreePath,
            sessionBranch: existing.value.runtime.workspace.sessionBranch,
          }),
        );
      }
      yield* store.deleteSession(id);
    });

  const closeAll = () =>
    Effect.gen(function* () {
      const map = yield* Ref.get(sessions);
      yield* Effect.forEach(HashMap.values(map), (live) =>
        Effect.all([
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
    approve,
    compact,
    exportHtml,
    listCommands,
    getQueue,
    clearQueue,
    getSettings,
    patchSetting,
    getStats,
    getTree,
    navigateTree,
    patch,
    remove,
    closeAll,
  });
});

export const SessionManagerLive = Layer.effect(SessionManager, make);
