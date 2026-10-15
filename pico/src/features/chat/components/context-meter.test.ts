import { describe, expect, it } from "vitest";
import { contextMeter } from "./context-meter";

describe("context ring", () => {
  it("uses current context percentage, keeping the arc precise and its text rounded", () => {
    expect(contextMeter(42.4)).toEqual({ kind: "known", percent: 42, fill: 42.4 });
    expect(contextMeter(0)).toEqual({ kind: "known", percent: 0, fill: 0 });
    expect(contextMeter(100)).toEqual({ kind: "known", percent: 100, fill: 100 });
  });

  it("bounds the drawing without hiding a reported over-capacity context", () => {
    expect(contextMeter(112)).toEqual({ kind: "known", percent: 112, fill: 100 });
  });

  it("does not draw unknown or invalid usage as an empty context", () => {
    for (const value of [null, undefined, NaN, Infinity, -1]) expect(contextMeter(value)).toEqual({ kind: "unknown" });
  });
});
