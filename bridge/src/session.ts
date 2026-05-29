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
  AuthLoginJob,
  AuthProvider,
  Commands,
  ModelSummary,
  PermissionChoice,
  SessionMeta,
  QueueState,
  SessionSettings,
  SessionSettingsPatch,
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
      title?: string;
      branch?: string;
    }) => Effect.Effect<SessionMeta, PiError>;
    readonly list: () => Effect.Effect<SessionMeta[]>;
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
    readonly exportHtml: (id: string) => Effect.Effect<ExportedHtml, PiError | SessionNotFound>;
    readonly listCommands: (id: string) => Effect.Effect<Commands, PiError | SessionNotFound>;
    readonly getQueue: (id: string) => Effect.Effect<QueueState, PiError | SessionNotFound>;
    readonly clearQueue: (id: string) => Effect.Effect<QueueState, PiError | SessionNotFound>;
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
    readonly patch: (
      id: string,
      patch: { title?: string; archived?: boolean },
    ) => Effect.Effect<SessionMeta, SessionNotFound>;
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

  const create = (opts: { cwd: string; title?: string; branch?: string }) =>
    Effect.gen(function* () {
      const worktree = yield* createSessionWorktree({ cwd: opts.cwd, branch: opts.branch });
      const workspace: WorkspaceBinding = worktree
        ? {
            kind: "git-worktree",
            repoRoot: worktree.repoRoot,
            worktreePath: worktree.worktreePath,
            branch: worktree.branch,
            ownedBySession: true,
          }
        : { kind: "plain" };
      const piSession = yield* pi.create({
        cwd: worktree?.repoRoot ?? opts.cwd,
        executionCwd: worktree?.worktreePath ?? opts.cwd,
        title: opts.title,
        branch: worktree?.branch,
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
          executionCwd: worktree?.worktreePath ?? opts.cwd,
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

  const list = () => Effect.map(store.listSessions(), (records) => records.map(toSessionMeta));

  const get = (id: string) => Effect.map(store.getSession(id), Option.map(toSessionMeta));

  const subscribe = (id: string, fromCursor: number) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const ms = yield* lookupOrReattach(id);
        const currentMeta = yield* Ref.get(ms.meta);
        const cursorAtAttach = yield* Ref.get(ms.seq);

        const replay = yield* store.loadEventsAfter(id, fromCursor);

        const helloEvent: WireEvent = {
          t: "hello",
          seq: 0,
          session: currentMeta,
          cursor: cursorAtAttach,
        };

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
          id: `u_${randomUUID()}`,
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

  const exportHtml = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.exportHtml());

  const listCommands = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.listCommands());

  const getQueue = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.getQueue());

  const clearQueue = (id: string) =>
    Effect.flatMap(lookupOrReattach(id), (ms) => ms.pi.clearQueue());

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
        yield* Ref.update(sessions, (m) => HashMap.remove(m, id));
      }
      if (existing.value.runtime.workspace.kind === "git-worktree" && existing.value.runtime.workspace.ownedBySession) {
        yield* Effect.ignoreLogged(
          removeSessionWorktree(existing.value.runtime.workspace.repoRoot, existing.value.runtime.workspace.worktreePath),
        );
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
    exportHtml,
    listCommands,
    getQueue,
    clearQueue,
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
