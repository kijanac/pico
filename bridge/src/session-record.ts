import * as v from "valibot";
import { SessionStatus, type SessionMeta } from "@pi-mobile/protocol";

export const WorkspaceBinding = v.variant("kind", [
  v.object({ kind: v.literal("plain") }),
  v.object({
    kind: v.literal("git-worktree"),
    repoRoot: v.string(),
    worktreePath: v.string(),
    branch: v.string(),
    ownedBySession: v.literal(true),
  }),
]);
export type WorkspaceBinding = v.InferOutput<typeof WorkspaceBinding>;

export interface SessionRecord {
  id: string;
  title: string;
  cwd: string;
  branch?: string;
  status: v.InferOutput<typeof SessionStatus>;
  updatedAtMs: number;
  tokens: { in: number; out: number };
  costUsd: number;
  archived: boolean;
  runtime: {
    executionCwd: string;
    workspace: WorkspaceBinding;
  };
}

export function toSessionMeta(record: SessionRecord): SessionMeta {
  const { runtime: _runtime, updatedAtMs, ...rest } = record;
  return {
    ...rest,
    updatedAt: new Date(updatedAtMs).toISOString(),
  };
}

export function parseWorkspaceBinding(raw: unknown): WorkspaceBinding {
  return v.parse(WorkspaceBinding, raw);
}

export function metaToRecord(meta: SessionMeta, executionCwd = meta.cwd, workspace: WorkspaceBinding = { kind: "plain" }): SessionRecord {
  return {
    id: meta.id,
    title: meta.title,
    cwd: meta.cwd,
    branch: meta.branch,
    status: meta.status,
    updatedAtMs: Date.parse(meta.updatedAt),
    tokens: meta.tokens,
    costUsd: meta.costUsd,
    archived: meta.archived,
    runtime: { executionCwd, workspace },
  };
}
