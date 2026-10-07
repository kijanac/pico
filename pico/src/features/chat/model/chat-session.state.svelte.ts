import { on } from "svelte/events";
import { hostRegistryState } from "@/features/hosts/host-registry.state.svelte";
import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
import { retryState } from "@/features/chat/model/retry-state.svelte";
import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
import { SessionStreamController } from "@/features/chat/stream-controller";
import { markSessionOpen } from "@/shared/lib/session-open-timing";

export interface ChatSessionState {
  readonly hostId: string;
  readonly sessionId: string;
  readonly connected: boolean;
  readonly controller: SessionStreamController | null;
  start: () => Promise<void>;
  reconnect: () => void;
  stop: () => void;
}

export function createChatSessionState(hostId: string, sessionId: string): ChatSessionState {
  let controller = $state<SessionStreamController | null>(null);
  let connected = $state(false);

  // iOS suspends a backgrounded home-screen app; coming back must reconnect.
  $effect(() =>
    on(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") controller?.reconnect();
    }),
  );

  async function start(): Promise<void> {
    if (controller) return;
    markSessionOpen(`${hostId}:${sessionId}`, "state-start");
    const host = hostRegistryState.getHost(hostId);
    if (!host) throw new Error(`Pico host not found: ${hostId}`);

    chatLogState.activate(hostId, sessionId);
    activeSessionState.activate(hostId, sessionId);

    controller = new SessionStreamController({
      hostId,
      sessionId,
      hostUrl: host.url,
      onConnectionStatus: (status) => {
        connected = status === "connected";
      },
      onGone: () => {
        sessionListState.removeLocal(hostId, sessionId);
      },
    });
    markSessionOpen(`${hostId}:${sessionId}`, "stream-start");
    controller.start();
  }

  function reconnect(): void {
    controller?.reconnect();
  }

  function stop(): void {
    controller?.close();
    controller = null;
    connected = false;
  }

  return {
    get hostId() {
      return hostId;
    },
    get sessionId() {
      return sessionId;
    },
    get connected() {
      return connected;
    },
    get controller() {
      return controller;
    },
    start,
    reconnect,
    stop,
  };
}

export { activeSessionState, chatLogState, retryState };
