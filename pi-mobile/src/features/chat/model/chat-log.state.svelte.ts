import type { AssistantMessage, LogEntry, WireEvent } from "@pi-mobile/protocol";

interface SessionLog {
  entries: LogEntry[];
  cursor: number;
  activityVersion: number;
  indexById: Map<string, number>;
}

const logs = $state<Record<string, SessionLog>>({});
let activeSessionId = $state<string | null>(null);

const emptyEntries: LogEntry[] = [];

const activeLog = $derived(activeSessionId ? logs[activeSessionId] : undefined);

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
    getLog(sessionId);
    activeSessionId = sessionId;
  },

  getCursor(sessionId: string): number {
    return getLog(sessionId).cursor;
  },

  applyWireEvent(sessionId: string, event: WireEvent): void {
    applyWireEventForSession(sessionId, event);
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
  log.entries.push(entry);
  log.indexById.set(entry.id, log.entries.length - 1);
}

function findEntry(log: SessionLog, id: string): LogEntry | undefined {
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

function applyAssistantEnd(message: AssistantMessage, event: AssistantEndEvent): void {
  message.streaming = false;
  if (event.stopReason) message.stopReason = event.stopReason;
  if (event.errorMessage) message.errorMessage = event.errorMessage;
  if (event.usage) message.usage = event.usage;
}

function assistantFromEnd(event: AssistantEndEvent): AssistantMessage {
  const message: AssistantMessage = {
    kind: "assistant",
    id: event.id,
    at: Date.now(),
    text: "",
    streaming: false,
  };
  applyAssistantEnd(message, event);
  return message;
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

  if (event.t !== "hello" && event.seq > 0 && event.seq <= log.cursor) return;
  if (event.seq > log.cursor) log.cursor = event.seq;

  switch (event.t) {
    case "hello":
    case "status":
    case "cost":
    case "auto_retry_start":
    case "auto_retry_end":
      return;

    case "queue":
      reconcileQueuedMessages(log, event);
      return;

    case "user_message":
      appendEntry(log, event.entry);
      bumpActivity(log);
      return;

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

    case "tool_result": {
      const entry = findEntry(log, event.id);
      if (entry?.kind === "tool_call") {
        entry.status = event.status;
        entry.result = event.result;
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
