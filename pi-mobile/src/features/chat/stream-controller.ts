import { Cause, Duration, Effect, Exit, Fiber, Stream } from "effect";
import type { ClientEvent, SessionMeta, WireEvent } from "@pico/protocol";
import { PicoSessionClient, sessionClientLayer, type PicoSessionClientService } from "@/shared/lib/rpc-client";
import { activeSessionState, type ConnectionStatus } from "@/features/chat/model/active-session.state.svelte";
import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
import { chatQueueState } from "@/features/chat/model/chat-queue.state.svelte";
import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";

export interface SessionStreamControllerOptions {
  sessionId: string;
  hostUrl: string;
  onHello?: (session: SessionMeta) => void;
  onGone?: () => void;
  onEvent?: (event: WireEvent) => void;
  onConnectionStatus?: (status: ConnectionStatus) => void;
}

const RECONNECT_MIN_MS = 500;
// Cap delay so a dead network doesn't wake the radio forever; foreground forces reconnect anyway.
const RECONNECT_MAX_MS = 30_000;

export class SessionStreamController {
  readonly sessionId: string;
  readonly #hostUrl: string;

  #fiber: Fiber.RuntimeFiber<void> | null = null;
  #client: PicoSessionClientService | null = null;
  #closed = false;
  #everConnected = false;
  #replayBoundary = 0;
  #onHello?: (session: SessionMeta) => void;
  #onGone?: () => void;
  #onEvent?: (event: WireEvent) => void;
  #onConnectionStatus?: (status: ConnectionStatus) => void;

  constructor(opts: SessionStreamControllerOptions) {
    this.sessionId = opts.sessionId;
    this.#hostUrl = opts.hostUrl;
    this.#onHello = opts.onHello;
    this.#onGone = opts.onGone;
    this.#onEvent = opts.onEvent;
    this.#onConnectionStatus = opts.onConnectionStatus;
  }

  start(): void {
    if (this.#closed || this.#fiber) return;
    chatLogState.activate(this.sessionId);
    activeSessionState.activate(this.sessionId);
    this.#fiber = Effect.runFork(this.#loop());
    activeSessionState.setSend((event) => this.send(event));
  }

  reconnect(): void {
    if (this.#closed || !this.#fiber) return;
    // Drop the current attempt and reconnect immediately (foreground resume).
    const previous = this.#fiber;
    this.#fiber = Effect.runFork(this.#loop());
    Effect.runFork(Fiber.interrupt(previous));
  }

  send(event: ClientEvent): void {
    const client = this.#client;
    if (this.#closed || !client) return;
    Effect.runFork(this.#dispatch(client, event).pipe(Effect.catchAllCause(() => Effect.void)));
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    activeSessionState.setSend(null);
    activeSessionState.deactivate(this.sessionId);
    this.#setConnectionStatus("offline");
    this.#client = null;
    if (this.#fiber) {
      Effect.runFork(Fiber.interrupt(this.#fiber));
      this.#fiber = null;
    }
  }

  #dispatch(client: PicoSessionClientService, event: ClientEvent): Effect.Effect<void, unknown> {
    const id = this.sessionId;
    switch (event.t) {
      case "send":
        return client.session.send({ id, text: event.text, mode: event.mode, images: event.images, clientId: event.clientId });
      case "interrupt":
        return client.session.interrupt({ id });
      case "permission_reply":
        return client.session.permissionReply({ id, messageId: event.id, choice: event.choice });
      case "extension_ui_response":
        return client.session.extensionUiResponse({ id, requestId: event.id, value: event.value });
    }
  }

  // One fiber owns the connection's whole lifetime: each iteration builds a fresh
  // socket, streams events until it ends or drops, then backs off and resumes
  // from the latest cursor. A typed SessionNotFound is terminal (the session is
  // gone); transport failures reconnect.
  #loop(): Effect.Effect<void> {
    const self = this;
    const sessionId = this.sessionId;
    const layer = sessionClientLayer(this.#hostUrl);
    return Effect.gen(function* () {
      let delay = RECONNECT_MIN_MS;
      while (!self.#closed) {
        self.#setConnectionStatus(self.#everConnected ? "reconnecting" : "connecting");

        const exit = yield* Effect.gen(function* () {
          const client = yield* PicoSessionClient;
          self.#client = client;
          self.#everConnected = true;
          self.#setConnectionStatus("connected");
          delay = RECONNECT_MIN_MS;
          yield* client.session
            .events({ id: sessionId, cursor: chatLogState.getConnectCursor(sessionId) })
            .pipe(Stream.runForEach((event) => Effect.sync(() => self.#handleWireEvent(event))));
        }).pipe(
          Effect.provide(layer),
          Effect.catchTag("SessionNotFound", () =>
            Effect.sync(() => {
              self.#closed = true;
              self.#setConnectionStatus("gone");
              activeSessionState.setSend(null);
              self.#onGone?.();
            }),
          ),
          Effect.exit,
        );

        self.#client = null;
        if (self.#closed) break;
        if (Exit.isFailure(exit) && !Cause.isInterruptedOnly(exit.cause)) {
          self.#setConnectionStatus("reconnecting");
        }
        yield* Effect.sleep(Duration.millis(delay));
        delay = Math.min(delay * 1.5, RECONNECT_MAX_MS);
      }
    });
  }

  #handleWireEvent(event: WireEvent): void {
    if (event.t === "hello") {
      this.#replayBoundary = event.cursor;
      sessionListState.upsert(event.session);
      activeSessionState.setStatus(event.session.status);
      this.#onHello?.(event.session);
    }

    const isReplay = event.seq > 0 && event.seq <= this.#replayBoundary;

    if (event.t === "cost" && !isReplay) {
      sessionListState.patchLocal(this.sessionId, {
        tokens: { in: event.tokensIn, out: event.tokensOut },
        costUsd: event.costUsd,
      });
    }

    chatQueueState.applyWireEvent(this.sessionId, event);
    chatLogState.applyWireEvent(this.sessionId, event);
    if (!isReplay) activeSessionState.applyWireEvent(this.sessionId, event);
    this.#onEvent?.(event);
  }

  #setConnectionStatus(status: ConnectionStatus): void {
    activeSessionState.setConnectionStatus(status);
    this.#onConnectionStatus?.(status);
  }
}
