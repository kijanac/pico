import { Readable } from "node:stream";
import { promisify } from "node:util";
import { createGzip, gzip } from "node:zlib";
import * as Headers from "@effect/platform/Headers";
import * as HttpApp from "@effect/platform/HttpApp";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

const gzipAsync = promisify(gzip);

const COMPRESSIBLE = /^(?:text\/|application\/(?:json|javascript|xml|wasm)|image\/svg\+xml)/i;
// Below this, gzip framing overhead outweighs the savings.
const MIN_BYTES = 1024;

const acceptsGzip = (headers: Headers.Headers): boolean =>
  (headers["accept-encoding"] ?? "").toLowerCase().includes("gzip");

const compressible = (response: HttpServerResponse.HttpServerResponse): boolean =>
  response.headers["content-encoding"] === undefined &&
  COMPRESSIBLE.test(response.headers["content-type"] ?? "");

// content-length described the uncompressed body; buffered bodies re-add the
// correct one, streamed bodies go chunked.
const withGzipHeaders = (headers: Headers.Headers): Headers.Headers =>
  Headers.set(
    Headers.set(Headers.remove(headers, "content-length"), "content-encoding", "gzip"),
    "vary",
    "accept-encoding",
  );

// Must run via HttpApiBuilder.middleware (inside the app pipeline, before
// serialization); the serve() middleware slot runs after serialization and
// cannot rewrite the body.
export const compress = (
  httpApp: HttpApp.Default,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const response = yield* httpApp;

    if (!acceptsGzip(request.headers) || !compressible(response)) return response;

    const body = response.body;
    const options = {
      status: response.status,
      statusText: response.statusText,
      cookies: response.cookies,
      headers: withGzipHeaders(response.headers),
    };

    if (body._tag === "Uint8Array") {
      if (body.body.length < MIN_BYTES) return response;
      const gzipped = yield* Effect.promise(() => gzipAsync(body.body));
      return HttpServerResponse.uint8Array(gzipped, options);
    }

    if (body._tag === "Stream") {
      // Cast bridges DOM vs node web-stream lib typings (WritableStream<BufferSource>
      // variance); structurally compatible.
      const gzip = new CompressionStream("gzip") as unknown as {
        readonly readable: ReadableStream<Uint8Array>;
        readonly writable: WritableStream<Uint8Array>;
      };
      const gzipped = Stream.fromReadableStream<Uint8Array, unknown>({
        evaluate: () => Stream.toReadableStream<Uint8Array>()(body.stream).pipeThrough(gzip),
        onError: (error) => error,
      });
      return HttpServerResponse.stream(gzipped, options);
    }

    // File responses (the web app) are raw Node read streams.
    if (body._tag === "Raw" && body.body instanceof Readable) {
      return HttpServerResponse.raw(body.body.pipe(createGzip()), options);
    }

    return response;
  });
