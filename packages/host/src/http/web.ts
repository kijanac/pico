import * as FileSystem from "@effect/platform/FileSystem";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import * as Effect from "effect/Effect";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The built web app (pico/dist), resolved from this module so it works from src/ and dist/.
const WEB_DIR = fileURLToPath(new URL("../../../../pico/dist/", import.meta.url));

const serveWeb = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const fs = yield* FileSystem.FileSystem;
  const pathname = new URL(request.url, "http://host").pathname;
  // Vite content-hashes everything under /assets, so those never change and a
  // missing one is a stale build (the app reloads on vite:preloadError).
  const hashed = pathname.startsWith("/assets/");
  const candidate = join(WEB_DIR, pathname);
  const isFile = candidate.startsWith(WEB_DIR)
    && (yield* fs.stat(candidate).pipe(
      Effect.map((info) => info.type === "File"),
      Effect.orElseSucceed(() => false),
    ));
  if (!isFile && hashed) return HttpServerResponse.empty({ status: 404 });
  // Anything else is a client-side route (/settings, /h/:hostId/s/:id): serve the
  // app shell, revalidated so a deploy reaches the phone on its next load.
  return yield* HttpServerResponse.file(isFile ? candidate : join(WEB_DIR, "index.html"), {
    headers: { "cache-control": isFile && hashed ? "public, max-age=31536000, immutable" : "no-cache" },
  });
}).pipe(
  Effect.catchAll(() =>
    HttpServerResponse.text("Pico's web app isn't built; run `pnpm build`.", { status: 503 }),
  ),
);

export const WebRoutesLive = HttpApiBuilder.Router.use((router) => router.get("*", serveWeb));
