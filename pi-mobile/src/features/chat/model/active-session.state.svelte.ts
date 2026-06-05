import type { ClientEvent, SessionMeta, WireEvent } from "@pico/protocol";
import { retryState } from "@/features/chat/model/retry-state.svelte";

export type ConnectionStatus = "offline" | "connecting" | "connected" | "reconnecting" | "error" | "gone";

let activeSessionId = $state<string | null>(null);
let activeStatus = $state<SessionMeta["status"]>("idle");
let connectionStatus = $state<ConnectionStatus>("offline");
let compacting = $state(false);
let activeSend = $state<((event: ClientEvent) => void) | null>(null);

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

  get send() {
    return activeSend;
  },

  activate(sessionId: string): void {
    activeSessionId = sessionId;
    activeStatus = "idle";
    compacting = false;
    retryState.reset();
  },

  deactivate(sessionId?: string): void {
    if (sessionId !== undefined && activeSessionId !== sessionId) return;
    activeSessionId = null;
    activeStatus = "idle";
    compacting = false;
    connectionStatus = "offline";
    activeSend = null;
    retryState.reset();
  },

  setConnectionStatus(status: ConnectionStatus): void {
    connectionStatus = status;
  },

  setSend(send: ((event: ClientEvent) => void) | null): void {
    activeSend = send;
  },

  applyWireEvent(sessionId: string, event: WireEvent): void {
    if (activeSessionId !== sessionId) return;

    if (event.t === "status") {
      activeStatus = event.status;
      return;
    }

    if (event.t === "compaction") {
      compacting = event.entry.status === "running";
      return;
    }

    retryState.applyWireEvent(event);
  },
};
