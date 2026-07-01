import type { SessionMeta } from "@pico/protocol";
import { Effect } from "effect";
import { hostRegistryState, type HostProfile } from "@/features/hosts/host-registry.state.svelte";
import {
  createSession as createSessionRequest,
  deleteSession as deleteSessionRequest,
  loadSessionList,
  renameSession as renameSessionRequest,
  setSessionArchived,
  type CreateSessionInput,
} from "@/features/sessions/api";
import { clearChatDraft } from "@/features/chat/model/chat-draft";
import { type PicoClient, runOnHost } from "@/shared/lib/rpc-client";
import { classifyHostFailure, classifyHostIssue, type HostIssue } from "@/shared/lib/host-issues";

export interface HostSessionMeta {
  hostId: string;
  hostName: string;
  session: SessionMeta;
}

export interface HostSessionIssue {
  hostId: string;
  hostName: string;
  issue: HostIssue;
}

let sessionsByHost = $state<Record<string, SessionMeta[] | undefined>>({});
let errorsByHost = $state<Record<string, HostIssue | undefined>>({});
let archivedView = $state(false);
let refreshing = $state(false);
let creating = $state(false);
let mutatingSessionKey = $state<string | null>(null);

const sessions = $derived.by(() => {
  const rows: HostSessionMeta[] = [];
  for (const host of hostRegistryState.hosts) {
    for (const session of sessionsByHost[host.id] ?? []) {
      rows.push({ hostId: host.id, hostName: host.name, session });
    }
  }
  return rows.sort((a, b) => Date.parse(b.session.updatedAt) - Date.parse(a.session.updatedAt));
});

const hostIssues = $derived.by(() => {
  const issues: HostSessionIssue[] = [];
  for (const host of hostRegistryState.hosts) {
    const issue = errorsByHost[host.id];
    if (issue) issues.push({ hostId: host.id, hostName: host.name, issue });
  }
  return issues;
});

const visibleCount = $derived(sessions.length);

const recordError = (host: HostProfile, caught: unknown) =>
  classifyHostFailure(caught, { url: host.url }).pipe(
    Effect.andThen((issue) => Effect.sync(() => { errorsByHost[host.id] = issue; })),
  );

async function recordHostError(host: HostProfile, caught: unknown): Promise<void> {
  try {
    await runOnHost(host.id, recordError(host, caught));
  } catch {
    errorsByHost[host.id] = classifyHostIssue(caught, { url: host.url });
  }
}

function hostOrThrow(hostId: string): HostProfile {
  const host = hostRegistryState.getHost(hostId);
  if (!host) throw new Error(`Pico host not found: ${hostId}`);
  return host;
}

function removeLocal(hostId: string, sessionId: string): void {
  const current = sessionsByHost[hostId];
  if (!current) return;
  const index = current.findIndex((session) => session.id === sessionId);
  if (index !== -1) current.splice(index, 1);
}

function replaceSession(hostId: string, session: SessionMeta): void {
  const current = sessionsByHost[hostId];
  if (!current) {
    sessionsByHost[hostId] = [session];
    return;
  }
  const index = current.findIndex((candidate) => candidate.id === session.id);
  if (index === -1) current.unshift(session);
  else current[index] = session;
}

async function refreshHost(host: HostProfile): Promise<void> {
  try {
    const list = await runOnHost(host.id, loadSessionList({ archived: archivedView }));
    sessionsByHost[host.id] = [...list];
    errorsByHost[host.id] = undefined;
  } catch (caught) {
    sessionsByHost[host.id] = [];
    await recordHostError(host, caught);
  }
}

async function mutate<A, E>(hostId: string, sessionId: string, effect: Effect.Effect<A, E, PicoClient>): Promise<A> {
  if (mutatingSessionKey) throw new Error("session mutation already in progress");
  const host = hostOrThrow(hostId);
  mutatingSessionKey = `${hostId}:${sessionId}`;
  try {
    const result = await runOnHost(hostId, effect);
    errorsByHost[hostId] = undefined;
    return result;
  } catch (caught) {
    await recordHostError(host, caught);
    throw caught;
  } finally {
    mutatingSessionKey = null;
  }
}

export const sessionListState = {
  get sessions() { return sessions; },
  get archivedView() { return archivedView; },
  get refreshing() { return refreshing; },
  get creating() { return creating; },
  get mutatingSessionKey() { return mutatingSessionKey; },
  get visibleCount() { return visibleCount; },
  get hostIssues() { return hostIssues; },
  get error() { return hostIssues[0]?.issue ?? null; },

  clearError(): void {
    for (const hostId of Object.keys(errorsByHost)) delete errorsByHost[hostId];
  },
  clearHostError(hostId: string): void { errorsByHost[hostId] = undefined; },
  upsert(hostId: string, session: SessionMeta): void { replaceSession(hostId, session); },
  patchLocal(hostId: string, sessionId: string, patch: Partial<SessionMeta>): void {
    const session = sessionsByHost[hostId]?.find((candidate) => candidate.id === sessionId);
    if (session) Object.assign(session, patch);
  },
  removeLocal,

  async refresh(): Promise<void> {
    if (!hostRegistryState.loaded) await hostRegistryState.load();
    refreshing = true;
    try {
      await Promise.all(hostRegistryState.hosts.map((host) => refreshHost(host)));
    } finally {
      refreshing = false;
    }
  },

  async refreshHost(hostId: string): Promise<void> {
    await refreshHost(hostOrThrow(hostId));
  },

  async switchArchivedView(next: boolean): Promise<void> {
    if (archivedView === next) return;
    archivedView = next;
    await this.refresh();
  },

  async create(input: CreateSessionInput & { hostId: string }): Promise<HostSessionMeta> {
    if (creating) throw new Error("session creation already in progress");
    const host = hostOrThrow(input.hostId);
    creating = true;
    try {
      const result = await runOnHost(
        input.hostId,
        Effect.gen(function* () {
          const session = yield* createSessionRequest({ cwd: input.cwd, title: input.title });
          const list = yield* loadSessionList({ archived: false });
          return { session, list };
        }),
      );
      archivedView = false;
      sessionsByHost[input.hostId] = [...result.list];
      errorsByHost[input.hostId] = undefined;
      return { hostId: host.id, hostName: host.name, session: result.session };
    } catch (caught) {
      await recordHostError(host, caught);
      throw caught;
    } finally {
      creating = false;
    }
  },

  rename(hostId: string, sessionId: string, title: string): Promise<SessionMeta> {
    return mutate(
      hostId,
      sessionId,
      renameSessionRequest(sessionId, title).pipe(Effect.tap((session) => Effect.sync(() => replaceSession(hostId, session)))),
    );
  },

  setArchived(hostId: string, sessionId: string, archived: boolean): Promise<SessionMeta> {
    return mutate(
      hostId,
      sessionId,
      setSessionArchived(sessionId, archived).pipe(Effect.tap(() => Effect.sync(() => removeLocal(hostId, sessionId)))),
    );
  },

  delete(hostId: string, sessionId: string): Promise<void> {
    return mutate(
      hostId,
      sessionId,
      deleteSessionRequest(sessionId).pipe(
        Effect.tap(() => Effect.promise(() => clearChatDraft(hostId, sessionId).catch(() => undefined))),
        Effect.tap(() => Effect.sync(() => removeLocal(hostId, sessionId))),
        Effect.asVoid,
      ),
    );
  },
};
