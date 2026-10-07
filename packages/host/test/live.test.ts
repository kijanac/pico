import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { ServerMessage, SessionMeta } from "@pico/protocol";
import { applyTextChange } from "@pico/protocol/log";
import { describe, expect, it, vi } from "vitest";

// The sync leans on pi's event order: it saves a message right after
// notifying message_end, reports a queued send's text in queue_update before
// preflightResult, and delivers steering at the next poll (a steer queued as a
// run starts goes in before the first reply). This drives a real AgentSession
// over pi's scripted model, so a pi upgrade that changes any of that fails here.
async function liveOverRealPi() {
  vi.resetModules();
  const dir = mkdtempSync(join(tmpdir(), "pico-live-"));
  process.env.PICO_HOST_DB = join(dir, "host.db");
  process.env.PICO_HOST_INSECURE_NO_AUTH = "1";
  const { makeLive } = await import("../src/pi.ts");

  const faux = createFauxCore({ provider: "faux", models: [{ id: "faux-1" }], tokensPerSecond: 400 });
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null });
  runtime.registerProvider("faux", {
    api: faux.api,
    // Required for custom models; the scripted stream never calls it.
    baseUrl: "http://faux.invalid",
    apiKey: "faux",
    streamSimple: faux.streamSimple,
    models: faux.models,
  });
  const services = await createAgentSessionServices({ cwd: dir, agentDir: join(dir, "agent"), modelRuntime: runtime });
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(dir),
    model: runtime.getAvailableSnapshot().find((model) => model.provider === "faux"),
    tools: ["bash"],
  });

  const meta: SessionMeta = {
    id: session.sessionId,
    title: "t",
    cwd: dir,
    status: "idle",
    updatedAt: new Date().toISOString(),
    tokens: { in: 0, out: 0 },
    costUsd: 0,
    archived: false,
  };
  const live = makeLive(session, meta, { persist: () => {}, log: () => {} });
  const messages: ServerMessage[] = [];
  live.attach(null, [], { push: (message) => messages.push(message) > 0, end: () => {} });
  return { faux, session, live, messages };
}

const settled = (messages: ServerMessage[]) => messages.some((m) => m.t === "run" && !m.running);

describe("the live session over real pi", () => {
  it("publishes pi's entries in order, links sends by cid, and mirrors only what was forwarded", async () => {
    const { faux, session, live, messages } = await liveOverRealPi();
    faux.setResponses([
      fauxAssistantMessage([fauxText("Checking the files."), fauxToolCall("bash", { command: "printf 'a\\n'; sleep 0.2; printf 'b\\n'" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("All done."),
    ]);

    const prompt = await live.send({ cid: "p1", text: "look around", mode: "steer", base: null, retry: false });
    const steer = await live.send({ cid: "s1", text: "and be quick", mode: "steer", base: null, retry: false });
    expect([prompt.state, steer.state]).toEqual(["started", "queued"]);
    // The queued send's row carries its cid from the first queue update.
    const firstQueue = messages.find((m) => m.t === "queue" && m.queue.length > 0);
    expect(firstQueue).toMatchObject({ queue: [{ text: "and be quick", cid: "s1" }] });

    await vi.waitFor(() => expect(settled(messages)).toBe(true), { timeout: 10_000 });

    const entries = messages.flatMap((m) => (m.t === "entries" ? m.entries : []));
    expect(entries.map((entry) => entry.type)).toEqual(["user", "user", "assistant", "tool_result", "assistant"]);
    const users = entries.filter((entry) => entry.type === "user");
    expect(users.map((entry) => [entry.text, entry.cid])).toEqual([["look around", "p1"], ["and be quick", "s1"]]);

    // The assistant entry with the tool call is published before its tool's output or result.
    const index = (predicate: (m: ServerMessage) => boolean) => messages.findIndex(predicate);
    const callPublished = index((m) => m.t === "entries" && m.entries.some((entry) => entry.type === "assistant" && entry.tools.length > 0));
    const firstOutput = index((m) => m.t === "out" || (m.t === "entries" && m.entries.some((entry) => entry.type === "tool_result")));
    expect(callPublished).toBeGreaterThan(-1);
    expect(callPublished).toBeLessThan(firstOutput);

    // The call shows while the model writes it, and its streamed arguments are what pi saved.
    expect(index((m) => m.t === "call")).toBeGreaterThan(-1);
    expect(index((m) => m.t === "call")).toBeLessThan(callPublished);
    const streamedArgs = messages.reduce((json, m) => (m.t === "call" ? applyTextChange(json, m) : json), "");
    const saved = entries.find((entry) => entry.type === "assistant" && entry.tools.length > 0);
    expect(saved?.type === "assistant" && JSON.parse(streamedArgs)).toEqual(saved?.type === "assistant" && saved.tools[0].args);

    // Each reply's streamed text is exactly what pi saved: nothing repeated or lost.
    const replies: string[] = [];
    for (const m of messages) {
      if (m.t === "msg") replies.push("");
      else if (m.t === "d") replies[replies.length - 1] += m.s;
    }
    expect(replies.filter(Boolean)).toEqual(entries.flatMap((entry) => (entry.type === "assistant" && entry.text ? [entry.text] : [])));

    const result = entries.find((entry) => entry.type === "tool_result");
    expect(result?.type === "tool_result" && result.resultContent?.[0]).toMatchObject({ type: "text", text: expect.stringContaining("a\nb") });

    // A phone that saw only the first message catches up with the rest.
    const later: ServerMessage[] = [];
    live.attach(users[0].id, [], { push: (message) => later.push(message) > 0, end: () => {} });
    expect(later[0]).toMatchObject({ t: "sync", reset: false, live: { running: false, tools: [], queue: [] } });
    expect(later[0]?.t === "sync" && later[0].entries.map((entry) => entry.type)).toEqual(["user", "assistant", "tool_result", "assistant"]);

    live.close();
    session.dispose();
  });
});
