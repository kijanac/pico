import type { ClientEvent, LogEntry, LogPage, WireEvent } from "@pico/protocol";
import { appendLogEntry, type Mutable, reconcileOrphanedToolCalls, reduceLog, removeLogEntry } from "@pico/protocol/log";
import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";

type SendEvent = Extract<ClientEvent, { t: "send" }>;

interface SessionLog {
  entries: Mutable<LogEntry>[];
  cursor: number;
  activityVersion: number;
  hasMoreBefore: boolean;
  indexById: Map<string, number>;
}

const logs = $state<Record<string, SessionLog>>({});
let activeSessionId = $state<string | null>(null);

const emptyEntries: LogEntry[] = [];

const activeLog = $derived(activeSessionId ? logs[activeSessionId] : undefined);

// Retry re-sends the same clientId, which the Pico host dedupes, so retrying
// can't double-send.
let localEchoCounter = 0;

const ECHO_ACK_TIMEOUT_MS = 10_000;

interface LocalEcho {
  sessionId: string;
  event: SendEvent;
  timer: ReturnType<typeof setTimeout> | null;
}

const localEchoes = new Map<string, LocalEcho>();
const failedEchoes = $state<Record<string, boolean>>({});

export function isLocalEcho(id: string): boolean {
  return id.startsWith("local-echo-");
}

function startEchoTimer(entryId: string, echo: LocalEcho): void {
  if (echo.timer) clearTimeout(echo.timer);
  echo.timer = setTimeout(() => {
    echo.timer = null;
    if (localEchoes.has(entryId)) failedEchoes[entryId] = true;
  }, ECHO_ACK_TIMEOUT_MS);
}

function clearEcho(entryId: string): void {
  const echo = localEchoes.get(entryId);
  if (echo?.timer) clearTimeout(echo.timer);
  localEchoes.delete(entryId);
  delete failedEchoes[entryId];
}

function clearEchoesForSession(sessionId: string): void {
  for (const [entryId, echo] of localEchoes) {
    if (echo.sessionId === sessionId) clearEcho(entryId);
  }
}

export const chatLogState = {
  get activeSessionId() {
    return activeSessionId;
  },

  get entries() {
    return activeLog?.entries ?? emptyEntries;
  },

  get activityVersion() {
    return activeLog?.activityVersion ?? 0;
  },

  get hasMoreBefore() {
    return activeLog?.hasMoreBefore ?? false;
  },

  activate(sessionId: string): void {
    activeSessionId = sessionId;
  },

  getConnectCursor(sessionId: string): number {
    return logs[sessionId]?.cursor ?? -1;
  },

  applyWireEvent(sessionId: string, event: WireEvent): void {
    applyWireEventForSession(sessionId, event);
  },

  prependEarlierEntries(sessionId: string, page: LogPage): void {
    const log = getLog(sessionId);
    const ids = new Set(log.entries.map((entry) => entry.id));
    const entries = page.entries.filter((entry) => !ids.has(entry.id));
    if (entries.length > 0) {
      log.entries = [...entries, ...log.entries] as Mutable<LogEntry>[];
      log.indexById = new Map(log.entries.map((entry, index) => [entry.id, index]));
    }
    log.hasMoreBefore = page.hasMoreBefore;
  },

  appendLocalEcho(sessionId: string, event: SendEvent): void {
    const log = getLog(sessionId);
    const entryId = `local-echo-${++localEchoCounter}`;
    appendLogEntry(log, {
      kind: "user",
      id: entryId,
      at: Date.now(),
      text: event.text,
    });
    const echo: LocalEcho = { sessionId, event, timer: null };
    localEchoes.set(entryId, echo);
    startEchoTimer(entryId, echo);
    bumpActivity(log);
  },

  isEchoFailed(entryId: string): boolean {
    return failedEchoes[entryId] === true;
  },

  retryLocalEcho(entryId: string): void {
    const echo = localEchoes.get(entryId);
    if (!echo || echo.sessionId !== activeSessionId) return;
    const send = activeSessionState.send;
    if (!send) return;
    delete failedEchoes[entryId];
    send(echo.event);
    startEchoTimer(entryId, echo);
  },
};

function getLog(sessionId: string): SessionLog {
  logs[sessionId] ??= {
    entries: [],
    cursor: 0,
    activityVersion: 0,
    hasMoreBefore: false,
    indexById: new Map(),
  };
  return logs[sessionId];
}

function bumpActivity(log: SessionLog): void {
  log.activityVersion += 1;
}

function reconcileQueuedMessages(log: SessionLog, event: Extract<WireEvent, { t: "queue" }>): void {
  const queuedIds = new Set(event.queued.map((message) => message.id));
  let changed = false;

  for (const entry of log.entries) {
    if (entry.kind !== "user" || !entry.queued || queuedIds.has(entry.id)) continue;
    entry.queued = false;
    delete entry.queueKind;
    changed = true;
  }

  if (changed) bumpActivity(log);
}

function applyWireEventForSession(sessionId: string, event: WireEvent): void {
  const log = getLog(sessionId);

  if (event.t === "log_reset") {
    log.cursor = event.seq;
    log.hasMoreBefore = event.hasMoreBefore ?? false;
    clearEchoesForSession(sessionId);
    reduceLog(log, event, Date.now());
    bumpActivity(log);
    return;
  }

  if (event.t !== "hello" && event.seq > 0 && event.seq <= log.cursor) return;
  if (event.seq > log.cursor) log.cursor = event.seq;

  // When not mid-turn, a still-"running" tool entry is an orphan from a turn that
  // died with a previous host process; its tool_result was never persisted, so
  // cursor replay alone can't heal it.
  if (event.t === "hello") {
    if (event.session.status === "idle" || event.session.status === "error") {
      if (reconcileOrphanedToolCalls(log)) bumpActivity(log);
    }
    return;
  }
  if (event.t === "status") {
    if (event.status === "idle" || event.status === "error") {
      if (reconcileOrphanedToolCalls(log)) bumpActivity(log);
    }
    return;
  }
  if (event.t === "cost" || event.t === "auto_retry_start" || event.t === "auto_retry_end") return;
  if (event.t === "user_message_removed") {
    clearEcho(event.id);
    if (removeLogEntry(log, event.id)) bumpActivity(log);
    return;
  }
  if (event.t === "queue") {
    reconcileQueuedMessages(log, event);
    return;
  }

  if (event.t === "user_message") {
    const entry = event.entry;
    // An ack with a clientId may only be absorbed by its own echo; text matching
    // is the fallback for acks from older hosts. Non-echo acks fall through to
    // the shared fold (plain append).
    const echoIndex = log.entries.findIndex((e) => {
      if (e.kind !== "user" || !isLocalEcho(e.id)) return false;
      if (entry.clientId) return localEchoes.get(e.id)?.event.clientId === entry.clientId;
      return e.text === entry.text;
    });
    if (echoIndex >= 0) {
      const echoId = log.entries[echoIndex].id;
      clearEcho(echoId);
      log.indexById.delete(echoId);
      log.entries[echoIndex] = entry;
      log.indexById.set(entry.id, echoIndex);
      bumpActivity(log);
      return;
    }
  }

  if (reduceLog(log, event, Date.now())) bumpActivity(log);
}
