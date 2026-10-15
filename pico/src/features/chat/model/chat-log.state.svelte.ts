import type { AssistantMessage, Entry, HistoryPage, ImageContent, LogEntry, SendMode, SendStatus, ServerMessage, ToolCallMessage } from "@pico/protocol";
import {
  applyEntry,
  applyLiveEvent,
  emptyLive,
  emptyLog,
  endLiveItem,
  findLogEntry,
  reconcileOrphanedToolCalls,
  reindexLog,
  toolCallRow,
  type Mutable,
} from "@pico/protocol/log";
import { sendMessage } from "@/features/chat/api";
import { runRpc } from "@/shared/lib/rpc-client";
import { createOutboxStorage, type OutboxItem } from "./chat-outbox";
export type { OutboxItem } from "./chat-outbox";

export interface Reading {
  anchor: { entryId: string; top: number } | null;
  visibleCount: number;
  following: boolean;
}

interface SessionLog {
  entries: Mutable<LogEntry>[];
  indexById: Map<string, number>;
  leaf: string | null;
  more?: string;
  live: ReturnType<typeof emptyLive>;
  streaming: Mutable<AssistantMessage> | null;
  streamingCalls: Mutable<ToolCallMessage>[];
  outbox: OutboxItem[];
  outboxSaved: boolean;
  activityVersion: number;
  synced: boolean;
  reading?: Reading;
  toolOpen: Record<string, boolean>;
}

const logs = $state<Record<string, SessionLog>>({});
let activeSessionId = $state<string | null>(null);

const emptyEntries: LogEntry[] = [];
const emptyOutbox: OutboxItem[] = [];
const emptyCalls: ToolCallMessage[] = [];
const emptyLiveState = emptyLive();

const MAX_CACHED_LOGS = 3;
const recentLogKeys: string[] = [];
const KEEP_ROWS = 300;
const SEND_TIMEOUT_MS = 10_000;
const inflight = new Set<string>();

const activeLog = $derived(activeSessionId ? logs[activeSessionId] : undefined);

const outboxStorage = createOutboxStorage(() => localStorage);

function saveOutbox(sessionId: string, outbox: readonly OutboxItem[]): void {
  const saved = outboxStorage.save(sessionId, outbox);
  if (logs[sessionId]) logs[sessionId].outboxSaved = saved;
}

function getLog(sessionId: string): SessionLog {
  if (logs[sessionId]) return logs[sessionId];
  const restored = outboxStorage.load(sessionId);
  logs[sessionId] = {
    ...emptyLog(),
    leaf: null,
    live: emptyLive(),
    streaming: null,
    streamingCalls: [],
    outbox: restored.items,
    outboxSaved: restored.saved,
    activityVersion: 0,
    synced: false,
    toolOpen: {},
  };
  return logs[sessionId];
}

function overlayTool(log: SessionLog, tool: SessionLog["live"]["tools"][number]): void {
  const row = findLogEntry(log, tool.id);
  if (row?.kind !== "tool_call" || row.status !== "running") return;
  row.result = tool.text;
  if (tool.details !== undefined) row.details = tool.details;
}

function syncStreaming(log: SessionLog): void {
  const msg = log.live.msg;
  if (!msg) log.streaming = null;
  else if (log.streaming?.at === msg.at) log.streaming.text = msg.text;
  else log.streaming = { kind: "assistant", id: `live:${msg.at}`, at: msg.at, text: msg.text, streaming: true };
}

const parseArgs = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
};

function syncStreamingCalls(log: SessionLog): void {
  const msg = log.live.msg;
  log.streamingCalls = (msg?.calls ?? []).map((call) => {
    const fresh = toolCallRow({ id: call.id, name: call.name, args: parseArgs(call.args) }, msg?.at ?? 0, "pending");
    const row = log.streamingCalls.find((candidate) => candidate.id === call.id);
    return row ? Object.assign(row, fresh) : (fresh as Mutable<ToolCallMessage>);
  });
}

