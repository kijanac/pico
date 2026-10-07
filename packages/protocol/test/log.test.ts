import { describe, expect, it } from "vitest";
import type { Entry } from "../src/index.ts";
import {
  applyEntry,
  applyLiveEvent,
  applyTextChange,
  emptyLive,
  emptyLog,
  endLiveItem,
  reconcileOrphanedToolCalls,
  textChange,
  TOOL_INTERRUPTED_MESSAGE,
} from "../src/log.ts";

const turn: Entry[] = [
  { type: "user", id: "u1", at: 1, text: "list files", cid: "c1" },
  { type: "assistant", id: "a1", at: 100, text: "Listing.", tools: [{ id: "t1", name: "bash", args: { command: "ls" } }], stopReason: "toolUse" },
  { type: "tool_result", id: "r1", at: 350, toolCallId: "t1", isError: false, resultContent: [{ type: "text", text: "a b" }] },
];

describe("folding pi's entries into rows", () => {
  it("gives an assistant message a row per tool call, completed by its result", () => {
    const log = emptyLog();
    for (const entry of turn) applyEntry(log, entry);
    expect(log.entries.map((row) => `${row.kind}:${row.id}`)).toEqual(["user:u1", "assistant:a1", "tool_call:t1"]);
    expect(log.entries[0]).toMatchObject({ cid: "c1" });
    expect(log.entries[2]).toMatchObject({
      toolKind: "builtin",
      tool: "bash",
      args: { command: "ls" },
      status: "ok",
      durationMs: 250,
      resultContent: [{ type: "text", text: "a b" }],
    });
  });

  it("shows a call whose args don't fit its builtin tool as a custom tool", () => {
    const log = emptyLog();
    applyEntry(log, { type: "assistant", id: "a1", at: 1, text: "", tools: [{ id: "t1", name: "read", args: { file: 3 } }] });
    applyEntry(log, { type: "assistant", id: "a2", at: 2, text: "", tools: [{ id: "t2", name: "search", args: "not an object" }] });
    expect(log.entries[1]).toMatchObject({ toolKind: "custom", tool: "read", args: { file: 3 } });
    expect(log.entries[3]).toMatchObject({ toolKind: "custom", tool: "search", args: {} });
  });

  it("skips entries it already folded, so overlapping batches are harmless", () => {
    const log = emptyLog();
    for (const entry of [...turn, ...turn]) applyEntry(log, entry);
    expect(log.entries).toHaveLength(3);
  });

  it("marks tool calls left running as interrupted once no run is active", () => {
    const log = emptyLog();
    applyEntry(log, turn[1]);
    expect(reconcileOrphanedToolCalls(log)).toBe(true);
    expect(log.entries[1]).toMatchObject({ status: "error", result: TOOL_INTERRUPTED_MESSAGE });
    expect(reconcileOrphanedToolCalls(log)).toBe(false);
  });
});

describe("the live mirror", () => {
  it("streams a reply until its saved entry replaces it", () => {
    const live = emptyLive();
    applyLiveEvent(live, { t: "msg", at: 5 });
    applyLiveEvent(live, { t: "d", s: "Hel" });
    applyLiveEvent(live, { t: "d", s: "lo" });
    expect(live.msg).toEqual({ at: 5, text: "Hello", calls: [] });
    endLiveItem(live, { type: "assistant", id: "a1", at: 6, text: "Hello", tools: [] });
    expect(live.msg).toBeUndefined();
  });

  it("appends tool output from an offset, or replaces it from 0", () => {
    const live = emptyLive();
    applyLiveEvent(live, { t: "out", id: "t1", from: 0, s: "line 1\n" });
    const tool = applyLiveEvent(live, { t: "out", id: "t1", from: 7, s: "line 2\n" });
    expect(tool?.text).toBe("line 1\nline 2\n");
    applyLiveEvent(live, { t: "out", id: "t1", from: 0, s: "tail only\n" });
    expect(live.tools[0].text).toBe("tail only\n");
    endLiveItem(live, turn[2]);
    expect(live.tools).toEqual([]);
  });

  it("drops the streamed reply and tool output when the run ends", () => {
    const live = emptyLive();
    applyLiveEvent(live, { t: "run", running: true, compacting: false });
    applyLiveEvent(live, { t: "d", s: "partial" });
    applyLiveEvent(live, { t: "out", id: "t1", from: 0, s: "x" });
    applyLiveEvent(live, { t: "run", running: false, compacting: false });
    expect(live).toMatchObject({ running: false, tools: [] });
    expect(live.msg).toBeUndefined();
  });

  it("keeps only dialogs that wait for an answer, until answered", () => {
    const live = emptyLive();
    applyLiveEvent(live, { t: "ui", request: { kind: "notify", id: "n1", message: "hi", level: "info" } });
    applyLiveEvent(live, { t: "ui", request: { kind: "confirm", id: "q1", title: "Run?", message: "rm -rf build" } });
    expect(live.ui.map((request) => request.id)).toEqual(["q1"]);
    applyLiveEvent(live, { t: "ui_done", id: "q1" });
    expect(live.ui).toEqual([]);
  });
});

describe("changes to a growing text", () => {
  const lines = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `line ${from + i}\n`).join("");
  const cases: Array<[string, string, string]> = [
    ["appending", lines(0, 50), lines(0, 60)],
    ["rewriting the end", `${lines(0, 50)}progress 10%`, `${lines(0, 50)}progress 90%`],
    ["a tail window sliding", lines(0, 2000), lines(30, 2040)],
    ["unrelated text", "abc", "xyz"],
    ["from nothing", "", "hello"],
  ];
  for (const [name, before, after] of cases) {
    it(`round-trips ${name}`, () => {
      expect(applyTextChange(before, textChange(before, after))).toBe(after);
    });
  }

  it("sends only the new lines when the window slides", () => {
    const change = textChange(lines(0, 2000), lines(30, 2040));
    expect(change.s).toBe(lines(2000, 2040));
    expect(change.drop).toBe(lines(0, 30).length);
  });
});

describe("tool calls the model is still writing", () => {
  it("collects their arguments under the streaming reply until it is saved", () => {
    const live = emptyLive();
    applyLiveEvent(live, { t: "msg", at: 1 });
    applyLiveEvent(live, { t: "call", id: "t1", name: "write", ...textChange("", '{"path":"a.ts"}') });
    applyLiveEvent(live, { t: "call", id: "t1", name: "write", ...textChange('{"path":"a.ts"}', '{"path":"a.ts","content":"x"}') });
    expect(live.msg?.calls).toEqual([{ id: "t1", name: "write", args: '{"path":"a.ts","content":"x"}' }]);
    endLiveItem(live, { type: "assistant", id: "a1", at: 2, text: "", tools: [{ id: "t1", name: "write", args: { path: "a.ts", content: "x" } }] });
    expect(live.msg).toBeUndefined();
  });
});
