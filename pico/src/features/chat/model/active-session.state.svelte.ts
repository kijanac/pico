import type { Effect } from "effect";
import type { ExtensionUiRequest, ServerMessage, SessionMeta } from "@pico/protocol";
import { answerExtensionUi, getSessionSettings, getSessionStats, listSessionCommands } from "@/features/chat/api";
import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
import { type PicoClient, runRpc } from "@/shared/lib/rpc-client";

export type ConnectionStatus = "offline" | "connecting" | "connected" | "reconnecting" | "gone";
export type ExtensionUiNotification = Extract<ExtensionUiRequest, { kind: "notify" }>;

let activeSessionId = $state<string | null>(null);
let activeSession = $state<SessionMeta | null>(null);
let connectionStatus = $state<ConnectionStatus>("offline");
let contextUsageInvalidationVersion = $state(0);
let contextUsageVersion = $state(0);
let extensionNotification = $state<ExtensionUiNotification | null>(null);

const NOTIFICATION_SHOWN_MS = 5000;
let notificationTimer: ReturnType<typeof setTimeout> | null = null;

function clearNotification(): void {
  if (notificationTimer !== null) {
    clearTimeout(notificationTimer);
    notificationTimer = null;
  }
  extensionNotification = null;
}

function openSessionResource<A>(fetch: (sessionId: string) => Effect.Effect<A, unknown, PicoClient>) {
  let owner = $state<string | null>(null);
  let value = $state<A | null>(null);
  let requests = 0;
  return {
    get value(): A | null {
      return owner === activeSessionId ? value : null;
    },
    set(sessionId: string, next: A): void {
      owner = sessionId;
      value = next;
    },
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

const controls = openSessionResource(getSessionSettings);
const stats = openSessionResource(getSessionStats);
const commands = openSessionResource(listSessionCommands);

function showNotification(request: ExtensionUiNotification): void {
  if (notificationTimer !== null) clearTimeout(notificationTimer);
  extensionNotification = request;
  notificationTimer = setTimeout(() => {
    notificationTimer = null;
    extensionNotification = null;
  }, NOTIFICATION_SHOWN_MS);
}

export const activeSessionState = {
  get id() {
    return activeSessionId;
  },

  controls,
  stats,
  commands,

  get session(): SessionMeta | null {
    return activeSession;
  },

  get status(): SessionMeta["status"] {
    return activeSession?.status ?? "idle";
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
    activeSession = null;
    clearNotification();
  },

  deactivate(sessionId?: string): void {
    if (sessionId !== undefined && activeSessionId !== sessionId) return;
    activeSessionId = null;
    activeSession = null;
    clearNotification();
    connectionStatus = "offline";
  },

  setConnectionStatus(status: ConnectionStatus): void {
    connectionStatus = status;
  },

  async respondToExtensionUi(id: string, value: string | boolean | null): Promise<void> {
    const sessionId = activeSessionId;
    if (!sessionId) return;
    await runRpc(answerExtensionUi(sessionId, id, value));
    chatLogState.apply(sessionId, { t: "ui_done", id });
  },

  dismissExtensionNotification(): void {
    clearNotification();
  },

  apply(sessionId: string, message: ServerMessage): void {
    if (activeSessionId !== sessionId) return;

    if (message.t === "sync" || message.t === "meta") activeSession = message.session;
    else if (message.t === "ui" && message.request.kind === "notify") showNotification(message.request);
    else if (message.t === "entries") {
      for (const entry of message.entries) {
        if (entry.type === "assistant" && entry.usage) contextUsageVersion += 1;
        if (entry.type === "compaction") contextUsageInvalidationVersion += 1;
      }
    }
  },
};
