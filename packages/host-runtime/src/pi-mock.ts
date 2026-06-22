import { randomUUIDv7 } from "node:crypto";
import { Effect, Fiber, Layer, Queue, Random, Ref, Stream } from "effect";
import type { SessionControls, SessionMeta } from "@pico/protocol";
import { SessionNotFound } from "./errors.ts";
import {
  PiClient,
  PiError,
  type PiEmission,
  type PiSession,
} from "./pi.ts";

const sleepRand = (minMs: number, spreadMs: number) =>
  Effect.flatMap(Random.next, (r) =>
    Effect.sleep(`${minMs + Math.floor(r * spreadMs)} millis`),
  );

function* chunks(s: string, min: number, max: number): Generator<string> {
  let i = 0;
  while (i < s.length) {
    const n = min + Math.floor(Math.random() * (max - min + 1));
    yield s.slice(i, i + n);
    i += n;
  }
}

const SCRIPT_REPLY_1 =
  "Looking at the auth middleware first to understand the current shape.";
const SCRIPT_REPLY_2 =
  "Three call sites. I'll swap the algorithm in `lib/jwt.ts`, load the public key from `KEYS_DIR/public.pem`, and update the test fixture to sign with RS256.";

const EDIT_OLD = `import jwt from "jsonwebtoken";

export function verifyToken(token: string) {
  return jwt.verify(token, process.env.JWT_SECRET!, {
    algorithms: ["HS256"],
  });
}`;

const EDIT_NEW = `import jwt from "jsonwebtoken";
import { readFileSync } from "node:fs";

const PUBLIC_KEY = readFileSync(
  \`\${process.env.KEYS_DIR}/public.pem\`,
  "utf8",
);

export function verifyToken(token: string) {
  return jwt.verify(token, PUBLIC_KEY, {
    algorithms: ["RS256"],
  });
}`;

const mockSettings = (): SessionControls => ({
  controls: [
    { key: "model", kind: "select", label: "model", value: "mock/mock-1", options: [{ value: "mock/mock-1", label: "Mock Model", description: "Mock · mock-1 · 100k context" }] },
    { key: "thinkingLevel", kind: "select", label: "thinking level", value: "off", options: [{ value: "off", label: "off" }] },
    { key: "steeringMode", kind: "select", label: "steering while running", value: "one-at-a-time", options: [{ value: "one-at-a-time", label: "one-at-a-time" }, { value: "all", label: "all" }] },
    { key: "followUpMode", kind: "select", label: "follow-up delivery", value: "one-at-a-time", options: [{ value: "one-at-a-time", label: "one-at-a-time" }, { value: "all", label: "all" }] },
    { key: "autoCompaction", kind: "boolean", label: "auto compact", value: true },
    { key: "autoRetry", kind: "boolean", label: "auto retry", value: true },
  ],
});

const scriptedFlow = (q: Queue.Queue<PiEmission>, userText: string) =>
  Effect.gen(function* () {
    yield* Queue.offer(q, { t: "status", status: "thinking" });
    yield* Effect.sleep("400 millis");

    const id1 = randomUUIDv7();
    for (const chunk of chunks(SCRIPT_REPLY_1, 3, 5)) {
      yield* Queue.offer(q, { t: "assistant_delta", id: id1, text: chunk });
      yield* sleepRand(25, 60);
    }
    yield* Queue.offer(q, { t: "assistant_end", id: id1 });

    const tcId = randomUUIDv7();
    yield* Queue.offer(q, {
      t: "tool_call",
      entry: {
        kind: "tool_call",
        toolKind: "builtin",
        id: tcId,
        at: Date.now(),
        tool: "read",
        args: { path: "src/middleware/auth.ts" },
        status: "running",
      },
    });
    yield* sleepRand(60, 80);
    yield* Queue.offer(q, {
      t: "tool_result",
      id: tcId,
      result: "42 lines",
      status: "ok",
      durationMs: 14,
    });

    const id2 = randomUUIDv7();
    for (const chunk of chunks(SCRIPT_REPLY_2, 3, 5)) {
      yield* Queue.offer(q, { t: "assistant_delta", id: id2, text: chunk });
      yield* sleepRand(20, 50);
    }
    yield* Queue.offer(q, { t: "assistant_end", id: id2 });

    const editId = randomUUIDv7();
    yield* Queue.offer(q, {
      t: "tool_call",
      entry: {
        kind: "tool_call",
        toolKind: "builtin",
        id: editId,
        at: Date.now(),
        tool: "edit",
        args: {
          path: "lib/jwt.ts",
          edits: [{ oldText: EDIT_OLD, newText: EDIT_NEW }],
        },
        status: "running",
      },
    });
    yield* sleepRand(80, 120);
    yield* Queue.offer(q, {
      t: "tool_result",
      id: editId,
      result: "Edited lib/jwt.ts (1 replacement, +5 -1 lines)",
      status: "ok",
      durationMs: 31,
    });

    yield* Queue.offer(q, {
      t: "permission",
      entry: {
        kind: "permission",
        toolKind: "builtin",
        id: randomUUIDv7(),
        at: Date.now(),
        tool: "bash",
        args: { command: "openssl genrsa -out keys/private.pem 2048" },
        rationale: `Need an RSA key for the test fixture (echoing your prompt: "${userText.slice(0, 40)}").`,
      },
    });
    yield* Queue.offer(q, { t: "status", status: "waiting" });
  }).pipe(Effect.catchAll((e) => Effect.fail(new PiError(String(e), { cause: e }))));

