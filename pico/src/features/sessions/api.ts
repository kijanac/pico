import { rpc } from "@/shared/lib/rpc-client";

export interface LoadSessionListOptions {
  archived?: boolean;
  // Check pi's session files for changes first, rather than the stored list.
  fresh?: boolean;
}

export interface CreateSessionInput {
  cwd: string;
  // pi's session name; unnamed sessions show their first message.
  title?: string;
}

export const loadSessionList = (opts?: LoadSessionListOptions) =>
  rpc((c) => c.sessions.list({ archived: opts?.archived, fresh: opts?.fresh }));

export const createSession = (input: CreateSessionInput) => rpc((c) => c.sessions.create(input));

export const renameSession = (sessionId: string, title: string) =>
  rpc((c) => c.sessions.patch({ id: sessionId, title }));

export const setSessionArchived = (sessionId: string, archived: boolean) =>
  rpc((c) => c.sessions.patch({ id: sessionId, archived }));

export const deleteSession = (sessionId: string) => rpc((c) => c.sessions.remove({ id: sessionId }));

export const listDirectories = (path?: string) => rpc((c) => c.fs.ls({ path }));
