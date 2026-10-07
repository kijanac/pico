import { randomUUIDv7 } from "node:crypto";
import { SessionManager as PiSessionManager, type AgentSessionEvent, type PromptOptions } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { SessionControls, SessionMeta } from "@pico/protocol";
import { SessionNotFound } from "./errors.ts";
import { makeLive, PiClient, type LiveHooks, type PiCore, type PiSession } from "./pi.ts";

const SCRIPT_REPLY_1 = "Looking at the auth middleware first to understand the current shape.";
const SCRIPT_REPLY_2 =
  "Three call sites. I'll swap the algorithm in `lib/jwt.ts`, load the public key from `KEYS_DIR/public.pem`, and update the test fixture to sign with RS256.";
const SCRIPT_REPLY_3 = "Done: tokens are verified with RS256 and the tests pass.";

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

const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A tool call's arguments as the model has written them so far: each string cut short.
const writtenSoFar = (value: unknown, fraction: number): unknown =>
  typeof value === "string"
    ? value.slice(0, Math.ceil(value.length * fraction))
    : Array.isArray(value)
      ? value.map((item) => writtenSoFar(item, fraction))
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, writtenSoFar(item, fraction)]))
        : value;

class Aborted extends Error {}

// A scripted stand-in for pi's agent over pi's real in-memory session file:
// the same events, in the same order, and saves after notifying, as pi does.
const makeMockCore = (cwd: string): PiCore => {
  const sessionManager = PiSessionManager.inMemory(cwd);
  const listeners = new Set<(event: AgentSessionEvent) => void>();
  const queue = { steering: [] as string[], followUp: [] as string[] };
  let running: Promise<void> | null = null;
  let aborted = false;

  const emit = (event: object) => {
    for (const listener of listeners) listener(event as AgentSessionEvent);
  };
  const emitQueue = () => emit({ type: "queue_update", steering: [...queue.steering], followUp: [...queue.followUp] });
  const pause = async (ms: number) => {
    await sleep(ms);
    if (aborted) throw new Aborted();
  };

  const say = (text: string) => {
    const message = { role: "user" as const, content: [{ type: "text" as const, text }], timestamp: Date.now() };
    emit({ type: "message_start", message });
    emit({ type: "message_end", message });
    sessionManager.appendMessage(message);
  };

  const reply = async (text: string, toolCalls: ToolCall[] = []) => {
    const message: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "mock",
      provider: "mock",
      model: "mock-1",
      usage: zeroUsage,
      stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
      timestamp: Date.now(),
    };
    emit({ type: "message_start", message });
    let streamed = "";
    try {
      for (let i = 0; i < text.length; i += 4) {
        streamed = text.slice(0, i + 4);
        emit({ type: "message_update", message, assistantMessageEvent: { type: "text_delta", delta: text.slice(i, i + 4) } });
        await pause(30);
      }
      // Then the tool calls, their arguments streaming in as pi parses them.
      for (const [index, call] of toolCalls.entries()) {
        const part: ToolCall = { ...call, arguments: {} };
        message.content = [...toolCalls.slice(0, index), part];
        emit({ type: "message_update", message, assistantMessageEvent: { type: "toolcall_start", contentIndex: index } });
        for (let step = 1; step <= 10; step += 1) {
          part.arguments = writtenSoFar(call.arguments, step / 10) as ToolCall["arguments"];
          emit({ type: "message_update", message, assistantMessageEvent: { type: "toolcall_delta", contentIndex: index, delta: "" } });
          await pause(60);
        }
      }
    } finally {
      // pi saves an interrupted reply too, with what streamed so far.
      message.content = [{ type: "text", text: streamed }, ...(aborted ? [] : toolCalls)];
      if (aborted) message.stopReason = "aborted";
      emit({ type: "message_end", message });
      sessionManager.appendMessage(message);
    }
  };

  const tool = async (call: ToolCall, output: string[], stepMs: number) => {
    emit({ type: "tool_execution_start", toolCallId: call.id, toolName: call.name, args: call.arguments });
    let text = "";
    let isError = false;
    try {
      for (const line of output) {
        text += `${line}\n`;
        emit({ type: "tool_execution_update", toolCallId: call.id, toolName: call.name, args: call.arguments, partialResult: { content: [{ type: "text", text }] } });
        await pause(stepMs);
      }
    } catch (error) {
      isError = true;
      text += "Aborted";
      throw error;
    } finally {
      const result = { content: [{ type: "text" as const, text }], details: undefined };
      emit({ type: "tool_execution_end", toolCallId: call.id, toolName: call.name, result, isError });
      const message = { role: "toolResult" as const, toolCallId: call.id, toolName: call.name, content: result.content, isError, timestamp: Date.now() };
      emit({ type: "message_start", message });
      emit({ type: "message_end", message });
      sessionManager.appendMessage(message);
    }
  };

  // Steering waits for a turn boundary, follow-ups for the end, like pi's.
  const deliver = (lane: "steering" | "followUp") => {
    const text = queue[lane].shift();
    if (text === undefined) return false;
    emitQueue();
    say(text);
    return true;
  };

  const run = async (text: string) => {
    emit({ type: "agent_start" });
    try {
      say(text);
      const read: ToolCall = { type: "toolCall", id: randomUUIDv7(), name: "read", arguments: { path: "src/middleware/auth.ts" } };
      await reply(SCRIPT_REPLY_1, [read]);
      await tool(read, ["42 lines"], 80);
      deliver("steering");
      const bash: ToolCall = { type: "toolCall", id: randomUUIDv7(), name: "bash", arguments: { command: "pnpm test" } };
      await reply(SCRIPT_REPLY_2, [bash]);
      await tool(bash, Array.from({ length: 20 }, (_, i) => `✓ auth ${i + 1}/20`), 150);
      deliver("steering");
      const edit: ToolCall = { type: "toolCall", id: randomUUIDv7(), name: "edit", arguments: { path: "lib/jwt.ts", edits: [{ oldText: EDIT_OLD, newText: EDIT_NEW }] } };
      await reply("", [edit]);
      await tool(edit, ["Edited lib/jwt.ts (1 replacement, +5 -1 lines)"], 100);
      await reply(SCRIPT_REPLY_3);
      while (deliver("steering") || deliver("followUp")) await reply("Noted.");
    } catch (error) {
      if (!(error instanceof Aborted)) throw error;
    } finally {
      emit({ type: "agent_end", messages: [], willRetry: false });
      running = null;
      aborted = false;
      emit({ type: "agent_settled" });
    }
  };

  return {
    sessionManager,
    get isStreaming() {
      return running !== null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt(text: string, options?: PromptOptions) {
      if (running) {
        queue[options?.streamingBehavior === "followUp" ? "followUp" : "steering"].push(text);
        emitQueue();
        options?.preflightResult?.("queued");
        return;
      }
      options?.preflightResult?.("started");
      running = run(text);
      await running;
    },
    async abort() {
      if (!running) return;
      aborted = true;
      await running;
    },
    clearQueue() {
      const cleared = { steering: queue.steering.splice(0), followUp: queue.followUp.splice(0) };
      emitQueue();
      return cleared;
    },
    getSessionStats: () => ({
      sessionFile: undefined,
      sessionId: sessionManager.getSessionId(),
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: sessionManager.getEntryCount(),
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    }),
  };
};

const makeMockSession = (opts: { cwd: string; title: string }, hooks: LiveHooks): PiSession => {
  const core = makeMockCore(opts.cwd);
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
  const live = makeLive(core, meta, hooks);
  return {
    live,
    interrupt: () => Effect.promise(() => core.abort()),
    extensionUiResponse: () => Effect.void,
    compact: () => Effect.void,
    exportHtml: () => {
      const bytes = new TextEncoder().encode("<!doctype html><title>Mock session</title><p>Mock session</p>");
      return Effect.succeed({ stream: Stream.make(bytes), size: bytes.byteLength, filename: "pi-session-mock.html" });
    },
    listCommands: () => Effect.succeed({ builtins: [], prompts: [], skills: [], extensions: [] }),
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
    getTree: () => Effect.succeed({ currentId: null, entries: [] }),
    navigateTree: () => Effect.void,
    close: () => Effect.sync(() => live.close()),
  };
};

export const PiClientMock = Layer.succeed(PiClient, {
  create: (opts, hooks) => Effect.sync(() => makeMockSession(opts, hooks)),
  resume: (record) => Effect.fail(new SessionNotFound({ id: record.id })),
});