const makeMockSession = (opts: {
  cwd: string;
  title: string;
}): Effect.Effect<PiSession, PiError> =>
  Effect.gen(function* () {
    const q = yield* Queue.unbounded<PiEmission>();
    const currentFiber = yield* Ref.make<Fiber.RuntimeFiber<
      void,
      PiError
    > | null>(null);

    const meta: SessionMeta = {
      id: randomUUIDv7(),
      title: opts.title,
      cwd: opts.cwd,
      status: "idle",
      updatedAt: new Date().toISOString(),
      tokens: { in: 0, out: 0 },
      costUsd: 0,
      archived: false,
    };

    return {
      meta,
      events: Stream.fromQueue(q),
      send: (text, _mode) =>
        Effect.gen(function* () {
          const prev = yield* Ref.get(currentFiber);
          if (prev) yield* Fiber.interrupt(prev);
          const f = yield* Effect.forkDaemon(scriptedFlow(q, text));
          yield* Ref.set(currentFiber, f);
        }),
      isCompacting: () => Effect.succeed(false),
      flushAfterCompaction: (messages) =>
        Effect.gen(function* () {
          const first = messages[0];
          if (!first) return;
          const prev = yield* Ref.get(currentFiber);
          if (prev) yield* Fiber.interrupt(prev);
          const f = yield* Effect.forkDaemon(scriptedFlow(q, first.text));
          yield* Ref.set(currentFiber, f);
        }),
      interrupt: () =>
        Effect.gen(function* () {
          const prev = yield* Ref.get(currentFiber);
          if (prev) yield* Fiber.interrupt(prev);
          yield* Queue.offer(q, { t: "status", status: "idle" });
        }),
      extensionUiResponse: () => Effect.void,
      approve: (id) =>
        Effect.gen(function* () {
          yield* Queue.offer(q, { t: "status", status: "thinking" });
          yield* sleepRand(120, 80);
          yield* Queue.offer(q, {
            t: "tool_result",
            id,
            result: "Generating RSA private key, 2048 bit long modulus",
            status: "ok",
            durationMs: 240,
          });
          yield* Queue.offer(q, { t: "status", status: "idle" });
        }),
      compact: () => Effect.void,
      exportHtml: () => {
        const html = "<!doctype html><title>Mock session</title><p>Mock session</p>";
        const bytes = new TextEncoder().encode(html);
        return Effect.succeed({
          stream: Stream.fromIterable([bytes]),
          size: bytes.byteLength,
          filename: "pi-session-mock.html",
        });
      },
      listCommands: () => Effect.succeed({ builtins: [], prompts: [], skills: [] }),
      getQueue: () => Effect.succeed({ steering: [], followUp: [] }),
      clearQueue: () => Effect.succeed({ steering: [], followUp: [] }),
      patchSession: () => Effect.void,
      getSettings: () => Effect.succeed(mockSettings()),
      patchSetting: () => Effect.succeed(mockSettings()),
      getStats: () =>
        Effect.succeed({
          sessionId: meta.id,
          cwd: meta.cwd,
          userMessages: 0,
          assistantMessages: 0,
          toolCalls: 0,
          toolResults: 0,
          totalMessages: 0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          cost: 0,
        }),
      getLog: () => Effect.succeed([]),
      getTree: () => Effect.succeed({ currentId: null, entries: [] }),
      navigateTree: () => Effect.void,
      close: () =>
        Effect.gen(function* () {
          const prev = yield* Ref.get(currentFiber);
          if (prev) yield* Fiber.interrupt(prev);
          yield* Queue.shutdown(q);
        }),
    };
  });

export const PiClientMock = Layer.succeed(PiClient, {
  create: (opts) => makeMockSession(opts),
  resume: (storedMeta) =>
    Effect.fail(new SessionNotFound(storedMeta.id)),
});
