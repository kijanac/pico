import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  backgroundCompatibility,
  EMBEDDED_PI_VERSION,
  parsePiSessionBinding,
} from "../src/pi-compatibility.ts";

const writeSession = (header: Record<string, unknown>): string => {
  const dir = mkdtempSync(join(tmpdir(), "pico-pi-compat-"));
  const file = join(dir, "session.jsonl");
  writeFileSync(file, `${JSON.stringify(header)}\n`);
  return file;
};

describe("Pi background compatibility", () => {
  it("accepts the embedded Pi minor and rejects an untested minor", () => {
    expect(backgroundCompatibility(EMBEDDED_PI_VERSION)).toEqual({ compatible: true });
    const [major, minor] = EMBEDDED_PI_VERSION.split(".").map(Number);
    expect(backgroundCompatibility(`${major}.${minor + 1}.0`)).toMatchObject({ compatible: false });
    expect(backgroundCompatibility(undefined)).toMatchObject({ compatible: false });
  });

  it("parses a matching persisted session into a trusted binding", async () => {
    const file = writeSession({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: "runtime-session",
    });
    await expect(parsePiSessionBinding(file, "runtime-session")).resolves.toEqual({
      runtimeSessionId: "runtime-session",
      runtimeSessionFile: file,
      sessionFormatVersion: CURRENT_SESSION_VERSION,
    });
  });

  it("rejects a JSONL whose identity does not match the handoff", async () => {
    const file = writeSession({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: "other-session",
    });
    await expect(parsePiSessionBinding(file, "runtime-session")).rejects.toMatchObject({
      message: "Attached session identity does not match its Pi JSONL",
    });
  });
});
