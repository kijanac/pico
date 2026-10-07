import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SessionManager as PiSessionManager } from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  parseStreamingJson,
  type FauxResponseFactory,
  type StreamFunction,
} from "@earendil-works/pi-ai";
import { makePiClient } from "./pi.ts";

// Real pi over pi's scripted model: sessions, tools, settings and export are
// pi's own, so the mock can't drift from it. Each run reads a file, runs a bash
// command that streams output, then answers. The tools stay harmless (the
// session's cwd may be a real repo).
const REPLY_1 = "Looking at the readme first to understand the current shape.";
const REPLY_2 = "Three call sites. Running the auth tests before changing anything.";
const REPLY_3 = "Done: tokens are verified with RS256 and the tests pass.";

const respond: FauxResponseFactory = (context) => {
  // Steps of the current run: tool results since the last finished reply.
  const lastReply = context.messages.findLastIndex((message) => message.role === "assistant" && message.stopReason === "stop");
  const step = context.messages.slice(lastReply + 1).filter((message) => message.role === "toolResult").length;
  if (step === 0) return fauxAssistantMessage([fauxText(REPLY_1), fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" });
  if (step === 1) {
    const command = 'for i in $(seq 1 20); do echo "✓ auth $i/20"; sleep 0.15; done';
    return fauxAssistantMessage([fauxText(REPLY_2), fauxToolCall("bash", { command })], { stopReason: "toolUse" });
  }
  return fauxAssistantMessage(REPLY_3);
};

const faux = createFauxCore({ provider: "mock", models: [{ id: "mock-1", name: "Mock" }], tokensPerSecond: 40 });

// Every request gets the script. pi's real providers parse a tool call's
// arguments as they stream; the scripted model only sets them at the end, so
// this does what they do.
const streamSimple: StreamFunction = (model, context, options) => {
  if (faux.getPendingResponseCount() === 0) faux.appendResponses([respond]);
  const stream = createAssistantMessageEventStream();
  const json = new Map<number, string>();
  void (async () => {
    for await (const event of faux.streamSimple(model, context, options)) {
      if (event.type === "toolcall_delta") {
        json.set(event.contentIndex, (json.get(event.contentIndex) ?? "") + event.delta);
        const part = event.partial.content[event.contentIndex];
        if (part?.type === "toolCall") part.arguments = parseStreamingJson(json.get(event.contentIndex));
      }
      stream.push(event);
    }
  })();
  return stream;
};

// pi's settings, auth, models and session files for the mock: a temp dir,
// never ~/.pi/agent, so sessions last until the host restarts.
const agentDir = mkdtempSync(join(tmpdir(), "pico-mock-pi-"));
const sessionDir = join(agentDir, "sessions");
let runtime: Promise<ModelRuntime> | undefined;

export const PiClientMock = makePiClient({
  modelRuntime: () =>
    (runtime ??= ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null }).then((modelRuntime) => {
      modelRuntime.registerProvider("mock", {
        api: faux.api,
        // Required for custom models; the scripted stream never calls it.
        baseUrl: "http://mock.invalid",
        apiKey: "mock",
        streamSimple,
        models: faux.models.map(({ id, name, reasoning, input, cost, contextWindow, maxTokens }) => ({ id, name, reasoning, input, cost, contextWindow, maxTokens })),
      });
      return modelRuntime;
    })),
  agentDir,
  // On disk rather than in memory: pi exports only saved sessions.
  newSessionManager: (cwd) => PiSessionManager.create(cwd, sessionDir),
  findSession: (cwd, id) => PiSessionManager.findById(cwd, id, sessionDir),
  // Pinned: a real provider's key in the environment would otherwise be the default.
  sessionOptions: (modelRuntime) => ({
    model: modelRuntime.getAvailableSnapshot().find((model) => model.provider === "mock"),
    tools: ["read", "bash"],
  }),
});
