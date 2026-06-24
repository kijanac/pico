import { settingsState } from "@/features/settings/settings.state.svelte";
import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
import { retryState } from "@/features/chat/model/retry-state.svelte";
import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
import { SessionStreamController } from "@/features/chat/stream-controller";
import { appLifecycle } from "@/shared/mobile/lifecycle.svelte";

export interface ChatSessionState {
  readonly sessionId: string;
  readonly connected: boolean;
  readonly controller: SessionStreamController | null;
  start: () => Promise<void>;
  reconnect: () => void;
  stop: () => void;
}

export function createChatSessionState(sessionId: string): ChatSessionState {
  let controller = $state<SessionStreamController | null>(null);
  let connected = $state(false);
  let lastResumeTick = $state(appLifecycle.resumeTick);

  $effect(() => {
    const tick = appLifecycle.resumeTick;
    if (tick === lastResumeTick) return;
    lastResumeTick = tick;
    controller?.reconnect();
  });

  async function start(): Promise<void> {
    if (controller) return;
    if (!settingsState.loaded) await settingsState.load();

    chatLogState.activate(sessionId);
    activeSessionState.activate(sessionId);

    controller = new SessionStreamController({
      sessionId,
      hostUrl: settingsState.hostUrl,
      onConnectionStatus: (status) => {
        connected = status === "connected";
      },
      onGone: () => {
        sessionListState.removeLocal(sessionId);
      },
    });
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
