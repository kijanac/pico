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

type View = "active" | "archived";

// One list per view, so switching shows that view's own rows (or loading),
// never the other's. null: not loaded yet.
const lists = $state<Record<View, SessionMeta[] | null>>({ active: null, archived: null });
let issue = $state<HostIssue | null>(null);
let archivedView = $state(false);
let refreshing = $state(false);
let creating = $state(false);
let mutatingSessionId = $state<string | null>(null);
// Bumped by every refresh and failure, so a late answer can't win.
let refreshes = 0;
let failures = 0;

const view = (): View => (archivedView ? "archived" : "active");
const sessions = $derived([...(lists[view()] ?? [])].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));

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

// Into the list for its view, if that list is loaded; out of the other.
function replaceSession(session: SessionMeta): void {
  removeLocal(session.id);
  lists[session.archived ? "archived" : "active"]?.unshift(session);
}

async function mutate<A, E>(sessionId: string, effect: Effect.Effect<A, E, PicoClient>): Promise<A> {
  if (mutatingSessionId) throw new Error("session mutation already in progress");
  mutatingSessionId = sessionId;
  try {
    const result = await runRpc(effect);
    issue = null;
    return result;
  } catch (caught) {
    recordError(caught);
    throw caught;
  } finally {
    mutatingSessionId = null;
  }
}

export const sessionListState = {
  get sessions() { return sessions; },
  get archivedView() { return archivedView; },
  get refreshing() { return refreshing; },
  get creating() { return creating; },
  get mutatingSessionId() { return mutatingSessionId; },
  get error() { return issue; },

  clearError(): void { issue = null; },
  upsert: replaceSession,
  removeLocal,

  // The stored list at once, then the list after pi's files are checked. A
  // failure keeps what's shown.
  async refresh(): Promise<void> {
    const refresh = ++refreshes;
    const target = view();
    refreshing = true;
    try {
      const stored = await runRpc(loadSessionList({ archived: target === "archived" }));
      // An empty store may just not be indexed yet: wait for the fresh list.
      if (refresh === refreshes && stored.length > 0) lists[target] = [...stored];
      const fresh = await runRpc(loadSessionList({ archived: target === "archived", fresh: true }));
      if (refresh !== refreshes) return;
      lists[target] = [...fresh];
      issue = null;
    } catch (caught) {
      if (refresh === refreshes) recordError(caught);
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
    // The caller opens the session as soon as it exists; the list catches up
    // on its own, and a failed refresh there doesn't fail the create.
    try {
      const session = await runRpc(createSessionRequest(input));
      archivedView = false;
      replaceSession(session);
      void this.refresh();
      return session;
    } finally {
      creating = false;
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
