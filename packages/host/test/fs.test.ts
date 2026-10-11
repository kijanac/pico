import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { readTextFile } from "../src/fs.ts";

const read = (path: string, relativeTo?: string) =>
  Effect.runPromise(
    readTextFile(path, relativeTo).pipe(
      Effect.match({ onFailure: (error) => error.message, onSuccess: (file) => file }),
      Effect.provide(NodeFileSystem.layer),
    ),
  );

describe("reading a file the agent linked", () => {
  it("resolves it against the folder it was linked from", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pico-fs-"));
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "a.md"), "# hi");
    expect(await read("docs/a.md", dir)).toMatchObject({ text: "# hi", path: expect.stringMatching(/docs\/a\.md$/) });
    expect(await read("../docs/a.md", join(dir, "docs"))).toMatchObject({ text: "# hi" });
  });

  it("says why it can't show one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pico-fs-"));
    writeFileSync(join(dir, "blob"), Buffer.from([1, 0, 2]));
    writeFileSync(join(dir, "huge.txt"), "x".repeat(1_000_001));
    mkdirSync(join(dir, "locked"));
    writeFileSync(join(dir, "locked", "a.md"), "secret");
    chmodSync(join(dir, "locked"), 0o000);
    expect(await read("missing.md", dir)).toBe("not_found");
    expect(await read(".", dir)).toBe("not_a_file");
    expect(await read("blob", dir)).toBe("not_text");
    expect(await read("huge.txt", dir)).toBe("too_large");
    expect(await read("locked/a.md", dir)).toBe("forbidden");
    chmodSync(join(dir, "locked"), 0o755);
  });
});
