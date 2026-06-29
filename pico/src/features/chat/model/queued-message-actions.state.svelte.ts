import type { SendMode } from "@pico/protocol";

interface RecallRequest {
  id: number;
  hostId: string;
  sessionId: string;
  text: string;
  mode: SendMode;
}

let recallCounter = 0;
let recallRequest = $state<RecallRequest | null>(null);

export const queuedMessageActionsState = {
  get recallRequest() {
    return recallRequest;
  },

  recall(hostId: string, sessionId: string, text: string, mode: SendMode): void {
    recallRequest = { id: ++recallCounter, hostId, sessionId, text, mode };
  },
};
