import { on } from "svelte/events";
import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
import { SessionStreamController } from "@/features/chat/stream-controller";
import { markSessionOpen } from "@/shared/lib/session-open-timing";

const HIDDEN_RECONNECT_MS = 3000;

export function createChatSessionState(sessionId: string): { start: () => void; stop: () => void } {
  let controller: SessionStreamController | null = null;

  // iOS suspends a backgrounded home-screen app and can leave a dead socket
  // that still looks open, so coming back after a few seconds reconnects.
  let hiddenAt = 0;
  $effect(() =>
    on(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (Date.now() - hiddenAt > HIDDEN_RECONNECT_MS) controller?.reconnect();
    }),
  );

  function start(): void {
    if (controller) return;
    markSessionOpen(sessionId, "state-start");
    controller = new SessionStreamController({ sessionId, onGone: () => sessionListState.removeLocal(sessionId) });
    markSessionOpen(sessionId, "stream-start");
    controller.start();
  }

  function stop(): void {
    controller?.close();
    controller = null;
  }

  return { start, stop };
}

export { activeSessionState };
