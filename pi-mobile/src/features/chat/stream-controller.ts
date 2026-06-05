import type { ClientEvent, SessionMeta, WireEvent } from "@pico/protocol";
import type { ApiClient, StreamHandle } from "@/shared/lib/api-client";
import { activeSessionState, type ConnectionStatus } from "@/features/chat/model/active-session.state.svelte";
import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
import { chatQueueState } from "@/features/chat/model/chat-queue.state.svelte";
import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";

export interface SessionStreamControllerOptions {
  sessionId: string;
  client: ApiClient;
  onHello?: (session: SessionMeta) => void;
  onGone?: () => void;
  onEvent?: (event: WireEvent) => void;
  onConnectionStatus?: (status: ConnectionStatus) => void;
}

export class SessionStreamController {
  readonly sessionId: string;
  readonly client: ApiClient;

  #handle: StreamHandle | null = null;
  #closed = false;
  #replayBoundary = 0;
  #onHello?: (session: SessionMeta) => void;
  #onGone?: () => void;
  #onEvent?: (event: WireEvent) => void;
  #onConnectionStatus?: (status: ConnectionStatus) => void;

  constructor(opts: SessionStreamControllerOptions) {
    this.sessionId = opts.sessionId;
    this.client = opts.client;
    this.#onHello = opts.onHello;
    this.#onGone = opts.onGone;
    this.#onEvent = opts.onEvent;
    this.#onConnectionStatus = opts.onConnectionStatus;
  }

  start(): void {
    if (this.#closed || this.#handle) return;

    chatLogState.activate(this.sessionId);
    activeSessionState.activate(this.sessionId);
    this.#setConnectionStatus("connecting");

    this.#handle = this.client.connectSessionStream(
      this.sessionId,
      () => chatLogState.getCursor(this.sessionId),
      {
        onOpen: () => this.#setConnectionStatus("connected"),
        onClose: (_code, _reason, terminal) => {
          if (terminal) {
            this.#setConnectionStatus("gone");
            activeSessionState.setSend(null);
            this.#onGone?.();
          } else {
            this.#setConnectionStatus("reconnecting");
          }
        },
        onError: () => this.#setConnectionStatus("error"),
        onEvent: (event) => this.#handleWireEvent(event),
      },
    );

    activeSessionState.setSend((event) => this.send(event));
  }

  reconnect(): void {
    if (this.#closed) return;
    this.#handle?.reconnect();
  }

  send(event: ClientEvent): void {
    if (this.#closed) return;
    this.#handle?.send(event);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    activeSessionState.setSend(null);
    activeSessionState.deactivate(this.sessionId);
    this.#setConnectionStatus("offline");
    this.#handle?.close();
    this.#handle = null;
  }

  #handleWireEvent(event: WireEvent): void {
    if (event.t === "hello") {
      this.#replayBoundary = event.cursor;
      sessionListState.upsert(event.session);
      this.#onHello?.(event.session);
    }

    if (event.t === "cost" && event.seq > this.#replayBoundary) {
      sessionListState.patchLocal(this.sessionId, {
        tokens: { in: event.tokensIn, out: event.tokensOut },
        costUsd: event.costUsd,
      });
    }

    chatQueueState.applyWireEvent(this.sessionId, event);
    chatLogState.applyWireEvent(this.sessionId, event);
    activeSessionState.applyWireEvent(this.sessionId, event);
    this.#onEvent?.(event);
  }

  #setConnectionStatus(status: ConnectionStatus): void {
    activeSessionState.setConnectionStatus(status);
    this.#onConnectionStatus?.(status);
  }
}
