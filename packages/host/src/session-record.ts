import type { SessionMeta, SessionStatus } from "@pico/protocol";
import type { SessionRuntimeLifecycle } from "./session-lifecycle.ts";

export interface SessionRecord {
  id: string;
  title: string;
  cwd: string;
  status: SessionStatus;
  updatedAtMs: number;
  tokens: { in: number; out: number };
  costUsd: number;
  archived: boolean;
  lifecycle: SessionRuntimeLifecycle["kind"];
  /** Pi's persisted session id; differs from Pico's logical id after handoff. */
  runtimeSessionId: string;
  /** Exact JSONL binding for a handed-off terminal session. */
  runtimeSessionFile?: string;
}

export function toSessionMeta(record: SessionRecord): SessionMeta {
  return {
    id: record.id,
    title: record.title,
    cwd: record.cwd,
    status: record.status,
    updatedAt: new Date(record.updatedAtMs).toISOString(),
    tokens: record.tokens,
    costUsd: record.costUsd,
    archived: record.archived,
    execution: record.lifecycle === "presence" ? "terminal" : "host",
  };
}
