import type { QueuedMessage, QueueState, WireEvent } from "@pico/protocol";

type QueueBySession = Record<string, QueueState | undefined>;

let queues = $state<QueueBySession>({});

const emptyQueue: QueueState = { queued: [] };

function queueSnapshot(queue: QueueState = emptyQueue): QueueState {
  return {
    queued: queue.queued.map(({ id, text, queueKind }) => ({ id, text, queueKind })),
  };
}

function queueKey(hostId: string, sessionId: string): string {
  return `${hostId}:${sessionId}`;
}

function queueItems(hostId: string, sessionId: string): readonly QueuedMessage[] {
  return queues[queueKey(hostId, sessionId)]?.queued ?? emptyQueue.queued;
}

export const chatQueueState = {
  get(hostId: string, sessionId: string): QueueState {
    return queues[queueKey(hostId, sessionId)] ?? queueSnapshot();
  },

  count(hostId: string, sessionId: string): number {
    return queueItems(hostId, sessionId).length;
  },

  set(hostId: string, sessionId: string, queue: QueueState): void {
    queues = { ...queues, [queueKey(hostId, sessionId)]: queueSnapshot(queue) };
  },

  clear(hostId: string, sessionId: string): void {
    queues = { ...queues, [queueKey(hostId, sessionId)]: queueSnapshot() };
  },

  applyWireEvent(hostId: string, sessionId: string, event: WireEvent): void {
    if (event.t !== "queue") return;
    queues = { ...queues, [queueKey(hostId, sessionId)]: queueSnapshot({ queued: event.queued }) };
  },
};
