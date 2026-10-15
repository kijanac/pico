import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vitest";
import { binaryFormat, listFs, MAX_IMAGE_BYTES, readFile } from "../src/fs.ts";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "pico-fs-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const read = (path: string, relativeTo?: string) =>
  Effect.runPromise(
    readFile(path, relativeTo).pipe(
      Effect.match({ onFailure: (error) => error.message, onSuccess: (file) => file }),
      Effect.provide(NodeFileSystem.layer),
    ),
  );

describe("reading a file the agent linked", () => {
  it("resolves it against the folder it was linked from", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "a.md"), "# hi");
    expect(await read("docs/a.md", dir)).toMatchObject({ text: "# hi", path: expect.stringMatching(/docs\/a\.md$/) });
    expect(await read("../docs/a.md", join(dir, "docs"))).toMatchObject({ text: "# hi" });
  });

  it("recognizes PDFs by their bytes without returning them as text", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "report"), "%PDF-1.7\n" + "x".repeat(1_000_001));
    expect(await read("report", dir)).toEqual({ kind: "pdf", path: join(dir, "report") });
    writeFileSync(join(dir, "not-really.pdf"), "ordinary text");
    expect(await read("not-really.pdf", dir)).toMatchObject({ kind: "text", text: "ordinary text" });
  });

  it("rejects binary content even without an early NUL", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "invalid"), Buffer.from([0xff, 0xfe, 0x80]));
    writeFileSync(join(dir, "late-null"), "x".repeat(8192) + "\0");
    expect(await read("invalid", dir)).toBe("not_text");
    expect(await read("late-null", dir)).toBe("not_text");
  });

  it("says why it can't show one", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "blob"), Buffer.from([1, 0, 2]));
    writeFileSync(join(dir, "huge.txt"), "x".repeat(1_000_001));
    mkdirSync(join(dir, "locked"));
    writeFileSync(join(dir, "locked", "a.md"), "secret");
    expect(await read("missing.md", dir)).toBe("not_found");
    expect(await read(".", dir)).toBe("not_a_file");
    expect(await read("blob", dir)).toBe("not_text");
    expect(await read("huge.txt", dir)).toBe("too_large");
    chmodSync(join(dir, "locked"), 0o000);
    try {
      expect(await read("locked/a.md", dir)).toBe("forbidden");
    } finally {
      chmodSync(join(dir, "locked"), 0o755);
    }
  });

  it("recognizes raster images by bytes rather than filename", async () => {
    const dir = tempDir();
    const headers = [
      ["image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
      ["image/jpeg", Buffer.from([255, 216, 255, 224])],
      ["image/gif", Buffer.from("GIF89a")],
      ["image/webp", Buffer.from([82, 73, 70, 70, 195, 169, 0, 0, 87, 69, 66, 80])],
      ["image/avif", Buffer.from([0, 0, 0, 32, 102, 116, 121, 112, 97, 118, 105, 102, 0, 0, 0, 0])],
    ] as const;
    for (const [mediaType, header] of headers) {
      const path = join(dir, mediaType.split("/")[1]);
      writeFileSync(path, header);
      expect(await read(path)).toEqual({ kind: "image", path, mediaType });
    }
    writeFileSync(join(dir, "fake.png"), "ordinary text");
    expect(await read("fake.png", dir)).toMatchObject({ kind: "text" });
    expect(binaryFormat(Buffer.from("<svg onload='alert(1)'>"))).toBeNull();
    const large = join(dir, "large.png");
    writeFileSync(large, headers[0][1]);
    truncateSync(large, MAX_IMAGE_BYTES + 1);
    expect(await read(large)).toBe("too_large");
  });
});

describe("directory browsing", () => {
  it("keeps the directory picker directory-only and optionally lists files and hidden entries", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "folder")); mkdirSync(join(dir, ".hidden-folder"));
    writeFileSync(join(dir, "file.txt"), "abc"); writeFileSync(join(dir, ".secret"), "secret");
    symlinkSync("missing", join(dir, "broken-link"));
    const list = (options = {}) => Effect.runPromise(listFs(dir, options).pipe(Effect.provide(NodeFileSystem.layer)));
    expect((await list()).entries).toEqual([{ name: "folder", hidden: false, kind: "directory", size: null }]);
    const full = await list({ files: true, showHidden: true });
    expect(full.path).toBe(dir);
    expect(full.entries.map((entry) => entry.name)).toEqual([".hidden-folder", "folder", ".secret", "broken-link", "file.txt"]);
    expect(full.entries.find((entry) => entry.name === "file.txt")).toMatchObject({ kind: "file", size: 3 });
    expect(full.entries.find((entry) => entry.name === "broken-link")).toMatchObject({ kind: "other", size: null });
  });

  it("returns canonical paths for symlinked folders and useful missing-path errors", async () => {
    const dir = tempDir(); mkdirSync(join(dir, "target")); symlinkSync("target", join(dir, "alias"));
    const listing = await Effect.runPromise(listFs(join(dir, "alias")).pipe(Effect.provide(NodeFileSystem.layer)));
    expect(listing.path).toBe(join(dir, "target")); expect(listing.parent).toBe(dir);
    const missing = await Effect.runPromise(listFs(join(dir, "missing")).pipe(Effect.match({ onSuccess: () => "unexpected", onFailure: (error) => error.message }), Effect.provide(NodeFileSystem.layer)));
    expect(missing).toBe("not_found");
  });
});
