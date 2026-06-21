import type { AssistantMessage, ClientEvent, CompactionEntry, LogEntry, WireEvent } from "@pico/protocol";
import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";

// effect/Schema decodes to readonly types; this reactive log mutates the
// freshly-decoded entries it owns in place, so it holds them as mutable drafts.
type Mutable<T> = T extends ReadonlyArray<infer U>
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;

type SendEvent = Extract<ClientEvent, { t: "send" }>;

interface SessionLog {
  entries: Mutable<LogEntry>[];
  cursor: number;
  activityVersion: number;
  indexById: Map<string, number>;
}

const logs = $state<Record<string, SessionLog>>({});
let activeSessionId = $state<string | null>(null);

const emptyEntries: LogEntry[] = [];

const activeLog = $derived(activeSessionId ? logs[activeSessionId] : undefined);

// Optimistic local echo: sends append a placeholder user entry immediately so
// the message appears on tap instead of after the server round trip. The
// server's user_message ack carries the send's clientId and replaces the
// placeholder exactly (text match is the fallback for acks without one).
// Unacked echoes flip to "failed" after a timeout; retry re-sends the same
// clientId, which the Pico host dedupes, so retrying can't double-send.
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

  get cursor() {
    return activeLog?.cursor ?? 0;
  },

  get activityVersion() {
    return activeLog?.activityVersion ?? 0;
  },

  activate(sessionId: string): void {
    activeSessionId = sessionId;
  },

  getCursor(sessionId: string): number {
    return getLog(sessionId).cursor;
  },

  getConnectCursor(sessionId: string): number {
    return logs[sessionId]?.cursor ?? -1;
  },

  applyWireEvent(sessionId: string, event: WireEvent): void {
    applyWireEventForSession(sessionId, event);
  },

  appendLocalEcho(sessionId: string, event: SendEvent): void {
    const log = getLog(sessionId);
    const entryId = `local-echo-${++localEchoCounter}`;
    appendEntry(log, {
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

  resolvePermission(sessionId: string, id: string, choice: "allow" | "deny" | "allow_session"): void {
    const log = getLog(sessionId);
    const entry = findEntry(log, id);
    if (entry?.kind !== "permission") return;

    entry.resolved = choice;
    bumpActivity(log);
  },
};

function getLog(sessionId: string): SessionLog {
  logs[sessionId] ??= {
    entries: [],
    cursor: 0,
    activityVersion: 0,
    indexById: new Map(),
  };
  return logs[sessionId];
}

function bumpActivity(log: SessionLog): void {
  log.activityVersion += 1;
}

function appendEntry(log: SessionLog, entry: LogEntry): void {
  log.entries.push(entry as Mutable<LogEntry>);
  log.indexById.set(entry.id, log.entries.length - 1);
}

function findEntry(log: SessionLog, id: string): Mutable<LogEntry> | undefined {
  const index = log.indexById.get(id);
  if (index !== undefined && log.entries[index]?.id === id) return log.entries[index];

  const fallback = log.entries.findIndex((entry) => entry.id === id);
  if (fallback >= 0) {
    log.indexById.set(id, fallback);
    return log.entries[fallback];
  }

  return undefined;
}

type AssistantEndEvent = Extract<WireEvent, { t: "assistant_end" }>;

function applyAssistantEnd(message: Mutable<AssistantMessage>, event: AssistantEndEvent): void {
  message.streaming = false;
  if (event.stopReason) message.stopReason = event.stopReason;
  if (event.errorMessage) message.errorMessage = event.errorMessage;
  if (event.errorCode) message.errorCode = event.errorCode;
  if (event.usage) message.usage = event.usage;
}

function assistantFromEnd(event: AssistantEndEvent): Mutable<AssistantMessage> {
  const message: Mutable<AssistantMessage> = {
    kind: "assistant",
    id: event.id,
    at: Date.now(),
    text: "",
    streaming: false,
  };
  applyAssistantEnd(message, event);
  return message;
}

function applyCompaction(log: SessionLog, entry: CompactionEntry): void {
  const existing = findEntry(log, entry.id);
  if (existing?.kind === "compaction") {
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
  } else {
    appendEntry(log, entry);
  }
  bumpActivity(log);
}

function reconcileOrphanedToolCalls(log: SessionLog): void {
  let changed = false;
  for (const entry of log.entries) {
    if (entry.kind !== "tool_call" || entry.status !== "running") continue;
    entry.status = "error";
    if (!entry.result) entry.result = "Interrupted — the bridge restarted while this command was running.";
    changed = true;
  }
  if (changed) bumpActivity(log);
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
    log.entries = [...event.entries] as Mutable<LogEntry>[];
    log.indexById = new Map(log.entries.map((entry, i) => [entry.id, i]));
    clearEchoesForSession(sessionId);
    bumpActivity(log);
    return;
  }

  if (event.t !== "hello" && event.seq > 0 && event.seq <= log.cursor) return;
  if (event.seq > log.cursor) log.cursor = event.seq;

  switch (event.t) {
    case "hello":
      // hello is the authoritative snapshot on every (re)connect. If the
      // session is not mid-turn, any tool entry still "running" is an orphan
      // from a turn that died with a previous bridge process — its tool_result
      // was never persisted, so the cursor replay alone can't heal it.
      if (event.session.status === "idle" || event.session.status === "error") {
        reconcileOrphanedToolCalls(log);
      }
      return;

    case "status":
      if (event.status === "idle" || event.status === "error") {
        reconcileOrphanedToolCalls(log);
      }
      return;

    case "cost":
    case "auto_retry_start":
    case "auto_retry_end":
      return;

    case "queue":
      reconcileQueuedMessages(log, event);
      return;

    case "compaction":
      applyCompaction(log, event.entry);
      return;

    case "user_message": {
      const entry = event.entry;
      // An ack with a clientId belongs to one specific send; only its own
      // echo may absorb it. Text matching covers acks from older hosts.
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
      } else {
        appendEntry(log, entry);
      }
      bumpActivity(log);
      return;
    }

    case "assistant_delta": {
      const existing = findEntry(log, event.id);
      if (existing?.kind === "assistant") {
        existing.text += event.text;
        existing.streaming = true;
      } else {
        appendEntry(log, {
          kind: "assistant",
          id: event.id,
          at: Date.now(),
          text: event.text,
          streaming: true,
        });
      }
      bumpActivity(log);
      return;
    }

    case "assistant_end": {
      const entry = findEntry(log, event.id);
      if (!entry) {
        appendEntry(log, assistantFromEnd(event));
      } else if (entry.kind === "assistant") {
        applyAssistantEnd(entry, event);
      }
      bumpActivity(log);
      return;
    }

    case "tool_call":
      appendEntry(log, event.entry);
      bumpActivity(log);
      return;

    case "tool_update": {
      const entry = findEntry(log, event.id);
      if (entry?.kind === "tool_call") {
        entry.result = event.result;
        if (event.resultContent) entry.resultContent = [...event.resultContent];
        if (event.details !== undefined) entry.details = event.details;
        bumpActivity(log);
      }
      return;
    }

    case "tool_result": {
      const entry = findEntry(log, event.id);
      if (entry?.kind === "tool_call") {
        entry.status = event.status;
        entry.result = event.result;
        if (event.resultContent) entry.resultContent = [...event.resultContent];
        else delete entry.resultContent;
        if (event.details !== undefined) entry.details = event.details;
        else delete entry.details;
        entry.durationMs = event.durationMs;
        bumpActivity(log);
      }
      return;
    }

    case "permission":
      appendEntry(log, event.entry);
      bumpActivity(log);
      return;
  }
}
