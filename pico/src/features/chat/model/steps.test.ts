import type { LogEntry } from "@pico/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { gatherSteps, groupKeyOf, summarizeSteps } from "./steps";

let at = 0;
beforeEach(() => {
  at = 0;
});
const user = (id: string): LogEntry => ({ kind: "user", id, at: (at += 1000), text: id });
const said = (id: string, stopReason: "toolUse" | "stop" | "aborted" | undefined, text = ""): LogEntry =>
  ({ kind: "assistant", id, at: (at += 1000), text, ...(stopReason ? { stopReason } : { streaming: true }) }) as LogEntry;
const bash = (id: string, status: "ok" | "error" | "running" = "ok"): LogEntry =>
  ({ kind: "tool_call", toolKind: "builtin", tool: "bash", id, at: (at += 1000), status, args: { command: "ls" } }) as LogEntry;
const edit = (id: string, path: string): LogEntry =>
  ({ kind: "tool_call", toolKind: "builtin", tool: "edit", id, at: (at += 1000), status: "ok", args: { path, edits: [] } }) as LogEntry;
const compaction = (id: string): LogEntry => ({ kind: "compaction", id, at: (at += 1000), status: "success", summary: "" }) as LogEntry;

const shape = (entries: LogEntry[]) =>
  gatherSteps(entries).map((segment) =>
    segment.kind === "entry" ? segment.entry.id : { key: segment.key, ids: segment.entries.map((entry) => entry.id), answeredInWords: segment.answeredInWords, durationMs: segment.durationMs },
  );

describe("a turn's steps", () => {
  it("are everything between your message and pi's answer, by pi's stop reasons", () => {
    const turn = [user("u"), said("a1", "toolUse", "Looking."), bash("b1"), compaction("c"), edit("e1", "x.ts"), said("a2", "toolUse"), edit("e2", "x.ts"), said("a3", "stop", "Done.")];
    expect(shape(turn)).toEqual(["u", { key: "steps:u", ids: ["a1", "b1", "c", "e1", "a2", "e2"], answeredInWords: true, durationMs: 7000 }, "a3"]);
    expect(summarizeSteps(turn)).toEqual({ steps: 3, filesChanged: 1, commandsRun: 1, failed: 0 });
  });

  it("stay unanswered, under the same key, while the turn goes on", () => {
    const running = [user("u"), bash("b1"), said("a2", undefined, "Now the")];
    expect(shape(running)).toEqual(["u", { key: "steps:u", ids: ["b1", "a2"], answeredInWords: false, durationMs: undefined }]);
    expect(shape([...running, bash("b2")])[1]).toMatchObject({ key: "steps:u" });
  });

  it("aren't gathered from a reply that called no tools", () => {
    expect(shape([user("u"), said("a1", undefined, "Hi")])).toEqual(["u", "a1"]);
  });

  it("are split by a message sent mid-run, and answered by the turn's answer", () => {
    expect(shape([user("u"), bash("b1"), user("steer"), bash("b2"), said("a", "stop", "Ok.")])).toEqual([
      "u",
      { key: "steps:u", ids: ["b1"], answeredInWords: true, durationMs: 2000 },
      "steer",
      { key: "steps:steer", ids: ["b2"], answeredInWords: true, durationMs: 2000 },
      "a",
    ]);
  });

  it("stay out to see when the answer has no words, or never came", () => {
    const stopped = [user("u"), bash("b1", "error"), said("a1", "aborted")];
    expect(shape(stopped)).toEqual(["u", { key: "steps:u", ids: ["b1"], answeredInWords: false, durationMs: undefined }, "a1"]);
    expect(summarizeSteps(stopped).failed).toBe(1);
    expect(shape([user("u"), bash("b1", "error")])[1]).toMatchObject({ answeredInWords: false });
  });

  it("are found again from any entry in them", () => {
    const turn = [user("u"), said("a1", "toolUse"), bash("b1"), said("a3", "stop", "Done.")];
    expect(groupKeyOf(turn, "a1")).toBe("steps:u");
    expect(groupKeyOf(turn, "b1")).toBe("steps:u");
    expect(groupKeyOf(turn, "a3")).toBeUndefined();
  });
});
