import type { AssistantMessage, CompactionEntry, LogEntry, ToolCallMessage, ToolResultContent, WireEvent } from "./index.ts";

// effect/Schema decodes to readonly; a live log mutates the entries it owns in place.
export type Mutable<T> = T extends ReadonlyArray<infer U>
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;

// Set on a tool call orphaned by a bridge restart: its tool_result never arrived
// and never will, so cursor replay alone can't heal it.
export const TOOL_INTERRUPTED_MESSAGE = "Interrupted — the bridge restarted while this command was running.";

// The mutable accumulator the fold operates on. Callers wrap it with their own
// concerns — the mobile log adds a cursor and a reactivity counter; the host
// builds one transiently to reconstruct a cold-start snapshot.
export interface LogAccumulator {
  entries: Mutable<LogEntry>[];
  indexById: Map<string, number>;
}

export const emptyLog = (): LogAccumulator => ({ entries: [], indexById: new Map() });

export function appendLogEntry(acc: LogAccumulator, entry: LogEntry): void {
  acc.indexById.set(entry.id, acc.entries.length);
  acc.entries.push(entry as Mutable<LogEntry>);
}

export function findLogEntry(acc: LogAccumulator, id: string): Mutable<LogEntry> | undefined {
  const index = acc.indexById.get(id);
  if (index !== undefined && acc.entries[index]?.id === id) return acc.entries[index];

  const fallback = acc.entries.findIndex((entry) => entry.id === id);
  if (fallback >= 0) {
    acc.indexById.set(id, fallback);
    return acc.entries[fallback];
  }
  return undefined;
}

// Marks tool calls still "running" as interrupted — called by the caller when a
// turn has ended (or a reconstructed snapshot isn't mid-stream), so no
// tool_result is coming. Returns whether anything changed.
export function reconcileOrphanedToolCalls(acc: LogAccumulator): boolean {
  let changed = false;
  for (const entry of acc.entries) {
    if (entry.kind !== "tool_call" || entry.status !== "running") continue;
    entry.status = "error";
    if (!entry.result) entry.result = TOOL_INTERRUPTED_MESSAGE;
    changed = true;
  }
  return changed;
}

type AssistantEndMeta = Pick<AssistantMessage, "stopReason" | "errorMessage" | "errorCode" | "usage">;

function finalizeAssistant(message: Mutable<AssistantMessage>, meta: AssistantEndMeta): void {
  message.streaming = false;
  if (meta.stopReason) message.stopReason = meta.stopReason;
  if (meta.errorMessage) message.errorMessage = meta.errorMessage;
  if (meta.errorCode) message.errorCode = meta.errorCode;
  if (meta.usage) message.usage = meta.usage;
}

interface ToolResultLike {
  result: string;
  resultContent?: readonly ToolResultContent[];
  details?: unknown;
  status: "ok" | "error";
  durationMs: number;
}

function applyToolResult(entry: Mutable<ToolCallMessage>, data: ToolResultLike): void {
  entry.status = data.status;
  entry.result = data.result;
  if (data.resultContent) entry.resultContent = [...data.resultContent];
  else delete entry.resultContent;
  if (data.details !== undefined) entry.details = data.details;
  else delete entry.details;
  entry.durationMs = data.durationMs;
}

function applyCompaction(acc: LogAccumulator, entry: CompactionEntry): void {
  const existing = findLogEntry(acc, entry.id);
  if (existing?.kind !== "compaction") {
    appendLogEntry(acc, entry);
    return;
  }
  existing.at = entry.at;
  existing.status = entry.status;
  if (entry.reason) existing.reason = entry.reason;
  else delete existing.reason;
  if (entry.summary !== undefined) existing.summary = entry.summary;
  else delete existing.summary;
  if (entry.tokensBefore !== undefined) existing.tokensBefore = entry.tokensBefore;
  else delete existing.tokensBefore;
  if (entry.errorMessage !== undefined) existing.errorMessage = entry.errorMessage;
  else delete existing.errorMessage;
  if (entry.willRetry !== undefined) existing.willRetry = entry.willRetry;
  else delete existing.willRetry;
}

// The canonical WireEvent -> LogEntry fold, shared by the mobile live log and
// the host's cold-start snapshot so the two can't drift. `now` is the timestamp
// for a freshly streamed assistant entry (only `assistant_delta` uses it).
// Returns whether the log changed; events that don't produce entries
// (hello/status/cost/queue/…) return false and are the caller's concern.
export function reduceLog(acc: LogAccumulator, event: WireEvent, now: number): boolean {
  switch (event.t) {
    case "log_reset":
      acc.entries = event.entries.map((entry) => entry as Mutable<LogEntry>);
      acc.indexById = new Map(acc.entries.map((entry, i) => [entry.id, i]));
      return true;

    case "user_message":
      appendLogEntry(acc, event.entry);
      return true;

    case "assistant_delta": {
      const existing = findLogEntry(acc, event.id);
      if (existing?.kind === "assistant") {
        existing.text += event.text;
        existing.streaming = true;
      } else {
        appendLogEntry(acc, { kind: "assistant", id: event.id, at: now, text: event.text, streaming: true });
      }
      return true;
    }

    case "assistant_end": {
      const existing = findLogEntry(acc, event.id);
      if (existing?.kind === "assistant") {
        // Keep the streamed entry's `at`; adopt the authoritative final text.
        existing.text = event.text;
        finalizeAssistant(existing, event);
      } else {
        const message: Mutable<AssistantMessage> = { kind: "assistant", id: event.id, at: event.at, text: event.text, streaming: false };
        finalizeAssistant(message, event);
        appendLogEntry(acc, message);
      }
      return true;
    }

    case "tool_call":
      appendLogEntry(acc, event.entry);
      return true;

    case "tool_update": {
      const entry = findLogEntry(acc, event.id);
      if (entry?.kind !== "tool_call") return false;
      entry.result = event.result;
      if (event.resultContent) entry.resultContent = [...event.resultContent];
      if (event.details !== undefined) entry.details = event.details;
      return true;
    }

    case "tool_result": {
      const entry = findLogEntry(acc, event.id);
      if (entry?.kind !== "tool_call") return false;
      applyToolResult(entry, event);
      return true;
    }

    case "compaction":
      applyCompaction(acc, event.entry);
      return true;

    default:
      return false;
  }
}
