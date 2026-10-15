import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { createAgentSessionFromServices, createAgentSessionServices, createEditToolDefinition, ModelRuntime, SessionManager, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { FileChangeDetails, type EditToolArgs } from "@pico/protocol";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let changes: typeof import("../src/file-changes.ts");
let edits: typeof import("../src/edit-review.ts");
const dirs: string[] = [];
const tempDir = () => {
  const directory = mkdtempSync(join(tmpdir(), "pico-file-change-"));
  dirs.push(directory);
  return directory;
};
const refFrom = (details: unknown) => Schema.decodeUnknownSync(FileChangeDetails)(details).picoFileChange;

beforeAll(async () => {
  vi.stubEnv("PICO_HOST_DB", join(tempDir(), "host.db"));
  vi.stubEnv("PICO_HOST_INSECURE_NO_AUTH", "1");
  changes = await import("../src/file-changes.ts");
  edits = await import("../src/edit-review.ts");
});
afterAll(() => {
  dirs.forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  vi.unstubAllEnvs();
});

function fixture(before: string | Buffer, storage?: string) {
  const directory = tempDir();
  const path = join(directory, "source.ts");
  const snapshots = storage ?? join(directory, "snapshots");
  writeFileSync(path, before);
  const tool = edits.createReviewedEditTool(directory, snapshots);
  const context = { cwd: directory } as Parameters<typeof tool.execute>[4];
  const run = (replacements: EditToolArgs["edits"], signal?: AbortSignal) => tool.execute("call", { path: "source.ts", edits: [...replacements] }, signal, undefined, context);
  const read = (id: string) => Effect.runPromise(changes.readFileChange(id, snapshots).pipe(Effect.provide(NodeFileSystem.layer)));
  return { directory, path, snapshots, run, read };
}

async function sessionFixture(override: boolean) {
  const directory = tempDir();
  writeFileSync(join(directory, "source.ts"), "before\n");
  const faux = createFauxCore({ provider: "faux", models: [{ id: "faux-1" }], tokensPerSecond: 10000 });
  const runtime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: null });
  runtime.registerProvider("faux", { api: faux.api, baseUrl: "http://faux.invalid", apiKey: "faux", streamSimple: faux.streamSimple, models: faux.models });
  const extensionFactories: InlineExtension[] = [{
    name: "pico-file-review", builtin: true, replaceable: true,
    factory: (pi) => { pi.registerTool(edits.createReviewedEditTool(directory, join(directory, "snapshots"))); },
  }];
  if (override) extensionFactories.push((pi) => {
    pi.registerTool({ ...createEditToolDefinition(directory), execute: async () => ({ content: [{ type: "text", text: "external edit implementation" }], details: undefined }) });
  });
  const services = await createAgentSessionServices({ cwd: directory, agentDir: join(directory, "agent"), modelRuntime: runtime, resourceLoaderOptions: { extensionFactories } });
  const manager = SessionManager.create(directory, join(directory, "sessions"));
  const { session } = await createAgentSessionFromServices({ services, sessionManager: manager, model: runtime.getAvailableSnapshot().find((model) => model.provider === "faux"), tools: ["edit"] });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("edit", { path: "source.ts", edits: [{ oldText: "before", newText: "after" }] })], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  try {
    await session.prompt("edit the fixture");
    const saved = SessionManager.open(manager.getSessionFile()!).getEntries().find((entry) => entry.type === "message" && entry.message.role === "toolResult");
    if (!saved || saved.type !== "message" || saved.message.role !== "toolResult") throw new Error("missing persisted result");
    return { result: saved.message, directory };
  } finally { session.dispose(); }
}

