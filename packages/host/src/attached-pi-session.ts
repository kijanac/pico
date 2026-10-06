import type { Socket } from "node:net";
import {
  PicoAttachEvent,
  PicoAttachResponse,
  SessionControls,
  SessionStats,
  type PicoAttachEmission,
  type PicoAttachHello,
  type PicoAttachRequest,
  type SessionCapability,
} from "@pico/protocol";
import { Effect, Queue, Schema, Stream } from "effect";
import { v7 as randomUUIDv7 } from "uuid";
import {
  PiError,
  type PresenceSessionRuntime,
  type SessionEmission,
} from "./session-runtime.ts";

const REQUEST_TIMEOUT_MS = 30_000;

type PendingRequest = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

type WithoutEnvelope<T> = T extends unknown ? Omit<T, "t" | "id"> : never;
type RequestInput = WithoutEnvelope<PicoAttachRequest>;

export interface AttachedPiPeer {
  readonly session: PresenceSessionRuntime;
  receive(message: unknown): Promise<void>;
  disconnect(reason?: string): void;
}

const SUPPORTED_ATTACHED_CAPABILITIES = new Set<SessionCapability>([
  "rename",
  "interrupt",
  "settings",
  "stats",
]);

export const makeAttachedPiPeer = (
  socket: Socket,
  hello: PicoAttachHello,
): Effect.Effect<AttachedPiPeer, PiError> =>
  Effect.gen(function* () {
    const { capabilities: requestedCapabilities = [], ...runtimeMeta } = hello.session;
    const unsupportedCapability = requestedCapabilities.find(
      (capability) => !SUPPORTED_ATTACHED_CAPABILITIES.has(capability),
    );
    if (unsupportedCapability) {
      return yield* Effect.fail(new PiError({
        message: `unsupported attached capability: ${unsupportedCapability}`,
      }));
    }

    const emissions = yield* Queue.bounded<SessionEmission>(1024);
    const pending = new Map<string, PendingRequest>();
    let disconnected = false;

    const disconnect = (reason = "Pi extension disconnected") => {
      if (disconnected) return;
      disconnected = true;
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error(reason));
      }
      pending.clear();
      Effect.runFork(Queue.shutdown(emissions));
    };

    const request = (input: RequestInput): Promise<unknown> =>
      new Promise((resolve, reject) => {
        if (disconnected || socket.destroyed) {
          reject(new Error("Pi extension is offline"));
          return;
        }
        const id = randomUUIDv7();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Pi extension request timed out: ${input.method}`));
        }, REQUEST_TIMEOUT_MS);
        timer.unref();
        pending.set(id, { resolve, reject, timer });
        socket.write(`${JSON.stringify({ t: "request", id, ...input })}\n`);
      });

    const remote = <A>(label: string, run: () => Promise<A>): Effect.Effect<A, PiError> =>
      Effect.tryPromise({
        try: run,
        catch: (cause) => new PiError({ message: `${label} failed: ${String(cause)}`, cause }),
      });

    const capabilities = requestedCapabilities;
    const session: PresenceSessionRuntime = {
      lifecycle: { kind: "presence" },
      acceptsImages: false,
      meta: runtimeMeta,
      events: Stream.fromQueue(emissions),
      send: (message, mode, images, clientId) =>
        remote("attached send", async () => {
          await request({
            method: "send",
            params: {
              text: message,
              mode,
              clientId: clientId ?? randomUUIDv7(),
              ...(images ? { images } : {}),
            },
          });
        }),
      ...(capabilities.includes("interrupt") ? {
        interrupt: () =>
          remote("attached interrupt", async () => {
            await request({ method: "interrupt" });
          }),
      } : {}),
      ...(hello.session.canBackground ? {
        requestBackground: () =>
          remote("attached background request", async () => {
            await request({ method: "background" });
          }),
      } : {}),
      ...(capabilities.includes("rename") ? {
        patchSession: (patch: { title?: string }) =>
          remote("attached rename", async () => {
            if (patch.title !== undefined) {
              await request({ method: "patchSession", params: { title: patch.title } });
            }
          }),
      } : {}),
      ...(capabilities.includes("settings") ? {
        getSettings: () =>
          remote("attached settings", async () =>
            Schema.decodeUnknownSync(SessionControls)(await request({ method: "getSettings" })),
          ),
        patchSetting: (key: string, value: string | boolean) =>
          remote("attached setting", async () =>
            Schema.decodeUnknownSync(SessionControls)(
              await request({ method: "patchSetting", params: { key, value } }),
            ),
          ),
      } : {}),
      ...(capabilities.includes("stats") ? {
        getStats: () =>
          remote("attached stats", async () =>
            Schema.decodeUnknownSync(SessionStats)(await request({ method: "getStats" })),
          ),
      } : {}),
      getLog: () => Effect.succeed([...hello.snapshot]),
      close: () =>
        Effect.sync(() => {
          disconnect("Attached session closed by pico-host");
          socket.destroy();
        }),
    };

    return {
      session,
      async receive(message) {
        const response = Schema.decodeUnknownOption(PicoAttachResponse)(message);
        if (response._tag === "Some") {
          const waiting = pending.get(response.value.id);
          if (!waiting) return;
          pending.delete(response.value.id);
          clearTimeout(waiting.timer);
          if (response.value.ok) waiting.resolve(response.value.value);
          else waiting.reject(new Error(response.value.error));
          return;
        }

        const event = Schema.decodeUnknownOption(PicoAttachEvent)(message);
        if (event._tag === "None") return;
        await Effect.runPromise(Queue.offer(emissions, event.value.event as PicoAttachEmission as SessionEmission));
      },
      disconnect,
    };
  });
