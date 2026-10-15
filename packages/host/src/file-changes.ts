import * as FileSystem from "@effect/platform/FileSystem";
import { FileChange, FileChangeId, type FileChangeRef } from "@pico/protocol";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { HOST_DATA_DIR } from "./config.ts";
import { MAX_TEXT_BYTES } from "./fs.ts";

const CHANGE_DIRECTORY = join(HOST_DATA_DIR, "file-changes");
export const MAX_FILE_CHANGE_BYTES = MAX_TEXT_BYTES * 2;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

export const saveFileChange = (change: FileChange, directory = CHANGE_DIRECTORY): Effect.Effect<FileChangeRef, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const unavailable = (reason: "too_large" | "not_text" | "not_saved"): FileChangeRef => ({ kind: "unavailable", path: change.path, reason });
    if (change.before.includes("\0") || change.after.includes("\0")) return unavailable("not_text");
    if (Buffer.byteLength(change.before) > MAX_TEXT_BYTES || Buffer.byteLength(change.after) > MAX_TEXT_BYTES) return unavailable("too_large");
    const text = JSON.stringify(change);
    if (Buffer.byteLength(text) > MAX_FILE_CHANGE_BYTES) return unavailable("too_large");
    const id = digest(text);
    const fs = yield* FileSystem.FileSystem;
    return yield* Effect.scoped(Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
      const temporary = yield* fs.makeTempFileScoped({ directory, prefix: ".change-" });
      yield* fs.chmod(temporary, 0o600);
      yield* fs.writeFileString(temporary, text);
      yield* fs.rename(temporary, join(directory, id));
      return { kind: "saved", id, path: change.path } as const;
    })).pipe(Effect.catchAll(() => Effect.succeed(unavailable("not_saved"))));
  });

export const readFileChange = (id: string, directory = CHANGE_DIRECTORY) => Effect.gen(function* () {
  const parsed = yield* Schema.decodeUnknown(FileChangeId)(id);
  const fs = yield* FileSystem.FileSystem;
  const path = join(directory, parsed);
  const stat = yield* fs.stat(path);
  if (stat.type !== "File" || stat.size > BigInt(MAX_FILE_CHANGE_BYTES)) return yield* Effect.fail(new Error("invalid saved edit"));
  const text = yield* fs.readFileString(path);
  if (digest(text) !== parsed) return yield* Effect.fail(new Error("saved edit is incomplete"));
  return yield* Schema.decodeUnknown(Schema.parseJson(FileChange))(text);
});
