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

// A message on its way: shown as pending until pi's entry with its cid (or a
// queue item) arrives. Retries reuse the cid, so the host can't double-send.
export interface OutboxItem {
  cid: string;
  text: string;
  mode: SendMode;
  images?: ImageContent[];
  // The bookmark when first sent; on a retry the host looks after it in pi's
  // file, in case a restart made it forget the cid.
  base: string | null;
  // lost: it was queued when the host restarted (pi's queue isn't saved).
  // failed without `error`: no answer in time; it retries on reconnect.
  state: "sending" | "started" | "queued" | "held" | "failed" | "lost";
  error?: string;
  tries: number;
}

interface SessionLog {
  // The rows on screen, folded from pi's entries.
  entries: Mutable<LogEntry>[];
  indexById: Map<string, number>;
  // The newest pi entry held: the bookmark to catch up from.
  leaf: string | null;
  // The oldest pi entry held, when there are older ones to page in.
  more?: string;
  live: ReturnType<typeof emptyLive>;
  // The reply being streamed, and the tool calls the model is still writing, as rows.
  streaming: Mutable<AssistantMessage> | null;
  streamingCalls: Mutable<ToolCallMessage>[];
  outbox: OutboxItem[];
  activityVersion: number;
}

const logs = $state<Record<string, SessionLog>>({});
let activeSessionId = $state<string | null>(null);

const emptyEntries: LogEntry[] = [];
const emptyOutbox: OutboxItem[] = [];
const emptyCalls: ToolCallMessage[] = [];
const emptyLiveState = emptyLive();

// Recently opened sessions keep their logs for instant back-navigation and
// catch up from their bookmark; older ones are dropped.
const MAX_CACHED_LOGS = 3;
const recentLogKeys: string[] = [];
// A reopened log keeps about this many rows; older ones page back in on scroll.
const KEEP_ROWS = 300;
// A send with no answer by then shows as not delivered, with a retry.
const SEND_TIMEOUT_MS = 10_000;
// cids with a POST on the wire, so a reconnect or a tap doesn't send another.
const inflight = new Set<string>();

const activeLog = $derived(activeSessionId ? logs[activeSessionId] : undefined);

const outboxKey = (sessionId: string) => `chat:outbox:${sessionId}`;

function loadOutbox(sessionId: string): OutboxItem[] {
  try {
    return JSON.parse(localStorage.getItem(outboxKey(sessionId)) ?? "[]") as OutboxItem[];
  } catch {
    return [];
  }
}

function saveOutbox(sessionId: string, outbox: readonly OutboxItem[]): void {
  const key = outboxKey(sessionId);
  try {
    if (outbox.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(outbox));
  } catch {
    // Over quota with images: keep the text at least.
    try {
      localStorage.setItem(key, JSON.stringify(outbox.map(({ images: _, ...item }) => item)));
    } catch {}
  }
}

function getLog(sessionId: string): SessionLog {
  logs[sessionId] ??= {
    ...emptyLog(),
    leaf: null,
    live: emptyLive(),
    streaming: null,
    streamingCalls: [],
    outbox: loadOutbox(sessionId),
    activityVersion: 0,
  };
  return logs[sessionId];
}

// Shows a running tool's live output on its row until its result arrives.
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

// Each row stays the same object while its arguments grow, like the reply's.
function syncStreamingCalls(log: SessionLog): void {
  const msg = log.live.msg;
  log.streamingCalls = (msg?.calls ?? []).map((call) => {
    const fresh = toolCallRow({ id: call.id, name: call.name, args: parseArgs(call.args) }, msg?.at ?? 0, "pending");
    const row = log.streamingCalls.find((candidate) => candidate.id === call.id);
    return row ? Object.assign(row, fresh) : (fresh as Mutable<ToolCallMessage>);
  });
}

