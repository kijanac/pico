import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { followFile } from "../src/transcript.ts";

const line = (id: string) =>
  `${JSON.stringify({ type: "message", id, parentId: null, timestamp: new Date().toISOString(), message: { role: "user", content: id, timestamp: 0 } })}\n`;

const tempFile = () => join(mkdtempSync(join(tmpdir(), "pico-transcript-")), "session.jsonl");

describe("following pi's session file", () => {
  it("reads each entry once, whole, even when its line is read half-written or the file is rewritten", () => {
    const file = tempFile();
    writeFileSync(file, line("a"));
    const transcript = followFile(file, [], 0, { known: () => undefined, changed: () => {} });
    const ids = () => transcript.read().map((entry) => entry.id);
    expect(ids()).toEqual(["a"]);
    const b = line("b");
    appendFileSync(file, b.slice(0, 20));
    expect(ids()).toEqual([]);
    appendFileSync(file, b.slice(20) + line("c"));
    expect(ids()).toEqual(["b", "c"]);
    // pi rewrites a file it upgrades.
    writeFileSync(file, line("a") + line("d"));
    expect(ids()).toEqual(["d"]);
    transcript.close();
  });

  it("starts at the line its size fell inside, which another pi was writing", () => {
    const file = tempFile();
    writeFileSync(file, line("a") + line("b"));
    const transcript = followFile(file, [], line("a").length + 10, { known: () => undefined, changed: () => {} });
    expect(transcript.read().map((entry) => entry.id)).toEqual(["b"]);
    transcript.close();
  });

  // macOS's kqueue reports nothing saved while a change is being handled.
  it("misses nothing another process saves while a change is being handled", async () => {
    const file = tempFile();
    writeFileSync(file, "");
    const seen: string[] = [];
    const transcript = followFile(file, [], 0, {
      known: () => undefined,
      changed: () => {
        seen.push(...transcript.read().map((entry) => entry.id));
        // Handling it takes a while; the second line is saved meanwhile.
        for (const start = Date.now(); Date.now() - start < 30; );
      },
    });
    transcript.read();
    const script = `const fs = require("fs");
      fs.appendFileSync(${JSON.stringify(file)}, ${JSON.stringify(line("one"))});
      for (const start = Date.now(); Date.now() - start < 10; );
      fs.appendFileSync(${JSON.stringify(file)}, ${JSON.stringify(line("two"))});`;
    await new Promise((resolve) => spawn(process.execPath, ["-e", script]).on("exit", resolve));
    await vi.waitFor(() => expect(seen).toEqual(["one", "two"]), { timeout: 2_000 });
    transcript.close();
  });
});
