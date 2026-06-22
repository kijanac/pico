import { Cause, Effect, Either, Fiber, Queue, Runtime, Stream, pipe } from "effect";
import type { WebSocket } from "ws";
import {
  decodeClientEvent,
  encodeWireEvent,
  type ClientEvent,
} from "@pico/protocol";
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

// A client that stops reading would let the socket buffer grow unbounded;
// killing the connection is safe since the client reconnects via its cursor.
const MAX_WS_BUFFERED_BYTES = 8 * 1024 * 1024;

const sendOob = (ws: WebSocket, payload: object) => {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
  }
};

export const makeConnectionHandler =
  (runtime: Runtime.Runtime<SessionManager>) =>
  (ws: WebSocket, bindings: WsBindings): void => {
    const runFork = Runtime.runFork(runtime);
    runFork(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<ClientEvent>();
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
      if (Either.isLeft(result)) {
        sendOob(ws, {
          error: "invalid_event",
          issues: [result.left.message],
        });
        return;
      }

      runFork(Queue.offer(state.queue, result.right));
    });

    ws.on("close", () => {
      const state = STATE.get(ws);
      if (!state) return;
      STATE.delete(ws);
      runFork(
        Effect.all([
          Effect.logInfo(`ws close session=${state.bindings.sessionId}`),
          Fiber.interrupt(state.fiber),
          Queue.shutdown(state.queue),
        ]),
      );
    });

    ws.on("error", (err) => {
      runFork(
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
        Effect.sync(() => {
          if (ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
            ws.terminate();
            return;
          }
          ws.send(encodeWireEvent(event));
        }),
      ),
    );

    const incoming = pipe(
      Queue.take(queue),
      Effect.flatMap((evt) => {
        switch (evt.t) {
          case "send":
            return mgr.send(bindings.sessionId, evt.text, evt.mode, evt.images ? [...evt.images] : undefined, evt.clientId);
          case "interrupt":
            return mgr.interrupt(bindings.sessionId);
          case "permission_reply":
            return mgr.approve(bindings.sessionId, evt.id, evt.choice);
          case "extension_ui_response":
            return mgr.extensionUiResponse(bindings.sessionId, evt.id, evt.value);
        }
      }),
      Effect.forever,
    );

    yield* Effect.raceFirst(outgoing, incoming);
  }).pipe(
    Effect.catchTag("SessionNotFound", (e) =>
      Effect.sync(() => ws.close(4004, `session not found: ${e.id}`)),
    ),
    // catchAllCause (not catchAll) so defects also close the socket rather
    // than killing the fiber and stranding the client on a dead connection.
    Effect.catchAllCause((cause) =>
      Cause.isInterruptedOnly(cause)
        ? Effect.void
        : Effect.logError(`ws session failed: ${Cause.pretty(cause)}`).pipe(
            Effect.andThen(() =>
              Effect.sync(() => ws.close(1011, "internal error")),
            ),
          ),
    ),
  );
