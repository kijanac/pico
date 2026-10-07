import { dirname, join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import * as FileSystem from "@effect/platform/FileSystem";
import type { PlatformError } from "@effect/platform/Error";
import * as Effect from "effect/Effect";
import type { FsListing } from "@pico/protocol/rpc";

// Map reason onto wire codes the caller turns into RequestError messages.
const readDirError = (error: PlatformError): Error => {
  if (error._tag === "SystemError") {
    if (error.reason === "NotFound") return new Error("not_found");
    if (error.reason === "PermissionDenied") return new Error("forbidden");
  }
  return new Error(`ls_failed: ${error.message}`);
};

// Any folder, as in pi, starting from home.
export const listFs = (
  path?: string,
  opts?: { showHidden?: boolean },
): Effect.Effect<FsListing, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const showHidden = opts?.showHidden ?? false;
    const home = homedir();
    const target = yield* fs.realPath(path ? resolvePath(path) : home).pipe(Effect.mapError(() => new Error("not_found")));

    const names = yield* fs.readDirectory(target).pipe(Effect.mapError(readDirError));

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
