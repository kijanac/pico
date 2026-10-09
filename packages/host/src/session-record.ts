import type { SessionMeta, SessionStatus } from "@pico/protocol";
import type { Cursor } from "./transcript.ts";

export interface SessionRecord {
  id: string;
  title: string;
  cwd: string;
  status: SessionStatus;
  updatedAtMs: number;
  tokens: { in: number; out: number };
  costUsd: number;
  archived: boolean;
  // pi's file for the session; null until pi has saved it.
  path: string | null;
  // Where the phone stands in it; null until it has opened it.
  cursor: Cursor | null;
}

// What the session list shows of a pi session file, read from the file.
export type FileSession = Pick<SessionRecord, "id" | "title" | "cwd" | "updatedAtMs" | "tokens" | "costUsd">;

// A pi session file and a stamp that changes whenever pi writes to it.
export interface SessionFile {
  path: string;
  stamp: string;
}

export function toSessionMeta(record: SessionRecord): SessionMeta {
  const { updatedAtMs, path: _path, cursor: _cursor, ...rest } = record;
  return {
    ...rest,
    updatedAt: new Date(updatedAtMs).toISOString(),
  };
}
