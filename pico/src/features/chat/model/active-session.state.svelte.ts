import type { Effect } from "effect";
import type { ExtensionUiRequest, ServerMessage, SessionMeta } from "@pico/protocol";
import { answerExtensionUi, getSessionSettings, getSessionStats, listSessionCommands } from "@/features/chat/api";
import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
import { type PicoClient, runRpc } from "@/shared/lib/rpc-client";

export type ConnectionStatus = "offline" | "connecting" | "connected" | "reconnecting" | "gone";
export type ExtensionUiNotification = Extract<ExtensionUiRequest, { kind: "notify" }>;

let activeSessionId = $state<string | null>(null);
let activeStatus = $state<SessionMeta["status"]>("idle");
let connectionStatus = $state<ConnectionStatus>("offline");
let contextUsageInvalidationVersion = $state(0);
let contextUsageVersion = $state(0);
let extensionNotification = $state<ExtensionUiNotification | null>(null);

// notify() is fire-and-forget (returns void), so we mirror pi's TUI: surface the
// latest notification in a transient status line that auto-clears, instead of a
// growing stack of dismissable cards.
const NOTIFICATION_TTL_MS = 5000;
let notificationTimer: ReturnType<typeof setTimeout> | null = null;

function clearNotification(): void {
  if (notificationTimer !== null) {
    clearTimeout(notificationTimer);
    notificationTimer = null;
  }
  extensionNotification = null;
}

// Something the open session's composer, header and sheets all show (its
// controls, stats, commands): one copy, shown at once while a newer one loads,
// and kept if loading fails (the caller shows the error).
function sessionResource<A>(fetch: (sessionId: string) => Effect.Effect<A, unknown, PicoClient>) {
  let owner = $state<string | null>(null);
  let value = $state<A | null>(null);
  let requests = 0;
  return {
    // Only the open session's: another session's copy never shows.
    get value(): A | null {
      return owner === activeSessionId ? value : null;
    },
    set(sessionId: string, next: A): void {
      owner = sessionId;
      value = next;
    },
    // By id: a screen's children load before it marks its session active.
    // The newest request wins; an overtaken one resolves to null.
    async load(sessionId: string): Promise<A | null> {
      const request = ++requests;
      const next = await runRpc(fetch(sessionId));
      if (request !== requests) return null;
      owner = sessionId;
      value = next;
      return next;
    },
  };
}

const controls = sessionResource(getSessionSettings);
const stats = sessionResource(getSessionStats);
const commands = sessionResource(listSessionCommands);

function showNotification(request: ExtensionUiNotification): void {
  if (notificationTimer !== null) clearTimeout(notificationTimer);
  extensionNotification = request;
  notificationTimer = setTimeout(() => {
    notificationTimer = null;
    extensionNotification = null;
  }, NOTIFICATION_TTL_MS);
}

export const activeSessionState = {
  get id() {
    return activeSessionId;
  },

  controls,
  stats,
  commands,

  get status() {
    return activeStatus;
  },

  get connectionStatus() {
    return connectionStatus;
  },



  get contextUsageInvalidationVersion() {
    return contextUsageInvalidationVersion;
  },

  get contextUsageVersion() {
    return contextUsageVersion;
  },


  get extensionNotification() {
    return extensionNotification;
  },

  activate(sessionId: string): void {
    activeSessionId = sessionId;
    activeStatus = "idle";
    clearNotification();
  },

  deactivate(sessionId?: string): void {
    if (sessionId !== undefined && activeSessionId !== sessionId) return;
    activeSessionId = null;
    activeStatus = "idle";
    clearNotification();
    connectionStatus = "offline";
  },

  setConnectionStatus(status: ConnectionStatus): void {
    connectionStatus = status;
  },

  respondToExtensionUi(id: string, value: string | boolean | null): void {
    if (!activeSessionId) return;
    void runRpc(answerExtensionUi(activeSessionId, id, value)).catch(() => {});
    chatLogState.apply(activeSessionId, { t: "ui_done", id });
  },

  dismissExtensionNotification(): void {
    clearNotification();
  },

  // Status, notices and context-usage changes; the rest of the live state is
  // the mirror in chatLogState.
  apply(sessionId: string, message: ServerMessage): void {
    if (activeSessionId !== sessionId) return;

    if (message.t === "sync" || message.t === "meta") activeStatus = message.session.status;
    else if (message.t === "ui" && message.request.kind === "notify") showNotification(message.request);
    else if (message.t === "entries") {
      for (const entry of message.entries) {
        if (entry.type === "assistant" && entry.usage) contextUsageVersion += 1;
        if (entry.type === "compaction") contextUsageInvalidationVersion += 1;
      }
    }
  },
};
