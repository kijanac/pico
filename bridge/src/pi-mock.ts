import { randomUUID } from "node:crypto";
import { Effect, Fiber, Layer, Queue, Random, Ref, Stream } from "effect";
import type { ModelSummary, SessionMeta } from "@pi-mobile/protocol";
import { SessionNotFound } from "./errors.ts";
import {
  PiClient,
  PiError,
  type PiEmission,
  type PiSession,
} from "./pi.ts";

const nextId = (prefix: string) => `${prefix}_${randomUUID()}`;

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

const mockModel: ModelSummary = {
  provider: "mock",
  id: "mock-1",
  name: "Mock Model",
  reasoning: false,
  input: ["text"],
  contextWindow: 100_000,
  maxTokens: 4096,
  current: true,
  usingOAuth: false,
};

const scriptedFlow = (q: Queue.Queue<PiEmission>, userText: string) =>
  Effect.gen(function* () {
    yield* Queue.offer(q, { t: "status", status: "thinking" });
    yield* Effect.sleep("400 millis");

    const id1 = nextId("m");
    for (const chunk of chunks(SCRIPT_REPLY_1, 3, 5)) {
      yield* Queue.offer(q, { t: "assistant_delta", id: id1, text: chunk });
      yield* sleepRand(25, 60);
    }
    yield* Queue.offer(q, { t: "assistant_end", id: id1 });

    const tcId = nextId("t");
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

    const id2 = nextId("m");
    for (const chunk of chunks(SCRIPT_REPLY_2, 3, 5)) {
      yield* Queue.offer(q, { t: "assistant_delta", id: id2, text: chunk });
      yield* sleepRand(20, 50);
    }
    yield* Queue.offer(q, { t: "assistant_end", id: id2 });

    const editId = nextId("t");
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
        id: nextId("p"),
        at: Date.now(),
        tool: "bash",
        args: { command: "openssl genrsa -out keys/private.pem 2048" },
        rationale: `Need an RSA key for the test fixture (echoing your prompt: "${userText.slice(0, 40)}").`,
      },
    });
    yield* Queue.offer(q, { t: "status", status: "waiting" });
  }).pipe(Effect.catchAll((e) => Effect.fail(new PiError(String(e)))));

const makeMockSession = (opts: {
  cwd: string;
  worktreeCwd?: string;
  title?: string;
  branch?: string;
}): Effect.Effect<PiSession, PiError> =>
  Effect.gen(function* () {
    const q = yield* Queue.unbounded<PiEmission>();
    const currentFiber = yield* Ref.make<Fiber.RuntimeFiber<
      void,
      PiError
    > | null>(null);

    const meta: SessionMeta = {
      id: nextId("s"),
      title: opts.title ?? "untitled session",
      cwd: opts.cwd,
      worktreeCwd: opts.worktreeCwd,
      branch: opts.branch,
      status: "idle",
      updatedAt: Date.now(),
      tokens: { in: 0, out: 0 },
      costUsd: 0,
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
      interrupt: () =>
        Effect.gen(function* () {
          const prev = yield* Ref.get(currentFiber);
          if (prev) yield* Fiber.interrupt(prev);
          yield* Queue.offer(q, { t: "status", status: "idle" });
        }),
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
      listModels: () =>
        Effect.succeed({
          current: mockModel,
          models: [mockModel],
        }),
      setModel: () => Effect.void,
      compact: () => Effect.void,
      exportHtml: () => {
        const html = "<!doctype html><title>Mock session</title><p>Mock session</p>";
        return Effect.succeed({
          stream: new Blob([html], { type: "text/html; charset=utf-8" }).stream(),
          size: new TextEncoder().encode(html).byteLength,
        });
      },
      listCommands: () => Effect.succeed({ builtins: [], prompts: [], skills: [] }),
      getQueue: () => Effect.succeed({ steering: [], followUp: [] }),
      clearQueue: () => Effect.succeed({ steering: [], followUp: [] }),
      listAuthProviders: () => Effect.succeed({ providers: [] }),
      startAuthLogin: () => Effect.fail(new PiError("mock auth login unavailable")),
      getAuthLogin: () => Effect.fail(new PiError("mock auth job not found")),
      submitAuthLoginInput: () => Effect.fail(new PiError("mock auth job not found")),
      cancelAuthLogin: () => Effect.void,
      patchSession: () => Effect.void,
      getSettings: () =>
        Effect.succeed({
          thinkingLevel: "off",
          availableThinkingLevels: ["off", "low", "medium", "high"],
          steeringMode: "one-at-a-time",
          followUpMode: "one-at-a-time",
          autoCompaction: true,
          autoRetry: true,
        }),
      patchSettings: () =>
        Effect.succeed({
          thinkingLevel: "off",
          availableThinkingLevels: ["off", "low", "medium", "high"],
          steeringMode: "one-at-a-time",
          followUpMode: "one-at-a-time",
          autoCompaction: true,
          autoRetry: true,
        }),
      getStats: () =>
        Effect.succeed({
          sessionId: meta.id,
          userMessages: 0,
          assistantMessages: 0,
          toolCalls: 0,
          toolResults: 0,
          totalMessages: 0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          cost: 0,
        }),
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
