import type { QueuedMessage, QueueState, WireEvent } from "@pi-mobile/protocol";

type QueueBySession = Record<string, QueueState | undefined>;

let queues = $state<QueueBySession>({});

const emptyQueue: QueueState = { queued: [] };

function queueSnapshot(queue: QueueState = emptyQueue): QueueState {
  return {
    queued: queue.queued.map(({ id, text, queueKind }) => ({ id, text, queueKind })),
  };
}

function queueItems(sessionId: string): QueuedMessage[] {
  return queues[sessionId]?.queued ?? emptyQueue.queued;
}

export const chatQueueState = {
  get(sessionId: string): QueueState {
    return queues[sessionId] ?? queueSnapshot();
  },

  count(sessionId: string): number {
    return queueItems(sessionId).length;
  },

  steering(sessionId: string): QueuedMessage[] {
    return queueItems(sessionId).filter((message) => message.queueKind === "steer");
  },

  followUp(sessionId: string): QueuedMessage[] {
    return queueItems(sessionId).filter((message) => message.queueKind === "follow_up");
  },

  set(sessionId: string, queue: QueueState): void {
    queues = { ...queues, [sessionId]: queueSnapshot(queue) };
  },

  clear(sessionId: string): void {
    queues = { ...queues, [sessionId]: queueSnapshot() };
  },

  applyWireEvent(sessionId: string, event: WireEvent): void {
    if (event.t !== "queue") return;
    queues = { ...queues, [sessionId]: queueSnapshot({ queued: event.queued }) };
  },
};
