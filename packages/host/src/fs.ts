import { dirname, join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import * as FileSystem from "@effect/platform/FileSystem";
import type { PlatformError } from "@effect/platform/Error";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { FsFile, FsListing, ImageMediaType } from "@pico/protocol";

export const MAX_TEXT_BYTES = 1_000_000;
export const MAX_IMAGE_BYTES = 20_000_000;
const FILE_SIGNATURE_BYTES = 16;

const wireError = (fallback: string) => (error: PlatformError): Error => {
  if (error._tag === "SystemError") {
    if (error.reason === "NotFound") return new Error("not_found");
    if (error.reason === "PermissionDenied") return new Error("forbidden");
  }
  return new Error(`${fallback}: ${error.message}`);
};

const userPath = (path: string, relativeTo = homedir()) => resolvePath(relativeTo, path.replace(/^~(?=\/|$)/, homedir()));

type BinaryFormat = { kind: "pdf"; contentType: "application/pdf" } | { kind: "image"; contentType: ImageMediaType };
export function binaryFormat(header: Uint8Array): BinaryFormat | null {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => header[index] === byte);
  const text = new TextDecoder("latin1").decode(header);
  if (text.startsWith("%PDF-")) return { kind: "pdf", contentType: "application/pdf" };
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return { kind: "image", contentType: "image/png" };
  if (starts(255, 216, 255)) return { kind: "image", contentType: "image/jpeg" };
  if (text.startsWith("GIF87a") || text.startsWith("GIF89a")) return { kind: "image", contentType: "image/gif" };
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return { kind: "image", contentType: "image/webp" };
  if (text.slice(4, 8) === "ftyp" && ["avif", "avis"].includes(text.slice(8, 12))) return { kind: "image", contentType: "image/avif" };
  return null;
}

export const listFs = (
  path?: string,
  opts?: { showHidden?: boolean; files?: boolean },
): Effect.Effect<FsListing, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = homedir();
    const target = yield* fs.realPath(path ? userPath(path) : home).pipe(Effect.mapError(wireError("ls_failed")));
    const names = yield* fs.readDirectory(target).pipe(Effect.mapError(wireError("ls_failed")));
    const entries: Array<FsListing["entries"][number]> = [];
    yield* Effect.forEach(names, (name) => Effect.gen(function* () {
      const hidden = name.startsWith(".");
      if (!opts?.showHidden && hidden) return;
      const info = yield* fs.stat(join(target, name)).pipe(Effect.option);
      const kind = Option.isNone(info) ? "other" : info.value.type === "Directory" ? "directory" : info.value.type === "File" ? "file" : "other";
      if (!opts?.files && kind !== "directory") return;
      entries.push({ name, hidden, kind, size: kind === "file" && Option.isSome(info) ? Number(info.value.size) : null });
    }), { discard: true });
    entries.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name));
    const parent = dirname(target);
    return { path: target, parent: parent === target ? null : parent, home, entries };
  });

export const inspectFile = (path: string, relativeTo?: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const target = yield* fs.realPath(userPath(path, relativeTo));
    const info = yield* fs.stat(target);
    if (info.type !== "File") return yield* Effect.fail(new Error("not_a_file"));
    const header = yield* Effect.scoped(Effect.gen(function* () {
      const file = yield* fs.open(target);
      return Option.getOrElse(yield* file.readAlloc(FILE_SIGNATURE_BYTES), () => new Uint8Array());
    }));
    return { path: target, size: Number(info.size), format: binaryFormat(header) };
  }).pipe(Effect.mapError((error) => "_tag" in error ? wireError("read_failed")(error) : error));

export const readFile = (path: string, relativeTo?: string): Effect.Effect<FsFile, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* inspectFile(path, relativeTo);
    if (file.format?.kind === "pdf") return { kind: "pdf" as const, path: file.path };
    if (file.format?.kind === "image") {
      if (file.size > MAX_IMAGE_BYTES) return yield* Effect.fail(new Error("too_large"));
      return { kind: "image" as const, path: file.path, mediaType: file.format.contentType };
    }
    if (file.size > MAX_TEXT_BYTES) return yield* Effect.fail(new Error("too_large"));
    const bytes = yield* fs.readFile(file.path).pipe(Effect.mapError(wireError("read_failed")));
    if (bytes.includes(0)) return yield* Effect.fail(new Error("not_text"));
    const text = yield* Effect.try({ try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes), catch: () => new Error("not_text") });
    return { kind: "text" as const, path: file.path, text };
  });
