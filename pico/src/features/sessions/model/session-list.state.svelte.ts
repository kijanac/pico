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
import { classifyHostFailure, classifyHostIssue, type HostIssue } from "@/shared/lib/host-issues";

let sessionList = $state<SessionMeta[]>([]);
let issue = $state<HostIssue | null>(null);
let archivedView = $state(false);
let refreshing = $state(false);
let creating = $state(false);
let mutatingSessionId = $state<string | null>(null);

const sessions = $derived([...sessionList].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));

async function recordError(caught: unknown): Promise<void> {
  try {
    issue = await runRpc(classifyHostFailure(caught));
  } catch {
    issue = classifyHostIssue(caught);
  }
}

function removeLocal(sessionId: string): void {
  const index = sessionList.findIndex((session) => session.id === sessionId);
  if (index !== -1) sessionList.splice(index, 1);
}

function replaceSession(session: SessionMeta): void {
  const index = sessionList.findIndex((candidate) => candidate.id === session.id);
  if (index === -1) sessionList.unshift(session);
  else sessionList[index] = session;
}

async function mutate<A, E>(sessionId: string, effect: Effect.Effect<A, E, PicoClient>): Promise<A> {
  if (mutatingSessionId) throw new Error("session mutation already in progress");
  mutatingSessionId = sessionId;
  try {
    const result = await runRpc(effect);
    issue = null;
    return result;
  } catch (caught) {
    await recordError(caught);
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

  async refresh(): Promise<void> {
    refreshing = true;
    try {
      sessionList = [...(await runRpc(loadSessionList({ archived: archivedView })))];
      issue = null;
    } catch (caught) {
      sessionList = [];
      await recordError(caught);
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
    return mutate(sessionId, setSessionArchived(sessionId, archived).pipe(Effect.tap(() => Effect.sync(() => removeLocal(sessionId)))));
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
