import { describe, expect, it } from "vitest";
import * as smd from "streaming-markdown";
import { createMarkdownStream } from "./markdown-stream";

function renderer() {
  let output = "";
  let resets = 0;
  let ends = 0;
  let parser: ReturnType<typeof smd.parser>;
  const sync = createMarkdownStream({
    reset() {
      output = "";
      resets += 1;
      parser = smd.parser({
        data: null,
        add_token() {},
        end_token() {},
        set_attr() {},
        add_text(_, text) { output += text; },
      });
    },
    write(text) { smd.parser_write(parser, text); },
    end() { smd.parser_end(parser); ends += 1; },
  });
  return { sync, get output() { return output; }, get resets() { return resets; }, get ends() { return ends; } };
}

describe("Markdown rendering across streamed and saved answers", () => {
  it("appends chunks without re-parsing earlier content", () => {
    const view = renderer();
    const text = "The answer after tools is complete. 🧠";
    for (let end = 1; end <= text.length; end++) view.sync(text.slice(0, end), false);
    view.sync(text, true);
    view.sync(text, true);
    expect(view.output).toBe(text);
    expect(view.resets).toBe(1);
    expect(view.ends).toBe(1);
  });

  it.each([
    ["old answer", "new answer"],
    ["Before tools: checking the files.", "After tools: the complete answer is different and longer. Final sentence."],
    ["a longer old answer", "short"],
  ])("replaces %s rather than keeping its prefix", (before, after) => {
    const view = renderer();
    view.sync(before, false);
    view.sync(after, true);
    expect(view.output).toBe(after);
    expect(view.resets).toBe(2);
  });

  it("reopens a finalized parser when new text arrives", () => {
    const view = renderer();
    view.sync("Complete.", true);
    view.sync("Complete. More text.", false);
    view.sync("Complete. More text.", true);
    expect(view.output).toBe("Complete. More text.");
    expect(view.resets).toBe(2);
    expect(view.ends).toBe(2);
  });

  it("replaces finalized text and flushes the new ending", () => {
    const view = renderer();
    view.sync("Before tools: checking the files.", true);
    view.sync("After tools: the complete answer is different and longer. Final sentence.", true);
    expect(view.output).toBe("After tools: the complete answer is different and longer. Final sentence.");
    expect(view.ends).toBe(2);
  });
});
