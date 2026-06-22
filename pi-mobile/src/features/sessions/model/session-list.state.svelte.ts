import type { SessionMeta } from "@pico/protocol";
import { Effect } from "effect";
import { settingsState } from "@/features/settings/settings.state.svelte";
import {
  createSession as createSessionRequest,
  deleteSession as deleteSessionRequest,
  loadSessionList,
  renameSession as renameSessionRequest,
  setSessionArchived,
  type CreateSessionInput,
} from "@/features/sessions/api";
import { clearChatDraft } from "@/features/chat/model/chat-draft";
import { type PicoClient, runHost } from "@/shared/lib/rpc-client";
import { classifyHostFailure, type HostIssue } from "@/shared/lib/host-issues";

let sessions = $state<SessionMeta[]>([]);
let archivedView = $state(false);
let refreshing = $state(false);
let creating = $state(false);
let mutatingSessionId = $state<string | null>(null);
let error = $state<HostIssue | null>(null);

const busy = $derived(refreshing || creating || mutatingSessionId !== null);
const visibleCount = $derived(sessions.length);

const recordError = (caught: unknown) =>
  classifyHostFailure(caught, { url: settingsState.hostUrl }).pipe(
    Effect.andThen((issue) => Effect.sync(() => { error = issue; })),
  );

function removeLocal(sessionId: string): void {
  sessions = sessions.filter((session) => session.id !== sessionId);
}

function replaceSession(session: SessionMeta): void {
  const index = sessions.findIndex((candidate) => candidate.id === session.id);
  sessions = index === -1
    ? [session, ...sessions]
    : sessions.map((candidate) => (candidate.id === session.id ? session : candidate));
}

function mutate<A, E>(sessionId: string, effect: Effect.Effect<A, E, PicoClient>): Promise<A> {
  if (mutatingSessionId) throw new Error("session mutation already in progress");
  mutatingSessionId = sessionId;
  return runHost(
    effect.pipe(
      Effect.tap(() => Effect.sync(() => { error = null; })),
      Effect.tapError(recordError),
    ),
  ).finally(() => { mutatingSessionId = null; });
}

export const sessionListState = {
  get sessions() { return sessions; },
  get archivedView() { return archivedView; },
  get refreshing() { return refreshing; },
  get creating() { return creating; },
  get mutatingSessionId() { return mutatingSessionId; },
  get busy() { return busy; },
  get visibleCount() { return visibleCount; },
  get error() { return error; },

  clearError(): void { error = null; },
  upsert(session: SessionMeta): void { replaceSession(session); },
  patchLocal(sessionId: string, patch: Partial<SessionMeta>): void {
    sessions = sessions.map((session) => (session.id === sessionId ? { ...session, ...patch } : session));
  },
  removeLocal,

  async refresh(): Promise<void> {
    refreshing = true;
    try {
      await runHost(
        loadSessionList({ archived: archivedView }).pipe(
          Effect.tap((list) => Effect.sync(() => { sessions = [...list]; error = null; })),
          Effect.tapError(recordError),
        ),
      );
    } finally {
      refreshing = false;
    }
  },

  async switchArchivedView(next: boolean): Promise<void> {
    if (archivedView === next) return;
    archivedView = next;
    await this.refresh();
  },

  async create(input: CreateSessionInput): Promise<SessionMeta> {
    if (creating) throw new Error("session creation already in progress");
    creating = true;
    try {
      return await runHost(
        Effect.gen(function* () {
          const session = yield* createSessionRequest(input);
          const list = yield* loadSessionList({ archived: false });
          return { session, list };
        }).pipe(
          Effect.tap(({ list }) => Effect.sync(() => { archivedView = false; sessions = [...list]; error = null; })),
          Effect.tapError(recordError),
          Effect.map(({ session }) => session),
        ),
      );
    } finally {
      creating = false;
    }
  },

  rename(sessionId: string, title: string): Promise<SessionMeta> {
    return mutate(
      sessionId,
      renameSessionRequest(sessionId, title).pipe(Effect.tap((session) => Effect.sync(() => replaceSession(session)))),
    );
  },

  setArchived(sessionId: string, archived: boolean): Promise<SessionMeta> {
    return mutate(
      sessionId,
      setSessionArchived(sessionId, archived).pipe(Effect.tap(() => Effect.sync(() => removeLocal(sessionId)))),
    );
  },

  delete(sessionId: string): Promise<void> {
    return mutate(
      sessionId,
      deleteSessionRequest(sessionId).pipe(
        Effect.tap(() => Effect.promise(() => clearChatDraft(sessionId).catch(() => undefined))),
        Effect.tap(() => Effect.sync(() => removeLocal(sessionId))),
        Effect.asVoid,
      ),
    );
  },
};
