import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { createEditToolDefinition, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { FileChangeRef } from "@pico/protocol";
import * as Effect from "effect/Effect";
import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { saveFileChange } from "./file-changes.ts";
import { MAX_TEXT_BYTES } from "./fs.ts";

export function createReviewedEditTool(cwd: string, directory?: string): ReturnType<typeof createEditToolDefinition> {
  const original = createEditToolDefinition(cwd);
  return {
    ...original,
    execute: async (...args: Parameters<typeof original.execute>) => {
      let before: Buffer | undefined;
      let written: { path: string; after: string } | undefined;
      const delegated = createEditToolDefinition(cwd, {
        operations: {
          access: (path) => access(path, constants.R_OK | constants.W_OK),
          readFile: async (path) => {
            const bytes = await readFile(path);
            before = bytes;
            return bytes;
          },
          writeFile: async (path, after) => {
            await writeFile(path, after, "utf-8");
            written = { path, after };
          },
        },
      });
      const result = await delegated.execute(...args);
      if (!before || !written || !result.details) return result;
      if (before.byteLength > MAX_TEXT_BYTES || Buffer.byteLength(written.after) > MAX_TEXT_BYTES) {
        const picoFileChange: FileChangeRef = { kind: "unavailable", path: written.path, reason: "too_large" };
        return { ...result, details: { ...result.details, picoFileChange } };
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(before);
      } catch {
        const picoFileChange: FileChangeRef = { kind: "unavailable", path: written.path, reason: "not_text" };
        return { ...result, details: { ...result.details, picoFileChange } };
      }
      const after = Buffer.from(written.after, "utf-8").toString("utf-8");
      const picoFileChange = await Effect.runPromise(saveFileChange({ path: written.path, before: text, after }, directory).pipe(Effect.provide(NodeFileSystem.layer)));
      return { ...result, details: { ...result.details, picoFileChange } };
    },
  };
}

export const editReviewExtension: ExtensionFactory = (pi) => {
  pi.registerTool(createReviewedEditTool(process.cwd()));
};
