import { describe, expect, it } from "vitest";
import { highlightLines } from "./highlighter";

// Colouring runs a slice of lines at a time. Something that spans a slice
// boundary, like a block comment, must colour as if the block were done at once.
// The first slice is 20 lines, so this comment always spans a boundary.
describe("highlighting in slices", () => {
  const code = [
    ...Array(10).fill("const a = 1;"),
    "/* a comment that starts in the first slice",
    ...Array(300).fill("still the comment"),
    "*/",
    "const b = 2;",
  ].join("\n");

  it("carries the grammar state across slice boundaries", async () => {
    const lines = await highlightLines(code, "ts");
    expect(lines).toHaveLength(313);
    // Every line inside the comment colours alike, wherever slices start.
    for (let line = 12; line <= 310; line++) expect(lines![line]).toBe(lines![11]);
    // After the comment closes, code colours as code again.
    expect(lines![312]!.split("</span>")[0]).toBe(lines![0]!.split("</span>")[0]);
  });

  it("stops when aborted", async () => {
    const abort = new AbortController();
    const pending = highlightLines(code, "ts", abort.signal);
    abort.abort();
    expect(await pending).toBeNull();
  });
});
