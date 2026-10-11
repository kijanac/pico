import type { ImageContent } from "@pico/protocol";
import { clearSessionQueue } from "@/features/chat/api";
import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
import { hostIssueSummary } from "@/shared/lib/host-issues";
import { runRpc } from "@/shared/lib/rpc-client";
import { cloneImageContent } from "@/shared/mobile/image-content";

interface RecallRequest {
  sessionId: string;
  text: string;
  images?: ImageContent[];
}

let recallRequest = $state<RecallRequest | null>(null);
let restoring = $state(false);
let restoreError = $state<string | null>(null);

function recall(sessionId: string, text: string, images?: readonly ImageContent[]): void {
  recallRequest = { sessionId, text, images: cloneImageContent(images) };
}

export const queuedMessageActionsState = {
  get restoring() {
    return restoring;
  },

  get restoreError() {
    return restoreError;
  },

  recall,

  takeRecall(sessionId: string): RecallRequest | null {
    const request = recallRequest;
    if (request?.sessionId !== sessionId) return null;
    recallRequest = null;
    return request;
  },

  async restoreQueue(sessionId: string): Promise<boolean> {
    if (restoring) return false;
    restoring = true;
    restoreError = null;
    const imagesOfOwnSends = chatLogState.live.queue.flatMap((item) => chatLogState.images(item.cid) ?? []);
    try {
      const { steering, followUp } = await runRpc(clearSessionQueue(sessionId));
      recall(sessionId, [...steering, ...followUp].join("\n\n"), imagesOfOwnSends);
      return true;
    } catch (error) {
      restoreError = hostIssueSummary(error);
      return false;
    } finally {
      restoring = false;
    }
  },
};
