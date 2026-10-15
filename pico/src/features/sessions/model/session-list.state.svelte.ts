import type { SessionMeta } from "@pico/protocol";
import { Effect } from "effect";
import {
  createSession as createSessionRequest,
  deleteSession as deleteSessionRequest,
  loadSessionList,
  renameSession as renameSessionRequest,
  setSessionArchived,
  type CreateSessionInput,
} from "@/features/sessions/api";
import { clearChatDraft } from "@/features/chat/model/chat-draft";
import { type PicoClient, runRpc } from "@/shared/lib/rpc-client";
import { diagnoseHostFailure, type HostIssue } from "@/shared/lib/host-issues";
import { sortSessions } from "./session-order";

type View = "active" | "archived";

const lists = $state<Record<View, SessionMeta[] | null>>({ active: null, archived: null });
let issue = $state<HostIssue | null>(null);
let archivedView = $state(false);
let refreshing = $state(false);
let creating = $state(false);
let mutatingSessionId = $state<string | null>(null);
let refreshes = 0;
let failures = 0;
let dataRevision = 0;
let createdSession = $state<SessionMeta | null>(null);

const view = (): View => (archivedView ? "archived" : "active");
const sessions = $derived(sortSessions(lists[view()] ?? []));

function recordError(caught: unknown): void {
  const failure = ++failures;
  issue = diagnoseHostFailure(caught, (better) => {
    if (failure === failures && issue) issue = better;
  });
}

function removeLocal(sessionId: string): void {
  for (const list of Object.values(lists)) {
    const index = list?.findIndex((session) => session.id === sessionId) ?? -1;
    if (index !== -1) list!.splice(index, 1);
  }
}

function replaceSession(session: SessionMeta): void {
  removeLocal(session.id);
  lists[session.archived ? "archived" : "active"]?.unshift(session);
}

async function mutate<A, E>(sessionId: string, effect: Effect.Effect<A, E, PicoClient>): Promise<A> {
  if (mutatingSessionId) throw new Error("session mutation already in progress");
  mutatingSessionId = sessionId;
  dataRevision += 1;
  try {
    const result = await runRpc(effect);
    issue = null;
    return result;
  } catch (caught) {
    recordError(caught);
    throw caught;
  } finally {
    mutatingSessionId = null;
    dataRevision += 1;
  }
}

export const sessionListState = {
  get sessions() { return sessions; },
  get archivedView() { return archivedView; },
  get refreshing() { return refreshing; },
  get creating() { return creating; },
  get mutatingSessionId() { return mutatingSessionId; },
  get error() { return issue; },
  get loaded() { return lists[view()] !== null; },
  get createdSession() { return createdSession; },

  dismissCreatedSession(): void { createdSession = null; },

  clearError(): void { issue = null; },
  upsert: replaceSession,
  removeLocal,

  async refresh(): Promise<void> {
    const refresh = ++refreshes;
    const target = view();
    const revision = dataRevision;
    const canApply = () => refresh === refreshes && revision === dataRevision && !mutatingSessionId && !creating;
    refreshing = true;
    try {
      if (lists[target] === null) {
        const stored = await runRpc(loadSessionList({ archived: target === "archived" }));
        if (canApply() && lists[target] === null && stored.length > 0) lists[target] = [...stored];
      }
      const fresh = await runRpc(loadSessionList({ archived: target === "archived", fresh: true }));
      if (!canApply()) return;
      lists[target] = [...fresh];
      issue = null;
    } catch (caught) {
      if (canApply()) recordError(caught);
    } finally {
      if (refresh === refreshes) refreshing = false;
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
    dataRevision += 1;
    let session: SessionMeta | null = null;
    try {
      session = await runRpc(createSessionRequest(input));
      replaceSession(session);
      createdSession = session;
      return session;
    } finally {
      creating = false;
      dataRevision += 1;
      if (session) void this.refresh();
    }
  },

  rename(sessionId: string, title: string): Promise<SessionMeta> {
    return mutate(sessionId, renameSessionRequest(sessionId, title).pipe(Effect.tap((session) => Effect.sync(() => replaceSession(session)))));
  },

  setArchived(sessionId: string, archived: boolean): Promise<SessionMeta> {
    return mutate(sessionId, setSessionArchived(sessionId, archived).pipe(Effect.tap((session) => Effect.sync(() => replaceSession(session)))));
  },

  delete(sessionId: string): Promise<void> {
    return mutate(
      sessionId,
      deleteSessionRequest(sessionId).pipe(
        Effect.tap(() => Effect.sync(() => clearChatDraft(sessionId))),
        Effect.tap(() => Effect.sync(() => removeLocal(sessionId))),
        Effect.asVoid,
      ),
    );
  },
};
