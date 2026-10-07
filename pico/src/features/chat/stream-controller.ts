import { Cause, Duration, Effect, Exit, Fiber, Stream } from "effect";
import type { ServerMessage } from "@pico/protocol";
import { PicoSessionClient, sessionClientLayer } from "@/shared/lib/rpc-client";
import { activeSessionState, type ConnectionStatus } from "@/features/chat/model/active-session.state.svelte";
import { chatLogState } from "@/features/chat/model/chat-log.state.svelte";
import { sessionListState } from "@/features/sessions/model/session-list.state.svelte";
import { markSessionOpen } from "@/shared/lib/session-open-timing";

export interface SessionStreamControllerOptions {
  sessionId: string;
  onGone?: () => void;
}

const RECONNECT_MIN_MS = 500;
// Cap delay so a dead network doesn't wake the radio forever; foreground forces reconnect anyway.
const RECONNECT_MAX_MS = 30_000;

export class SessionStreamController {
  readonly sessionId: string;

  #fiber: Fiber.RuntimeFiber<void> | null = null;
  #closed = false;
  #everConnected = false;
  #onGone?: () => void;

  constructor(opts: SessionStreamControllerOptions) {
    this.sessionId = opts.sessionId;
    this.#onGone = opts.onGone;
  }

  start(): void {
    if (this.#closed || this.#fiber) return;
    chatLogState.activate(this.sessionId);
    activeSessionState.activate(this.sessionId);
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
    activeSessionState.deactivate(this.sessionId);
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
    const sessionId = this.sessionId;
    return Effect.gen(function* () {
      let delay = RECONNECT_MIN_MS;
      while (!self.#closed) {
        self.#setConnectionStatus(self.#everConnected ? "reconnecting" : "connecting");

        const exit = yield* Effect.gen(function* () {
          const client = yield* PicoSessionClient;
          self.#everConnected = true;
          markSessionOpen(sessionId, "ws-connected");
          self.#setConnectionStatus("connected");
          delay = RECONNECT_MIN_MS;
          yield* client.session
            .live({ id: sessionId, ...chatLogState.connectParams(sessionId) })
            .pipe(Stream.runForEach((message) => Effect.sync(() => self.#handle(message))));
        }).pipe(
          Effect.provide(sessionClientLayer),
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
    if (message.t === "sync") markSessionOpen(this.sessionId, "sync");
    if (message.t === "sync" || message.t === "meta") sessionListState.upsert(message.session);
    chatLogState.apply(this.sessionId, message);
    activeSessionState.apply(this.sessionId, message);
  }

  #setConnectionStatus(status: ConnectionStatus): void {
    activeSessionState.setConnectionStatus(status);
  }
}