// After a host restart pi's file decides: a queued message that arrived before
// it shows up after the bookmark it was sent from. Unknown when that bookmark
// isn't on screen; "send again" then asks the host, which can follow pi's file.
function arrivedAfterBase(log: SessionLog, item: OutboxItem): boolean {
  const from = item.base === null ? undefined : log.indexById.get(item.base);
  if (from === undefined) return false;
  return log.entries.slice(from + 1).some((row) => row.kind === "user" && (row.text === item.text || row.text.startsWith(`${item.text}\n\n`)));
}

function applyStatus(sessionId: string, status: SendStatus): void {
  // A log dropped from the cache since; its outbox is reconciled on reopening.
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
    // Only a deleted session is final; anything else (the network, a host
    // restarting) retries on reconnect.
    if ((error as { _tag?: string })._tag === "SessionNotFound") {
      applyStatus(sessionId, { cid, state: "failed", error: "the session was deleted" });
    }
  } finally {
    clearTimeout(timer);
    inflight.delete(cid);
  }
}

// After a sync: what the host reports, else resend what it never answered.
function reconcileOutbox(sessionId: string, log: SessionLog, sends: readonly SendStatus[]): void {
  for (const status of sends) applyStatus(sessionId, status);
  const known = new Set(sends.map((status) => status.cid));
  for (const item of log.outbox) {
    if (known.has(item.cid)) continue;
    // Unknown to the host: never answered, or the host restarted since.
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
      }
      log.live = message.live as SessionLog["live"];
      applyEntries(sessionId, log, message.entries);
      log.leaf = message.leaf;
      for (const tool of log.live.tools) overlayTool(log, tool);
      if (!log.live.running) reconcileOrphanedToolCalls(log);
      reconcileOutbox(sessionId, log, message.sends);
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
  // Not per text delta or tool output: parsing a long call's arguments isn't free.
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

  // Sends to show as pending or failed; queued ones show in the queue.
  get outbox() {
    const log = activeLog;
    if (!log) return emptyOutbox;
    return log.outbox.filter((item) => !log.live.queue.some((queued) => queued.cid === item.cid));
  },

  // A send's images, for its queue row (pi's queue keeps only text).
  images(cid: string | undefined): ImageContent[] | undefined {
    return cid === undefined ? undefined : activeLog?.outbox.find((item) => item.cid === cid)?.images;
  },

  get activityVersion() {
    return activeLog?.activityVersion ?? 0;
  },

  get more() {
    return activeLog?.more;
  },

  activate(sessionId: string): void {
    activeSessionId = sessionId;
    const at = recentLogKeys.indexOf(sessionId);
    if (at >= 0) recentLogKeys.splice(at, 1);
    recentLogKeys.push(sessionId);
    for (const stale of recentLogKeys.splice(0, Math.max(0, recentLogKeys.length - MAX_CACHED_LOGS))) {
      delete logs[stale];
    }
    // Trim a reopened log to its newest rows, starting at a user message.
    const log = logs[sessionId];
    if (!log || log.entries.length <= KEEP_ROWS * 1.5) return;
    const start = log.entries.findIndex((row, index) => index >= log.entries.length - KEEP_ROWS && row.kind === "user");
    if (start <= 0) return;
    log.more = log.entries[start].id;
    log.entries = log.entries.slice(start);
    reindexLog(log);
  },

  // What the live socket connects with: the bookmark and the unconfirmed sends.
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
    log.outbox.push({ cid, ...message, base: log.leaf, state: "sending", tries: 0 });
    log.activityVersion += 1;
    void post(sessionId, cid);
  },

  retry(cid: string): void {
    if (activeSessionId) void post(activeSessionId, cid);
  },

  // Drops a failed send and returns it, for the composer.
  discard(cid: string): OutboxItem | undefined {
    const log = activeLog;
    const item = log?.outbox.find((candidate) => candidate.cid === cid);
    if (!log || !item || !activeSessionId) return undefined;
    log.outbox = log.outbox.filter((candidate) => candidate !== item);
    saveOutbox(activeSessionId, log.outbox);
    return item;
  },
};
