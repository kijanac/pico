import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Effect } from "effect";
import type { FsListing } from "@pico/protocol/rpc";
import { WORKSPACES_DIR } from "./config.ts";

const workspaceRoot = () => resolvePath(WORKSPACES_DIR);

const isInsideRoot = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

// Map reason onto wire codes the caller turns into RequestError messages.
const readDirError = (error: PlatformError): Error => {
  if (error._tag === "SystemError") {
    if (error.reason === "NotFound") return new Error("not_found");
    if (error.reason === "PermissionDenied") return new Error("forbidden");
  }
  return new Error(`ls_failed: ${error.message}`);
};

export const listFs = (
  path?: string,
  opts?: { showHidden?: boolean },
): Effect.Effect<FsListing, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const showHidden = opts?.showHidden ?? false;
    const notFound = () => new Error("not_found");

    const root = yield* fs.realPath(workspaceRoot()).pipe(Effect.mapError(notFound));
    const target = yield* fs.realPath(path ? resolvePath(path) : root).pipe(Effect.mapError(notFound));

    if (!isInsideRoot(root, target)) {
      return yield* Effect.fail(new Error("outside_workspace_root"));
    }

    const names = yield* fs.readDirectory(target).pipe(Effect.mapError(readDirError));

    const dirs: Array<{ name: string; hidden: boolean }> = [];
    yield* Effect.forEach(
      names,
      (name) =>
        Effect.gen(function* () {
          if (!showHidden && name.startsWith(".")) return;
          const childReal = yield* fs.realPath(join(target, name));
          if (!isInsideRoot(root, childReal)) return;
          const info = yield* fs.stat(childReal);
          if (info.type === "Directory") dirs.push({ name, hidden: name.startsWith(".") });
        }).pipe(Effect.ignore),
      { discard: true },
    );
    dirs.sort((a, b) => a.name.localeCompare(b.name));

    const parent = (() => {
      if (target === root) return null;
      const p = dirname(target);
      return isInsideRoot(root, p) ? p : null;
    })();

    return { path: target, parent, home: root, entries: dirs };
  });
