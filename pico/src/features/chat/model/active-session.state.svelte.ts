import type { ClientEvent, ExtensionUiRequest, SessionMeta, WireEvent } from "@pico/protocol";
import { retryState } from "@/features/chat/model/retry-state.svelte";

export type ConnectionStatus = "offline" | "connecting" | "connected" | "reconnecting" | "gone";
export type InteractiveExtensionUiRequest = Extract<ExtensionUiRequest, { kind: "confirm" | "select" | "input" }>;
export type ExtensionUiNotification = Extract<ExtensionUiRequest, { kind: "notify" }>;

let activeSessionId = $state<string | null>(null);
let activeStatus = $state<SessionMeta["status"]>("idle");
let connectionStatus = $state<ConnectionStatus>("offline");
let compacting = $state(false);
let extensionUiRequests = $state<InteractiveExtensionUiRequest[]>([]);
let extensionNotification = $state<ExtensionUiNotification | null>(null);
let activeSend = $state<((event: ClientEvent) => void) | null>(null);

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
  get id() {
    return activeSessionId;
  },

  get status() {
    return activeStatus;
  },

  get connectionStatus() {
    return connectionStatus;
  },

  get compacting() {
    return compacting;
  },

  get extensionUiRequests() {
    return extensionUiRequests;
  },

  get extensionNotification() {
    return extensionNotification;
  },

  get send() {
    return activeSend;
  },

  activate(sessionId: string): void {
    activeSessionId = sessionId;
    activeStatus = "idle";
    compacting = false;
    extensionUiRequests = [];
    clearNotification();
    retryState.reset();
  },

  deactivate(sessionId?: string): void {
    if (sessionId !== undefined && activeSessionId !== sessionId) return;
    activeSessionId = null;
    activeStatus = "idle";
    compacting = false;
    extensionUiRequests = [];
    clearNotification();
    connectionStatus = "offline";
    activeSend = null;
    retryState.reset();
  },

  setConnectionStatus(status: ConnectionStatus): void {
    connectionStatus = status;
  },

  setStatus(status: SessionMeta["status"]): void {
    activeStatus = status;
  },

  setSend(send: ((event: ClientEvent) => void) | null): void {
    activeSend = send;
  },

  respondToExtensionUi(id: string, value: string | boolean | null): void {
    activeSend?.({ t: "extension_ui_response", id, value });
    extensionUiRequests = extensionUiRequests.filter((request) => request.id !== id);
  },

  dismissExtensionNotification(): void {
    clearNotification();
  },

  applyWireEvent(sessionId: string, event: WireEvent): void {
    if (activeSessionId !== sessionId) return;

    // hello is an authoritative snapshot on (re)connect; adopt its status so a
    // turn killed by a bridge restart (whose turn-ending status event died with
    // the old process) doesn't leave the spinner stuck.
    if (event.t === "hello") {
      activeStatus = event.session.status;
      return;
    }

    if (event.t === "status") {
      activeStatus = event.status;
      return;
    }

    if (event.t === "compaction") {
      compacting = event.entry.status === "running";
      return;
    }

    if (event.t === "extension_ui_request") {
      const request = event.request;
      if (request.kind === "notify") {
        showNotification(request);
      } else if (request.kind === "confirm" || request.kind === "select" || request.kind === "input") {
        extensionUiRequests = [...extensionUiRequests.filter((existing) => existing.id !== request.id), request];
      }
      return;
    }

    retryState.applyWireEvent(event);
  },
};
