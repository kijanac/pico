import { describe, expect, it } from "vitest";
import { diffRuns, runLineNumbers } from "./diff-runs";

describe("whole-file diff runs", () => {
  it("retains complete context without expanding unchanged files into one record per line", () => {
    const before = `${"context\n".repeat(40_000)}before\nend\n`;
    const after = `${"context\n".repeat(40_000)}after\nend\n`;
    const runs = diffRuns(before, after);
    expect(runs).toHaveLength(4);
    expect(runs[0]).toMatchObject({ kind: "context", count: 40_000, oldLine: 1, newLine: 1 });
    expect(runs.filter((run) => run.kind !== "add").map((run) => run.text).join("")).toBe(before);
    expect(runs.filter((run) => run.kind !== "remove").map((run) => run.text).join("")).toBe(after);
  });

  it("keeps line numbers aligned across additions and removals", () => {
    const runs = diffRuns("head\nold\ntail\n", "head\nnew\nextra\ntail\n");
    expect(runs.map(({ kind, oldLine, newLine, count }) => ({ kind, oldLine, newLine, count }))).toEqual([
      { kind: "context", oldLine: 1, newLine: 1, count: 1 },
      { kind: "remove", oldLine: 2, newLine: null, count: 1 },
      { kind: "add", oldLine: null, newLine: 2, count: 2 },
      { kind: "context", oldLine: 3, newLine: 4, count: 1 },
    ]);
    expect(runs.map(runLineNumbers)).toEqual(["1", "2", "2\n3", "4"]);
  });

  it("preserves CRLF, blank lines and a final unterminated line", () => {
    const before = "\r\n\r\nbefore\r\nlast";
    const after = "\r\n\r\nafter\r\nlast";
    const runs = diffRuns(before, after);
    expect(runs[0]).toMatchObject({ text: "\r\n\r\n", count: 2 });
    expect(runs.at(-1)).toMatchObject({ text: "last", count: 1, oldLine: 4, newLine: 4 });
    expect(runs.filter((run) => run.kind !== "add").map((run) => run.text).join("")).toBe(before);
    expect(runs.filter((run) => run.kind !== "remove").map((run) => run.text).join("")).toBe(after);
  });

  it("does not invent a row for an empty file", () => {
    expect(diffRuns("", "")).toEqual([]);
    expect(diffRuns("", "\n")).toEqual([{ kind: "add", oldLine: null, newLine: 1, count: 1, text: "\n" }]);
    expect(diffRuns("last", "")).toEqual([{ kind: "remove", oldLine: 1, newLine: null, count: 1, text: "last" }]);
  });
});
