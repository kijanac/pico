import { describe, expect, it } from "vitest";
import type { ToolCallMessage } from "@pico/protocol";
import { missingEditContext, toolFile } from "./tool-file";

const edit: ToolCallMessage = { kind: "tool_call", toolKind: "builtin", tool: "edit", id: "edit", at: 1, status: "ok", args: { path: "source.ts", edits: [{ oldText: "old", newText: "new" }] } };

describe("tool file entry points", () => {
  it("opens read and write paths as current files without guessing from tool output", () => {
    expect(toolFile({ ...edit, tool: "read", args: { path: "read.ts", offset: 10, limit: 5 } })).toEqual({ path: "read.ts" });
    expect(toolFile({ ...edit, tool: "write", args: { path: "write.ts", content: "old saved content" } })).toEqual({ path: "write.ts" });
    expect(toolFile({ ...edit, tool: "bash", args: { command: "cat source.ts" } })).toBeNull();
    expect(toolFile({ ...edit, toolKind: "custom", tool: "screenshot", args: { path: "maybe.png" } })).toBeNull();
  });

  it("only uses parsed snapshot metadata on successful edits", () => {
    const ref = { kind: "saved", path: "/workspace/source.ts", id: "a".repeat(64) };
    expect(toolFile({ ...edit, details: { picoFileChange: ref, diff: "..." } })).toEqual({ path: ref.path, edit: { ref, args: edit.args } });
    expect(toolFile({ ...edit, status: "error", details: { picoFileChange: ref } })).toEqual({ path: "source.ts" });
    expect(toolFile({ ...edit, status: "running" })).toBeNull();
    expect(toolFile({ ...edit, status: "pending" })).toBeNull();
  });

  it("treats old or malformed metadata as missing history rather than rebuilding from today's file", () => {
    const old = toolFile(edit);
    expect(old).toEqual({ path: "source.ts", edit: { ref: null, args: edit.args } });
    expect(toolFile({ ...edit, details: { picoFileChange: { kind: "saved", path: "/wrong", id: "../../secret" } } })).toEqual(old);
    expect(missingEditContext(old!.edit!)).toContain("no saved full-file preview");
  });

  it("keeps a truthful unavailable reason and the actual resolved path", () => {
    const ref = { kind: "unavailable", path: "/workspace/source.ts", reason: "not_saved" };
    const request = toolFile({ ...edit, details: { picoFileChange: ref } });
    expect(request?.path).toBe(ref.path);
    expect(missingEditContext(request!.edit!)).toContain("edit succeeded");
  });
});
