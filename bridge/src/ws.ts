/**
 * WebSocket handler — Node/ws version.
 *
 * One Fiber per connection. The fiber races:
 *   1. subscribe(session) → forward every WireEvent to ws.send
 *   2. consume client events from a queue and route to the SessionRegistry
 *
 * Per-connection state lives in a WeakMap keyed by the WebSocket itself,
 * since ws doesn't have Bun's `ws.data` slot.
 */
import { Effect, Fiber, Queue, Stream, ManagedRuntime, pipe } from "effect";
import type { WebSocket } from "ws";
import {
  decodeClientEvent,
  encodeWireEvent,
  type ClientEvent,
} from "@pi-mobile/protocol";
import { SessionManager } from "./session.ts";

export interface WsBindings {
  sessionId: string;
  cursor: number;
}

interface WsState {
  bindings: WsBindings;
  queue: Queue.Queue<ClientEvent>;
  fiber: Fiber.RuntimeFiber<void, unknown>;
}

const STATE = new WeakMap<WebSocket, WsState>();

const sendOob = (ws: WebSocket, payload: object) => {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // socket may already be closed
  }
};

/**
 * Build a `(ws, bindings) => void` connection handler bound to the Effect
 * ManagedRuntime. Call this from your upgrade flow once per accepted socket.
 */
export const makeConnectionHandler =
  (runtime: ManagedRuntime.ManagedRuntime<SessionManager, never>) =>
  (ws: WebSocket, bindings: WsBindings): void => {
    runtime.runFork(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<ClientEvent>();
        // forkDaemon so the connection fiber survives past this setup gen.
        const fiber = yield* Effect.forkDaemon(
          connection(ws, queue, bindings),
        );
        STATE.set(ws, { bindings, queue, fiber });
        yield* Effect.logInfo(`ws open session=${bindings.sessionId}`);
      }).pipe(
        Effect.tapError((e) => Effect.logError("ws open failed", e)),
      ),
    );

    ws.on("message", (raw) => {
      const state = STATE.get(ws);
      if (!state) return;

      const text = raw.toString();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        sendOob(ws, { error: "invalid_json" });
        return;
      }

      const result = decodeClientEvent(parsed);
      if (!result.success) {
        sendOob(ws, {
          error: "invalid_event",
          issues: result.issues.map((i) => i.message),
        });
        return;
      }

      runtime.runFork(Queue.offer(state.queue, result.output));
    });

    ws.on("close", () => {
      const state = STATE.get(ws);
      if (!state) return;
      STATE.delete(ws);
      runtime.runFork(
        Effect.all([
          Effect.logInfo(`ws close session=${state.bindings.sessionId}`),
          Fiber.interrupt(state.fiber),
          Queue.shutdown(state.queue),
        ]),
      );
    });

    ws.on("error", (err) => {
      runtime.runFork(
        Effect.logError(`ws error session=${bindings.sessionId}`, err),
      );
    });
  };

const connection = (
  ws: WebSocket,
  queue: Queue.Queue<ClientEvent>,
  bindings: WsBindings,
) =>
  Effect.gen(function* () {
    const mgr = yield* SessionManager;

    const outgoing = pipe(
      mgr.subscribe(bindings.sessionId, bindings.cursor),
      Stream.runForEach((event) =>
        Effect.sync(() => ws.send(encodeWireEvent(event))),
      ),
    );

    const incoming = pipe(
      Queue.take(queue),
      Effect.flatMap((evt) => {
        switch (evt.t) {
          case "send":
            return mgr.send(bindings.sessionId, evt.text, evt.mode, evt.images);
          case "interrupt":
            return mgr.interrupt(bindings.sessionId);
          case "permission_reply":
            return mgr.approve(bindings.sessionId, evt.id, evt.choice);
          case "resume":
            return Effect.void;
        }
      }),
      Effect.forever,
    );

    // raceFirst (not race): race only completes when one leg succeeds
    // or *all* legs fail. Since `incoming` is Effect.forever it can
    // never settle on its own, so race would hang when outgoing fails.
    // raceFirst takes the first leg to settle and interrupts the other
    // — exactly the lifecycle we want.
    yield* Effect.raceFirst(outgoing, incoming);
  }).pipe(
    // SessionNotFound is the canonical "this id is irrecoverable"
    // failure: either the store has no row, or pi's on-disk file is
    // missing. WS close code 4004 tells the client to stop reconnecting.
    Effect.catchTag("SessionNotFound", (e) =>
      Effect.sync(() => ws.close(4004, `session not found: ${e.id}`)),
    ),
    // Anything else (pi internals, store errors): 1011 = server error,
    // transient, client may retry. Inner error goes to the log.
    Effect.catchAll((e) =>
      Effect.logError(`ws session failed: ${String(e)}`).pipe(
        Effect.andThen(() =>
          Effect.sync(() => ws.close(1011, "internal error")),
        ),
      ),
    ),
  );
