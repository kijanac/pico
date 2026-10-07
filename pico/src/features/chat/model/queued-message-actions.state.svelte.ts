import type { ImageContent } from "@pico/protocol";
import { clearSessionQueue } from "@/features/chat/api";
import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
import { hostIssueSummary } from "@/shared/lib/host-issues";
import { runRpc } from "@/shared/lib/rpc-client";
import { cloneImageContent } from "@/shared/mobile/image-content";

interface RecallRequest {
  id: number;
  sessionId: string;
  text: string;
  images?: ImageContent[];
}

let recallCounter = 0;
let recallRequest = $state<RecallRequest | null>(null);
let restoring = $state(false);
let restoreError = $state<string | null>(null);

// Puts messages back in the composer, ahead of any draft.
function recall(sessionId: string, text: string, images?: readonly ImageContent[]): void {
  recallRequest = { id: ++recallCounter, sessionId, text, images: cloneImageContent(images) };
}

export const queuedMessageActionsState = {
  get recallRequest() {
    return recallRequest;
  },

  get restoring() {
    return restoring;
  },

  get restoreError() {
    return restoreError;
  },

  recall,

  // Like pi's dequeue: empties the queue and puts its messages in the composer.
  async restoreQueue(sessionId: string): Promise<boolean> {
    if (restoring) return false;
    restoring = true;
    restoreError = null;
    // pi's queue keeps only text; this phone's own sends still have their images.
    const images = chatLogState.live.queue.flatMap((item) => chatLogState.images(item.cid) ?? []);
    try {
      const { steering, followUp } = await runRpc(clearSessionQueue(sessionId));
      recall(sessionId, [...steering, ...followUp].join("\n\n"), images);
      return true;
    } catch (error) {
      restoreError = hostIssueSummary(error);
      return false;
    } finally {
      restoring = false;
    }
  },
};
