import { Cause, Duration, Effect, Exit, Fiber, Stream } from "effect";
import type { ServerMessage } from "@pico/protocol";
import { PicoSessionClient, sessionClientLayer } from "@/shared/lib/rpc-client";
import { activeSessionState, type ConnectionStatus } from "@/features/chat/model/active-session.state.svelte";
import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
import { markSessionOpen } from "@/shared/lib/session-open-timing";

export interface SessionStreamControllerOptions {
  hostId: string;
  sessionId: string;
  hostUrl: string;
  onGone?: () => void;
}

const RECONNECT_MIN_MS = 500;
// Cap delay so a dead network doesn't wake the radio forever; foreground forces reconnect anyway.
const RECONNECT_MAX_MS = 30_000;

export class SessionStreamController {
  readonly hostId: string;
  readonly sessionId: string;
  readonly #hostUrl: string;

  #fiber: Fiber.RuntimeFiber<void> | null = null;
  #closed = false;
  #everConnected = false;
  #onGone?: () => void;

  constructor(opts: SessionStreamControllerOptions) {
    this.hostId = opts.hostId;
    this.sessionId = opts.sessionId;
    this.#hostUrl = opts.hostUrl;
    this.#onGone = opts.onGone;
  }

  start(): void {
    if (this.#closed || this.#fiber) return;
    chatLogState.activate(this.hostId, this.sessionId);
    activeSessionState.activate(this.hostId, this.sessionId);
    this.#fiber = Effect.runFork(this.#loop());
  }

  reconnect(): void {
    if (this.#closed || !this.#fiber) return;
    // Drop the current attempt and reconnect immediately (foreground resume).
    const previous = this.#fiber;
    this.#fiber = Effect.runFork(this.#loop());
    Effect.runFork(Fiber.interrupt(previous));
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    activeSessionState.deactivate(this.hostId, this.sessionId);
    this.#setConnectionStatus("offline");
    if (this.#fiber) {
      Effect.runFork(Fiber.interrupt(this.#fiber));
      this.#fiber = null;
    }
  }

  // One fiber owns the connection's whole lifetime: each iteration builds a fresh
  // socket, streams changes until it ends or drops, then backs off and catches
  // up from the bookmark. A typed SessionNotFound is terminal (the session is
  // gone); transport failures reconnect.
  #loop(): Effect.Effect<void> {
    const self = this;
    const hostId = this.hostId;
    const sessionId = this.sessionId;
    const timingId = `${hostId}:${sessionId}`;
    const layer = sessionClientLayer(this.#hostUrl);
    return Effect.gen(function* () {
      let delay = RECONNECT_MIN_MS;
      while (!self.#closed) {
        self.#setConnectionStatus(self.#everConnected ? "reconnecting" : "connecting");

        const exit = yield* Effect.gen(function* () {
          const client = yield* PicoSessionClient;
          self.#everConnected = true;
          markSessionOpen(timingId, "ws-connected");
          self.#setConnectionStatus("connected");
          delay = RECONNECT_MIN_MS;
          yield* client.session
            .live({ id: sessionId, ...chatLogState.connectParams(hostId, sessionId) })
            .pipe(Stream.runForEach((message) => Effect.sync(() => self.#handle(message))));
        }).pipe(
          Effect.provide(layer),
          Effect.catchTag("SessionNotFound", () =>
            Effect.sync(() => {
              self.#closed = true;
              self.#setConnectionStatus("gone");
              self.#onGone?.();
            }),
          ),
          Effect.exit,
        );

        if (self.#closed) break;
        if (Exit.isFailure(exit) && !Cause.isInterruptedOnly(exit.cause)) {
          self.#setConnectionStatus("reconnecting");
        }
        yield* Effect.sleep(Duration.millis(delay));
        delay = Math.min(delay * 1.5, RECONNECT_MAX_MS);
      }
    });
  }

  #handle(message: ServerMessage): void {
    if (message.t === "sync") markSessionOpen(`${this.hostId}:${this.sessionId}`, "sync");
    if (message.t === "sync" || message.t === "meta") sessionListState.upsert(this.hostId, message.session);
    chatLogState.apply(this.hostId, this.sessionId, message);
    activeSessionState.apply(this.hostId, this.sessionId, message);
  }

  #setConnectionStatus(status: ConnectionStatus): void {
    activeSessionState.setConnectionStatus(status);
  }
}