function arrivedAfterBase(log: SessionLog, item: OutboxItem): boolean {
  const from = item.base === null ? undefined : log.indexById.get(item.base);
  if (from === undefined) return false;
  return log.entries.slice(from + 1).some((row) => row.kind === "user" && (row.text === item.text || row.text.startsWith(`${item.text}\n\n`)));
}

function applyStatus(sessionId: string, status: SendStatus): void {
  const log = logs[sessionId];
  const item = log?.outbox.find((candidate) => candidate.cid === status.cid);
  if (!item) return;
  if (status.state === "delivered" || status.state === "handled" || status.state === "cleared") {
    log.outbox = log.outbox.filter((candidate) => candidate !== item);
  } else {
    item.state = status.state;
    if (status.error) item.error = status.error;
    else delete item.error;
  }
  saveOutbox(sessionId, log.outbox);
}

async function post(sessionId: string, cid: string): Promise<void> {
  const log = logs[sessionId];
  const item = log?.outbox.find((candidate) => candidate.cid === cid);
  if (!item || inflight.has(cid)) return;
  inflight.add(cid);
  item.tries += 1;
  item.state = "sending";
  delete item.error;
  saveOutbox(sessionId, log.outbox);
  const attempt = item.tries;
  const timer = setTimeout(() => {
    if (item.state !== "sending" || item.tries !== attempt) return;
    item.state = "failed";
    saveOutbox(sessionId, log.outbox);
  }, SEND_TIMEOUT_MS);
  try {
    const { text, mode, images, base } = item;
    applyStatus(sessionId, await runRpc(sendMessage(sessionId, { cid, text, mode, images, base, retry: attempt > 1 })));
  } catch (error) {
    if ((error as { _tag?: string })._tag === "SessionNotFound") {
      applyStatus(sessionId, { cid, state: "failed", error: "the session was deleted" });
    } else if (item.state === "sending" && item.tries === attempt) {
      item.state = "failed";
      saveOutbox(sessionId, log.outbox);
    }
  } finally {
    clearTimeout(timer);
    inflight.delete(cid);
  }
}

function reconcileOutbox(sessionId: string, log: SessionLog, sends: readonly SendStatus[]): void {
  for (const status of sends) applyStatus(sessionId, status);
  const known = new Set(sends.map((status) => status.cid));
  for (const item of log.outbox) {
    if (known.has(item.cid)) continue;
    if (item.state === "sending" || item.state === "started" || (item.state === "failed" && !item.error)) void post(sessionId, item.cid);
    else if (item.state === "queued" || item.state === "held") {
      if (arrivedAfterBase(log, item)) applyStatus(sessionId, { cid: item.cid, state: "delivered" });
      else item.state = "lost";
    }
  }
  saveOutbox(sessionId, log.outbox);
}

function applyEntries(sessionId: string, log: SessionLog, entries: readonly Entry[]): void {
  for (const entry of entries) {
    applyEntry(log, entry);
    endLiveItem(log.live, entry);
    if (entry.type === "user" && entry.cid) applyStatus(sessionId, { cid: entry.cid, state: "delivered" });
  }
}

function apply(sessionId: string, message: ServerMessage): void {
  const log = getLog(sessionId);
  switch (message.t) {
    case "sync":
      if (message.reset) {
        Object.assign(log, emptyLog());
        log.more = message.more;
        log.reading = undefined;
      }
      log.live = message.live as SessionLog["live"];
      applyEntries(sessionId, log, message.entries);
      log.leaf = message.leaf;
      for (const tool of log.live.tools) overlayTool(log, tool);
      if (!log.live.running) reconcileOrphanedToolCalls(log);
      reconcileOutbox(sessionId, log, message.sends);
      log.synced = true;
      break;
    case "entries":
      applyEntries(sessionId, log, message.entries);
      log.leaf = message.leaf;
      break;
    case "send":
      applyStatus(sessionId, message);
      break;
    case "meta":
      return;
    default: {
      const tool = applyLiveEvent(log.live, message);
      if (tool) overlayTool(log, tool);
      if (message.t === "run" && !message.running) reconcileOrphanedToolCalls(log);
    }
  }
  syncStreaming(log);
  if (message.t !== "d" && message.t !== "out") syncStreamingCalls(log);
  log.activityVersion += 1;
}

