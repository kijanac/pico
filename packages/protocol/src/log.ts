import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  CustomToolArgs,
  hasToolDetails,
  ToolCallMessage,
  type Entry,
  type Live,
  type LiveEvent,
  type LogEntry,
  type ToolCall,
} from "./index.ts";

// effect/Schema decodes to readonly; a live log mutates the entries it owns in place.
export type Mutable<T> = T extends ReadonlyArray<infer U>
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;

// Set on a tool call whose result pi never saved (the host stopped mid-tool).
export const TOOL_INTERRUPTED_MESSAGE = "Interrupted — the host stopped while this was running.";

// The rows on screen, folded from pi's entries.
export interface LogAccumulator {
  entries: Mutable<LogEntry>[];
  indexById: Map<string, number>;
}

export const emptyLog = (): LogAccumulator => ({ entries: [], indexById: new Map() });

export const emptyLive = (): Mutable<Live> => ({ running: false, compacting: false, tools: [], queue: [], ui: [] });

function appendLogEntry(acc: LogAccumulator, entry: LogEntry): void {
  acc.indexById.set(entry.id, acc.entries.length);
  acc.entries.push(entry as Mutable<LogEntry>);
}

export function findLogEntry(acc: LogAccumulator, id: string): Mutable<LogEntry> | undefined {
  const index = acc.indexById.get(id);
  return index === undefined ? undefined : acc.entries[index];
}

export function reindexLog(acc: LogAccumulator): void {
  acc.indexById = new Map(acc.entries.map((entry, i) => [entry.id, i]));
}

// Marks tool calls still "running" as interrupted. Callers run it when no run
// is active, so no result is coming. Returns whether anything changed.
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

// Folds one of pi's entries into rows: an assistant message becomes its row
// plus one per tool call, and a tool result completes its call's row. An entry
// already folded is skipped, so overlapping batches are harmless.
export function applyEntry(acc: LogAccumulator, entry: Entry): void {
  // A tool result's own id is never a row, so this only skips repeats.
  if (acc.indexById.has(entry.id)) return;
  switch (entry.type) {
    case "user": {
      const { type: _, ...rest } = entry;
      appendLogEntry(acc, { kind: "user", ...rest });
      return;
    }
    case "assistant": {
      const { type: _, tools, ...rest } = entry;
      appendLogEntry(acc, { kind: "assistant", ...rest });
      for (const call of tools) if (!acc.indexById.has(call.id)) appendLogEntry(acc, toolCallRow(call, entry.at));
      return;
    }
    case "tool_result": {
      const row = findLogEntry(acc, entry.toolCallId);
      if (row?.kind === "tool_call") completeToolCall(row, entry);
      return;
    }
    case "compaction":
      appendLogEntry(acc, {
        kind: "compaction",
        id: entry.id,
        at: entry.at,
        status: "success",
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
      });
      return;
    case "note": {
      const { type: _, ...rest } = entry;
      appendLogEntry(acc, { kind: "note", ...rest });
    }
  }
}

const decodeToolCall = Schema.decodeUnknownOption(ToolCallMessage);
const decodeCustomArgs = Schema.decodeUnknownOption(CustomToolArgs);

// A builtin tool's row when its args have that tool's shape, else a custom
// tool's row, so a call the phone can't model still shows. "pending" while the
// model is still writing its arguments.
export function toolCallRow(call: ToolCall, at: number, status: "pending" | "running" = "running"): ToolCallMessage {
  const row = { kind: "tool_call", id: call.id, at, status, tool: call.name } as const;
  return Option.getOrElse(
    decodeToolCall({ ...row, toolKind: "builtin", args: call.args }),
    (): ToolCallMessage => ({
      ...row,
      toolKind: "custom",
      args: Option.getOrElse(decodeCustomArgs(call.args), (): CustomToolArgs => ({})),
    }),
  );
}

