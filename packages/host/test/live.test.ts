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
import type { Entry, ServerMessage, SessionMeta } from "@pico/protocol";
import { applyTextChange } from "@pico/protocol/log";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";
import type { Cursor } from "../src/transcript.ts";

// The sync leans on pi's event order: it saves a message right after
// notifying message_end, reports a queued send's text in queue_update before
// preflightResult, and delivers steering at the next poll (a steer queued as a
// run starts goes in before the first reply). This drives a real AgentSession
// over pi's scripted model, so a pi upgrade that changes any of that fails here.
// pi.ts reads its config from the environment when imported.
async function importPi(prefix: string) {
  vi.resetModules();
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.PICO_HOST_DB = join(dir, "host.db");
  process.env.PICO_HOST_INSECURE_NO_AUTH = "1";
  process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
  return { dir, pi: await import("../src/pi.ts") };
}

async function liveOverRealPi() {
  const { dir, pi: { makeLive } } = await importPi("pico-live-");

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
  const sessionManager = SessionManager.create(dir, join(dir, "sessions"));
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
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
  const cursors: Cursor[] = [];
  const live = makeLive(session, meta, { persist: () => {}, moved: (_, cursor) => cursors.push(cursor), log: () => {} }, { from: 0, seen: 0 });
  const messages: ServerMessage[] = [];
  live.attach(null, [], { push: (message) => messages.push(message) > 0, end: () => {} });
  return { faux, session, live, messages, cursors, file: sessionManager.getSessionFile()! };
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

const entriesIn = (messages: readonly ServerMessage[]): Entry[] =>
  messages.flatMap((m) => (m.t === "entries" || m.t === "sync" ? m.entries : []));

// A terminal running pi on the same session: its own SessionManager, opened
// from the file, at pi's newest entry, as pi resumes.
const terminalOn = (file: string) => {
  const terminal = SessionManager.open(file);
  const say = (text: string) => {
    terminal.appendMessage({ role: "user", content: text, timestamp: Date.now() });
    terminal.appendMessage(fauxAssistantMessage(`re: ${text}`));
  };
  return { terminal, say };
};

describe("another pi writing the same session", () => {
  it("follows it along the phone's line, and has pi reopened before it writes", async () => {
    const { faux, session, live, messages, cursors, file } = await liveOverRealPi();
    faux.setResponses([fauxAssistantMessage("Hello from the phone's turn.")]);
    await live.send({ cid: "p1", text: "from the phone", mode: "steer", base: null, retry: false });
    await vi.waitFor(() => expect(settled(messages)).toBe(true), { timeout: 10_000 });
    expect(live.behind()).toBe(false);

    const { terminal, say } = terminalOn(file);
    say("from the terminal");
    // Read as the file grows, without anything from pi.
    await vi.waitFor(() => expect(entriesIn(messages).map((entry) => entry.type === "user" && entry.text)).toContain("from the terminal"), { timeout: 5_000 });
    const last = entriesIn(messages).at(-1);
    expect(last).toMatchObject({ type: "assistant", text: "re: from the terminal" });
    expect(cursors.at(-1)?.id).toBe(terminal.getLeafId());
    expect(messages.some((m) => m.t === "elsewhere")).toBe(false);
    // pi still stands where it last wrote; it must be reopened before it writes.
    expect(live.behind()).toBe(true);

    live.close();
    session.dispose();
  });

  it("counts another pi's branch without showing it", { timeout: 30_000 }, async () => {
    const { faux, session, live, messages, file } = await liveOverRealPi();
    faux.setResponses([fauxAssistantMessage("First."), fauxAssistantMessage("Second."), fauxAssistantMessage("Third.")]);
    const turn = async (cid: string, text: string) => {
      messages.length = 0;
      await live.send({ cid, text, mode: "steer", base: null, retry: false });
      await vi.waitFor(() => expect(settled(messages)).toBe(true), { timeout: 10_000 });
    };
    await turn("p1", "one");
    const firstReply = entriesIn(messages).find((entry) => entry.type === "assistant")!;
    await turn("p2", "two");

    // The terminal goes back to the first reply and carries on from there.
    messages.length = 0;
    const { terminal, say } = terminalOn(file);
    terminal.branch(firstReply.id);
    say("a different idea");
    await vi.waitFor(() => expect(messages.findLast((m) => m.t === "elsewhere")).toMatchObject({ elsewhere: { messages: 2 } }), { timeout: 5_000 });
    expect(entriesIn(messages)).toEqual([]);
    // pi stands where the phone does; it only lacks the other branch.
    expect(live.behind()).toBe(false);
    expect(live.behind(terminal.getLeafId()!)).toBe(true);

    // It stays news while the phone carries on along its own line...
    await turn("p3", "three");
    expect(messages.some((m) => m.t === "elsewhere")).toBe(false);
    expect(entriesIn(messages).find((entry) => entry.type === "user")).toMatchObject({ text: "three", cid: "p3" });
    // ...until the phone looks at the tree, which has every branch.
    const tree = live.tree();
    expect(messages.findLast((m) => m.t === "elsewhere")).toEqual({ t: "elsewhere" });
    expect(tree.entries.find((entry) => entry.current)?.text).toBe("Third.");
    expect(tree.entries.some((entry) => entry.text === "a different idea" && !entry.onCurrentPath)).toBe(true);

    live.close();
    session.dispose();
  });

  it("keeps the phone's line pi's own while pi works", { timeout: 30_000 }, async () => {
    const { faux, session, live, messages, file } = await liveOverRealPi();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 0.3" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Done."),
    ]);
    await live.send({ cid: "p1", text: "go", mode: "steer", base: null, retry: false });
    await vi.waitFor(() => expect(entriesIn(messages).some((entry) => entry.type === "assistant" && entry.tools.length > 0)).toBe(true), { timeout: 10_000 });

    // While the tool runs, a terminal carries on from the call pi just saved.
    terminalOn(file).say("meanwhile");
    await vi.waitFor(() => expect(settled(messages)).toBe(true), { timeout: 10_000 });
    expect(entriesIn(messages).map((entry) => entry.type)).toEqual(["user", "assistant", "tool_result", "assistant"]);
    expect(messages.filter((m) => m.t === "sync")).toHaveLength(1);
    expect(messages.findLast((m) => m.t === "elsewhere")).toMatchObject({ elsewhere: { messages: 2 } });

    live.close();
    session.dispose();
  });
});

