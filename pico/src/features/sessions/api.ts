import { rpc } from "@/shared/lib/rpc-client";

export interface LoadSessionListOptions {
  archived?: boolean;
}

export interface CreateSessionInput {
  cwd: string;
  title: string;
}

export const loadSessionList = (opts?: LoadSessionListOptions) =>
  rpc((c) => c.sessions.list({ archived: opts?.archived }));

export const createSession = (input: CreateSessionInput) => rpc((c) => c.sessions.create(input));

export const renameSession = (sessionId: string, title: string) =>
  rpc((c) => c.sessions.patch({ id: sessionId, title }));

export const setSessionArchived = (sessionId: string, archived: boolean) =>
  rpc((c) => c.sessions.patch({ id: sessionId, archived }));

export const deleteSession = (sessionId: string) => rpc((c) => c.sessions.remove({ id: sessionId }));

export const listDirectories = (path?: string) => rpc((c) => c.fs.ls({ path }));
