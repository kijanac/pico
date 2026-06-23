import type { SessionMeta, SessionStatus } from "@pico/protocol";

export interface SessionRecord {
  id: string;
  title: string;
  cwd: string;
  status: SessionStatus;
  updatedAtMs: number;
  tokens: { in: number; out: number };
  costUsd: number;
  archived: boolean;
}

export function toSessionMeta(record: SessionRecord): SessionMeta {
  const { updatedAtMs, ...rest } = record;
  return {
    ...rest,
    updatedAt: new Date(updatedAtMs).toISOString(),
  };
}