export const chatLogState = {
  get entries() {
    return activeLog?.entries ?? emptyEntries;
  },

  get streaming() {
    return activeLog?.streaming ?? null;
  },

  get streamingCalls() {
    return activeLog?.streamingCalls ?? emptyCalls;
  },

  get live() {
    return activeLog?.live ?? emptyLiveState;
  },

  get outbox() {
    const log = activeLog;
    if (!log) return emptyOutbox;
    return log.outbox.filter((item) => !log.live.queue.some((queued) => queued.cid === item.cid));
  },

  get outboxSaved() { return !activeLog?.outbox.length || activeLog.outboxSaved; },

  images(cid: string | undefined): ImageContent[] | undefined {
    return cid === undefined ? undefined : activeLog?.outbox.find((item) => item.cid === cid)?.images;
  },

  get activityVersion() {
    return activeLog?.activityVersion ?? 0;
  },

  get more() {
    return activeLog?.more;
  },

  get synced() {
    return activeLog?.synced ?? false;
  },

  reading(sessionId: string): Reading | undefined {
    return logs[sessionId]?.reading;
  },

  saveReading(sessionId: string, reading: Reading): void {
    const log = logs[sessionId];
    if (log) log.reading = reading;
  },

  toolOpen(id: string): boolean | undefined {
    return activeLog?.toolOpen[id];
  },

  setToolOpen(id: string, open: boolean): void {
    if (activeLog) activeLog.toolOpen[id] = open;
  },

  activate(sessionId: string): void {
    activeSessionId = sessionId;
    const at = recentLogKeys.indexOf(sessionId);
    if (at >= 0) recentLogKeys.splice(at, 1);
    recentLogKeys.push(sessionId);
    for (const stale of recentLogKeys.splice(0, Math.max(0, recentLogKeys.length - MAX_CACHED_LOGS))) {
      delete logs[stale];
    }
    const log = logs[sessionId];
    if (!log || log.entries.length <= KEEP_ROWS * 1.5 || (log.reading && !log.reading.following)) return;
    const start = log.entries.findIndex((row, index) => index >= log.entries.length - KEEP_ROWS && row.kind === "user");
    if (start <= 0) return;
    log.more = log.entries[start].id;
    log.entries = log.entries.slice(start);
    reindexLog(log);
  },

  connectParams(sessionId: string): { head: string | null; cids: string[] } {
    const log = getLog(sessionId);
    return { head: log.leaf, cids: log.outbox.map((item) => item.cid) };
  },

  apply,

  prependHistory(sessionId: string, page: HistoryPage): number {
    const log = getLog(sessionId);
    const older = emptyLog();
    for (const entry of page.entries) applyEntry(older, entry);
    const rows = older.entries.filter((row) => !log.indexById.has(row.id));
    log.entries = [...rows, ...log.entries];
    log.more = page.more;
    reindexLog(log);
    log.activityVersion += 1;
    return rows.length;
  },

  send(sessionId: string, message: { text: string; mode: SendMode; images?: ImageContent[] }): void {
    const log = getLog(sessionId);
    const cid = crypto.randomUUID();
    log.outbox.push({ cid, ...message, base: log.leaf, state: "sending", tries: 0, sentDuringRun: log.live.running });
    log.activityVersion += 1;
    void post(sessionId, cid);
  },

  retry(cid: string): void {
    if (activeSessionId) void post(activeSessionId, cid);
  },

  discard(cid: string): OutboxItem | undefined {
    const log = activeLog;
    const item = log?.outbox.find((candidate) => candidate.cid === cid);
    if (!log || !item || !activeSessionId) return undefined;
    log.outbox = log.outbox.filter((candidate) => candidate !== item);
    saveOutbox(activeSessionId, log.outbox);
    return item;
  },
};
