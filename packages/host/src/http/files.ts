import { basename } from "node:path";
import * as FileSystem from "@effect/platform/FileSystem";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import * as Effect from "effect/Effect";
import { inspectFile, MAX_IMAGE_BYTES } from "../fs.ts";
import { parseByteRange } from "./byte-range.ts";

const binaryRoute = (kind: "pdf" | "image") => Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const site = request.headers["sec-fetch-site"];
  if (site === "cross-site" || site === "same-site") return HttpServerResponse.empty({ status: 403 });
  const params = new URL(request.url, "http://pico.invalid").searchParams;
  const path = params.get("path");
  if (!path) return HttpServerResponse.unsafeJson({ error: "missing_path" }, { status: 400 });
  const file = yield* inspectFile(path, params.get("relativeTo") ?? undefined);
  if (!file.format || file.format.kind !== kind) return HttpServerResponse.unsafeJson({ error: `not_${kind}` }, { status: 415, headers: { "cache-control": "no-store" } });
  if (kind === "image" && file.size > MAX_IMAGE_BYTES) return HttpServerResponse.unsafeJson({ error: "too_large" }, { status: 413, headers: { "cache-control": "no-store" } });
  const range = parseByteRange(request.headers.range, file.size);
  if (range.kind === "invalid") return HttpServerResponse.empty({ status: 416, headers: { "content-range": `bytes */${file.size}`, "cache-control": "no-store" } });
  const disposition = params.get("download") === "1" ? "attachment" : "inline";
  const fs = yield* FileSystem.FileSystem;
  const start = range.kind === "partial" ? range.start : 0;
  const length = range.kind === "partial" ? range.end - range.start + 1 : file.size;
  return HttpServerResponse.stream(fs.stream(file.path, { offset: start, bytesToRead: length }), {
    contentType: file.format.contentType,
    contentLength: length,
    status: range.kind === "partial" ? 206 : 200,
    headers: {
      "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(basename(file.path)).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
      "content-security-policy": kind === "image" ? "default-src 'none'; sandbox; frame-ancestors 'self'" : "frame-ancestors 'self'",
      "accept-ranges": "bytes",
      ...(range.kind === "partial" ? { "content-range": `bytes ${range.start}-${range.end}/${file.size}` } : {}),
    },
  });
}).pipe(Effect.catchAll((error) => {
  const message = error instanceof Error ? error.message : "read_failed";
  const status = message === "not_found" ? 404 : message === "forbidden" ? 403 : message === "not_a_file" ? 415 : 500;
  return Effect.succeed(HttpServerResponse.unsafeJson({ error: message }, { status, headers: { "cache-control": "no-store" } }));
}));

export const pdfRoute = binaryRoute("pdf");
export const imageRoute = binaryRoute("image");
