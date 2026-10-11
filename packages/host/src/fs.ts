import { dirname, join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import * as FileSystem from "@effect/platform/FileSystem";
import type { PlatformError } from "@effect/platform/Error";
import * as Effect from "effect/Effect";
import type { FsFile, FsListing } from "@pico/protocol/rpc";

const MAX_FILE_BYTES = 1_000_000;

const wireError = (fallback: string) => (error: PlatformError): Error => {
  if (error._tag === "SystemError") {
    if (error.reason === "NotFound") return new Error("not_found");
    if (error.reason === "PermissionDenied") return new Error("forbidden");
  }
  return new Error(`${fallback}: ${error.message}`);
};

export const listFs = (
  path?: string,
  opts?: { showHidden?: boolean },
): Effect.Effect<FsListing, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const showHidden = opts?.showHidden ?? false;
    const home = homedir();
    const target = yield* fs.realPath(path ? resolvePath(path) : home).pipe(Effect.mapError(() => new Error("not_found")));

    const names = yield* fs.readDirectory(target).pipe(Effect.mapError(wireError("ls_failed")));

    const dirs: Array<{ name: string; hidden: boolean }> = [];
    yield* Effect.forEach(
      names,
      (name) =>
        Effect.gen(function* () {
          if (!showHidden && name.startsWith(".")) return;
          const info = yield* fs.stat(join(target, name));
          if (info.type === "Directory") dirs.push({ name, hidden: name.startsWith(".") });
        }).pipe(Effect.ignore),
      { discard: true },
    );
    dirs.sort((a, b) => a.name.localeCompare(b.name));

    const parent = dirname(target);
    return { path: target, parent: parent === target ? null : parent, home, entries: dirs };
  });

export const readTextFile = (path: string, relativeTo?: string): Effect.Effect<FsFile, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const target = yield* fs
      .realPath(resolvePath(relativeTo ?? homedir(), path.replace(/^~(?=\/|$)/, homedir())))
      .pipe(Effect.mapError(wireError("read_failed")));
    const info = yield* fs.stat(target).pipe(Effect.mapError(wireError("read_failed")));
    if (info.type !== "File") return yield* Effect.fail(new Error("not_a_file"));
    if (Number(info.size) > MAX_FILE_BYTES) return yield* Effect.fail(new Error("too_large"));
    const bytes = yield* fs.readFile(target).pipe(Effect.mapError(wireError("read_failed")));
    if (bytes.subarray(0, 8192).includes(0)) return yield* Effect.fail(new Error("not_text"));
    return { path: target, text: new TextDecoder().decode(bytes) };
  });
