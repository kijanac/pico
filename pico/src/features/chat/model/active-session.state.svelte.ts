import type { ExtensionUiRequest, ServerMessage, SessionMeta } from "@pico/protocol";
import { answerExtensionUi } from "@/features/chat/api";
import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
import { runOnHost } from "@/shared/lib/rpc-client";

export type ConnectionStatus = "offline" | "connecting" | "connected" | "reconnecting" | "gone";
export type ExtensionUiNotification = Extract<ExtensionUiRequest, { kind: "notify" }>;

let activeHostId = $state<string | null>(null);
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

function showNotification(request: ExtensionUiNotification): void {
  if (notificationTimer !== null) clearTimeout(notificationTimer);
  extensionNotification = request;
  notificationTimer = setTimeout(() => {
    notificationTimer = null;
    extensionNotification = null;
  }, NOTIFICATION_TTL_MS);
}

export const activeSessionState = {
  get hostId() {
    return activeHostId;
  },

  get id() {
    return activeSessionId;
  },

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

  activate(hostId: string, sessionId: string): void {
    activeHostId = hostId;
    activeSessionId = sessionId;
    activeStatus = "idle";
    clearNotification();
  },

  deactivate(hostId?: string, sessionId?: string): void {
    if (hostId !== undefined && activeHostId !== hostId) return;
    if (sessionId !== undefined && activeSessionId !== sessionId) return;
    activeHostId = null;
    activeSessionId = null;
    activeStatus = "idle";
    clearNotification();
    connectionStatus = "offline";
  },

  setConnectionStatus(status: ConnectionStatus): void {
    connectionStatus = status;
  },

  respondToExtensionUi(id: string, value: string | boolean | null): void {
    if (!activeHostId || !activeSessionId) return;
    void runOnHost(activeHostId, answerExtensionUi(activeSessionId, id, value)).catch(() => {});
    chatLogState.apply(activeHostId, activeSessionId, { t: "ui_done", id });
  },

  dismissExtensionNotification(): void {
    clearNotification();
  },

  // Status, notices and context-usage changes; the rest of the live state is
  // the mirror in chatLogState.
  apply(hostId: string, sessionId: string, message: ServerMessage): void {
    if (activeHostId !== hostId || activeSessionId !== sessionId) return;

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