describe("full-file edit snapshots", () => {
  it("loads through the real SDK and persists the reference in Pi's own session result", async () => {
    const { result, directory } = await sessionFixture(false);
    const ref = refFrom(result.details);
    expect(result.isError).toBe(false);
    if (ref.kind !== "saved") throw new Error("missing snapshot");
    expect(readFileSync(join(directory, "source.ts"), "utf8")).toBe("after\n");
    expect(JSON.parse(readFileSync(join(directory, "snapshots", ref.id), "utf8"))).toMatchObject({ before: "before\n", after: "after\n" });
    expect(result.details).not.toHaveProperty("before");
    expect(result.details).not.toHaveProperty("after");
  });

  it("yields to another extension's edit implementation instead of hijacking remote/custom file operations", async () => {
    const { result, directory } = await sessionFixture(true);
    expect(result.content[0]).toMatchObject({ text: "external edit implementation" });
    expect(result.details).toBeUndefined();
    expect(readFileSync(join(directory, "source.ts"), "utf8")).toBe("before\n");
  });

  it("captures the exact full before and after images, including distant unchanged lines and multiple replacements", async () => {
    const before = "first unchanged line\nconst a = 1;\n" + "unchanged context\n".repeat(30) + "const b = 2;\nlast unchanged line\n";
    const f = fixture(before);
    const result = await f.run([{ oldText: "const a = 1;", newText: "const a = 3;" }, { oldText: "const b = 2;", newText: "" }]);
    const ref = refFrom(result.details);
    expect(ref.kind).toBe("saved");
    if (ref.kind !== "saved") throw new Error("missing snapshot");
    const after = before.replace("const a = 1;", "const a = 3;").replace("const b = 2;", "");
    expect(await f.read(ref.id)).toEqual({ path: f.path, before, after });
    writeFileSync(f.path, "unrelated later version");
    rmSync(f.path);
    expect((await f.read(ref.id)).after).toBe(after);
    expect(readdirSync(f.snapshots)).toEqual([ref.id]);
    expect(statSync(join(f.snapshots, ref.id)).mode & 0o777).toBe(0o600);
    expect(statSync(f.snapshots).mode & 0o777).toBe(0o700);
  });

  it("delegates Pi's fuzzy matching and retains its BOM and CRLF handling", async () => {
    const f = fixture('\ufeffconst title = “old”;\r\nkeep\r\n');
    const result = await f.run([{ oldText: 'const title = "old";', newText: 'const title = "new";' }]);
    const ref = refFrom(result.details);
    if (ref.kind !== "saved") throw new Error("missing snapshot");
    expect(await f.read(ref.id)).toEqual({ path: f.path, before: '\ufeffconst title = “old”;\r\nkeep\r\n', after: '\ufeffconst title = "new";\r\nkeep\r\n' });
    expect(readFileSync(f.path, "utf8")).toBe('\ufeffconst title = "new";\r\nkeep\r\n');
    expect(result.details).toHaveProperty("patch");
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Successfully replaced") });
  });

  it("records the UTF-8 bytes actually written when replacement text contains a lone surrogate", async () => {
    const f = fixture("before\n");
    const ref = refFrom((await f.run([{ oldText: "before", newText: "\ud800" }])).details);
    if (ref.kind !== "saved") throw new Error("missing snapshot");
    expect((await f.read(ref.id)).after).toBe(readFileSync(f.path, "utf8"));
    expect((await f.read(ref.id)).after).toBe("\ufffd\n");
  });

  it("keeps concurrent calls' captured versions separate under Pi's mutation queue", async () => {
    const f = fixture("version one\nkeep\n");
    const results = await Promise.all([
      f.run([{ oldText: "version one", newText: "version two" }]),
      f.run([{ oldText: "version two", newText: "version three" }]),
    ]);
    const refs = results.map((result) => refFrom(result.details));
    if (refs[0].kind !== "saved" || refs[1].kind !== "saved") throw new Error("missing snapshot");
    const first = await f.read(refs[0].id), second = await f.read(refs[1].id);
    expect(first.before).toBe("version one\nkeep\n");
    expect(first.after).toBe(second.before);
    expect(second.after).toBe("version three\nkeep\n");
  });

  it("leaves failed and pre-aborted edits unchanged without inventing a snapshot", async () => {
    const f = fixture("actual file\n");
    await expect(f.run([{ oldText: "missing", newText: "new" }])).rejects.toThrow();
    const abort = new AbortController(); abort.abort();
    await expect(f.run([{ oldText: "actual", newText: "new" }], abort.signal)).rejects.toThrow("aborted");
    expect(readFileSync(f.path, "utf8")).toBe("actual file\n");
    expect(readdirSync(f.directory)).toEqual(["source.ts"]);
  });

  it("does not turn a successful edit into a failure if preview storage fails", async () => {
    const unavailable = join(tempDir(), "not-a-directory"); writeFileSync(unavailable, "file");
    const f = fixture("before\n", unavailable);
    const result = await f.run([{ oldText: "before", newText: "after" }]);
    expect(refFrom(result.details)).toEqual({ kind: "unavailable", path: f.path, reason: "not_saved" });
    expect(readFileSync(f.path, "utf8")).toBe("after\n");
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Successfully replaced") });
  });

  it("marks oversized and non-UTF8 originals unavailable without changing Pi's edit outcome", async () => {
    const f = fixture("before\n" + "x".repeat(1_000_000));
    expect(refFrom((await f.run([{ oldText: "before", newText: "after" }])).details)).toMatchObject({ kind: "unavailable", reason: "too_large" });
    const binary = fixture(Buffer.concat([Buffer.from([0xff]), Buffer.from("before\n")]));
    expect(refFrom((await binary.run([{ oldText: "before", newText: "after" }])).details)).toMatchObject({ kind: "unavailable", reason: "not_text" });
  });

  it("checks the combined serialized budget and rejects NUL-containing snapshots", async () => {
    const save = (before: string, after: string) => Effect.runPromise(changes.saveFileChange({ path: "/fixture", before, after }, tempDir()).pipe(Effect.provide(NodeFileSystem.layer)));
    expect(await save("\n".repeat(600_000), "\n".repeat(600_000))).toMatchObject({ kind: "unavailable", reason: "too_large" });
    expect(await save("a\0b", "ab")).toMatchObject({ kind: "unavailable", reason: "not_text" });
  });

  it("rejects traversal, missing and corrupt revisions instead of substituting current content", async () => {
    const f = fixture("before\n");
    const ref = refFrom((await f.run([{ oldText: "before", newText: "after" }])).details);
    if (ref.kind !== "saved") throw new Error("missing snapshot");
    await expect(f.read("../source.ts")).rejects.toThrow();
    await expect(f.read("0".repeat(64))).rejects.toThrow();
    writeFileSync(join(f.snapshots, ref.id), '{"path":"wrong","before":"wrong","after":"wrong"}');
    await expect(f.read(ref.id)).rejects.toThrow("incomplete");
  });
});