function completeToolCall(row: Mutable<ToolCallMessage>, result: Extract<Entry, { type: "tool_result" }>): void {
  row.status = result.isError ? "error" : "ok";
  // pi saves no durations; the gap from the call's message to its result is close.
  row.durationMs = Math.max(0, result.at - row.at);
  if (result.result !== undefined) row.result = result.result;
  else delete row.result;
  if (result.resultContent) row.resultContent = [...result.resultContent] as Mutable<typeof result.resultContent>;
  else delete row.resultContent;
  if (hasToolDetails(result.details)) row.details = result.details;
  else delete row.details;
}

type TextChange = { drop?: number; from: number; s: string };

const commonPrefixLength = (a: string, b: string): number => {
  let i = 0;
  while (i < a.length && i < b.length && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
};

// The smaller of two ways to turn `before` into `after`: keep their common
// start and append, or drop what fell off the top of a tail window (bash
// keeps only its last 50 KB) and append.
export function textChange(before: string, after: string): TextChange {
  const from = commonPrefixLength(before, after);
  const kept: TextChange = { from, s: after.slice(from) };
  const probe = after.slice(0, 64);
  // A few candidates bound the cost on repetitive output.
  for (let drop = before.indexOf(probe, 1), tries = 0; probe && drop > 0 && tries < 16; drop = before.indexOf(probe, drop + 1), tries += 1) {
    if (!after.startsWith(before.slice(drop))) continue;
    const s = after.slice(before.length - drop);
    return s.length < kept.s.length ? { drop, from: before.length, s } : kept;
  }
  return kept;
}

export const applyTextChange = (before: string, change: TextChange): string =>
  before.slice(change.drop ?? 0, change.from) + change.s;

// Applies a change to the live mirror. Returns the running tool it changed,
// if any, so the phone can show the new output on that tool's row.
export function applyLiveEvent(live: Mutable<Live>, event: LiveEvent): Mutable<Live["tools"][number]> | undefined {
  switch (event.t) {
    case "msg":
      live.msg = { at: event.at, text: "", calls: [] };
      return;
    case "d":
      live.msg ??= { at: Date.now(), text: "", calls: [] };
      live.msg.text += event.s;
      return;
    case "call": {
      live.msg ??= { at: Date.now(), text: "", calls: [] };
      let call = live.msg.calls.find((candidate) => candidate.id === event.id);
      if (!call) {
        call = { id: event.id, name: event.name, args: "" };
        live.msg.calls.push(call);
      }
      call.args = applyTextChange(call.args, event);
      return;
    }
    case "out": {
      let tool = live.tools.find((candidate) => candidate.id === event.id);
      if (!tool) {
        tool = { id: event.id, text: "" };
        live.tools.push(tool);
      }
      tool.text = applyTextChange(tool.text, event);
      if (event.details !== undefined) tool.details = event.details;
      return tool;
    }
    case "run":
      live.running = event.running;
      live.compacting = event.compacting;
      if (event.retry) live.retry = { ...event.retry };
      else delete live.retry;
      // Nothing streams once the run is over; whatever pi kept is in its entries.
      if (!event.running) {
        delete live.msg;
        live.tools = [];
      }
      return;
    case "queue":
      live.queue = event.queue.map((item) => ({ ...item }));
      return;
    case "ui": {
      if (event.request.kind !== "confirm" && event.request.kind !== "select" && event.request.kind !== "input") return;
      const at = live.ui.findIndex((request) => request.id === event.request.id);
      if (at >= 0) live.ui[at] = event.request as Mutable<Live["ui"][number]>;
      else live.ui.push(event.request as Mutable<Live["ui"][number]>);
      return;
    }
    case "ui_done":
      live.ui = live.ui.filter((request) => request.id !== event.id);
      return;
    case "elsewhere":
      if (event.elsewhere) live.elsewhere = { ...event.elsewhere };
      else delete live.elsewhere;
      return;
  }
}

// A saved entry ends the live item it records: the assistant entry replaces
// the streamed reply, and a tool result ends that tool's live output.
export function endLiveItem(live: Mutable<Live>, entry: Entry): void {
  if (entry.type === "assistant") delete live.msg;
  else if (entry.type === "tool_result") live.tools = live.tools.filter((tool) => tool.id !== entry.toolCallId);
}
