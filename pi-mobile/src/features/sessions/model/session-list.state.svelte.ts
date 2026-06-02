import type { SessionMeta } from "@pi-mobile/protocol";
import {
  createSession as createSessionRequest,
  deleteSession as deleteSessionRequest,
  loadSessionList,
  renameSession as renameSessionRequest,
  setSessionArchived,
  type CreateSessionInput,
} from "@/features/sessions/api";
import { clearChatDraft } from "@/features/chat/model/chat-draft";

let sessions = $state<SessionMeta[]>([]);
let archivedView = $state(false);
let refreshing = $state(false);
let creating = $state(false);
let mutatingSessionId = $state<string | null>(null);
let error = $state<string | null>(null);

const busy = $derived(refreshing || creating || mutatingSessionId !== null);
const visibleCount = $derived(sessions.length);

export const sessionListState = {
  get sessions() {
    return sessions;
  },

  get archivedView() {
    return archivedView;
  },

  get refreshing() {
    return refreshing;
  },

  get creating() {
    return creating;
  },

  get mutatingSessionId() {
    return mutatingSessionId;
  },

  get busy() {
    return busy;
  },

  get visibleCount() {
    return visibleCount;
  },

  get error() {
    return error;
  },

  clearError(): void {
    error = null;
  },

  upsert(session: SessionMeta): void {
    replaceSession(session);
  },

  patchLocal(sessionId: string, patch: Partial<SessionMeta>): void {
    sessions = sessions.map((session) =>
      session.id === sessionId ? { ...session, ...patch } : session,
    );
  },

  removeLocal(sessionId: string): void {
    sessions = sessions.filter((session) => session.id !== sessionId);
  },

  async refresh(): Promise<void> {
    refreshing = true;
    try {
      sessions = await loadSessionList({ archived: archivedView });
      error = null;
    } catch (caught) {
      error = String(caught);
      throw caught;
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
      const session = await createSessionRequest(input);
      archivedView = false;
      sessions = await loadSessionList({ archived: false });
      error = null;
      return session;
    } catch (caught) {
      error = String(caught);
      throw caught;
    } finally {
      creating = false;
    }
  },

  async rename(sessionId: string, title: string): Promise<SessionMeta> {
    return mutateSession(sessionId, async () => {
      const session = await renameSessionRequest(sessionId, title);
      replaceSession(session);
      return session;
    });
  },

  async setArchived(sessionId: string, archived: boolean): Promise<SessionMeta> {
    return mutateSession(sessionId, async () => {
      const session = await setSessionArchived(sessionId, archived);
      this.removeLocal(sessionId);
      return session;
    });
  },

  async delete(sessionId: string): Promise<void> {
    await mutateSession(sessionId, async () => {
      await deleteSessionRequest(sessionId);
      await clearChatDraft(sessionId).catch(() => undefined);
      this.removeLocal(sessionId);
    });
  },
};

async function mutateSession<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  if (mutatingSessionId) throw new Error("session mutation already in progress");

  mutatingSessionId = sessionId;
  try {
    const result = await operation();
    error = null;
    return result;
  } catch (caught) {
    error = String(caught);
    throw caught;
  } finally {
    mutatingSessionId = null;
  }
}

function replaceSession(session: SessionMeta): void {
  const index = sessions.findIndex((candidate) => candidate.id === session.id);
  if (index === -1) {
    sessions = [session, ...sessions];
    return;
  }

  sessions = sessions.map((candidate) => (candidate.id === session.id ? session : candidate));
}
