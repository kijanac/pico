import { FileSystem, HttpApiBuilder, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// The built web app (pico/dist), resolved from this module so it works from src/ and dist/.
const WEB_DIR = fileURLToPath(new URL("../../../../pico/dist/", import.meta.url));
const INDEX = join(WEB_DIR, "index.html");

// Vite content-hashes everything under /assets; the rest must revalidate so a
// deploy reaches the phone on its next load.
const cacheControl = (pathname: string) =>
  pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";

const serveWeb = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const fs = yield* FileSystem.FileSystem;
  const pathname = new URL(request.url, "http://host").pathname;
  const candidate = normalize(join(WEB_DIR, pathname));
  const isFile = candidate.startsWith(WEB_DIR)
    && (yield* fs.stat(candidate).pipe(
      Effect.map((info) => info.type === "File"),
      Effect.orElseSucceed(() => false),
    ));
  // Anything else is a client-side route (/settings, /h/:hostId/s/:id): serve the app shell.
  const file = isFile ? candidate : INDEX;
  return yield* HttpServerResponse.file(file, {
    headers: { "cache-control": cacheControl(isFile ? pathname : "/") },
  });
}).pipe(
  Effect.catchAll(() =>
    HttpServerResponse.text("Pico's web app isn't built; run `pnpm build`.", { status: 503 }),
  ),
);

export const WebRoutesLive = HttpApiBuilder.Router.use((router) => router.get("*", serveWeb));