describe("reopening a session", () => {
  it("stands where the phone was, gone on along its line, not at pi's newest entry", async () => {
    const { dir, pi: { PiClient, PiClientLive } } = await importPi("pico-resume-");
    const file = SessionManager.create(dir, join(dir, "sessions"));
    const say = (text: string) => {
      file.appendMessage({ role: "user", content: text, timestamp: Date.now() });
      file.appendMessage(fauxAssistantMessage(`re: ${text}`));
    };
    say("one");
    const firstReply = file.getLeafId();
    // Carried on along the phone's line while the host was away...
    say("two");
    // ...and later, from the first reply, on another branch: pi's newest entry.
    file.branch(firstReply!);
    say("elsewhere");

    const record = {
      id: file.getSessionId(),
      title: "t",
      cwd: dir,
      status: "idle" as const,
      updatedAtMs: Date.now(),
      tokens: { in: 0, out: 0 },
      costUsd: 0,
      archived: false,
      path: file.getSessionFile()!,
    };
    const moved: Cursor[] = [];
    const hooks = { persist: () => {}, moved: (_: string, cursor: Cursor) => void moved.push(cursor), log: () => {} };
    const resume = (cursor: Cursor | null) =>
      Effect.runPromise(
        Effect.flatMap(PiClient, (pi) => pi.resume({ ...record, cursor }, hooks)).pipe(
          Effect.provide(PiClientLive),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
    const syncOf = (session: Awaited<ReturnType<typeof resume>>) => {
      const messages: ServerMessage[] = [];
      session.live.attach(null, [], { push: (message) => messages.push(message) > 0, end: () => {} });
      return messages[0];
    };

    // pi may save setting changes where it resumes, so the line is compared by what it shows.
    const lastShown = (sync: ServerMessage | undefined) => (sync?.t === "sync" ? sync.entries.at(-1) : undefined);
    // A session the phone never opened opens where pi itself resumes. (First:
    // pi saves its settings where it resumes, which then is newest.)
    const fresh = await resume(null);
    const freshSync = syncOf(fresh);
    expect(lastShown(freshSync)).toMatchObject({ type: "assistant", text: "re: elsewhere" });
    expect(freshSync?.t === "sync" && freshSync.live.elsewhere).toBeUndefined();
    // Saved though nothing moved, so it opens here again.
    expect(moved.at(-1)).toMatchObject({ seen: 6 });
    await Effect.runPromise(fresh.close());

    // The phone was at the first reply when two entries were saved.
    const phone = await resume({ id: firstReply, since: 2, seen: 2 });
    const phoneSync = syncOf(phone);
    expect(lastShown(phoneSync)).toMatchObject({ type: "assistant", text: "re: two" });
    expect(phoneSync).toMatchObject({ live: { elsewhere: { messages: 2 } } });
    await Effect.runPromise(phone.close());

    // The phone went back to the first reply after everything was saved: the
    // branches it left aren't its line, or news.
    const back = await resume({ id: firstReply, since: 6, seen: 6 });
    const backSync = syncOf(back);
    expect(lastShown(backSync)).toMatchObject({ type: "assistant", text: "re: one" });
    expect(backSync?.t === "sync" && backSync.live.elsewhere).toBeUndefined();
    await Effect.runPromise(back.close());
  });
});
