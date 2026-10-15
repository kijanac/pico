import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as Effect from "effect/Effect";
import { SessionManager } from "../session.ts";
import { exportRoute } from "./session-actions.ts";

import { imageRoute, pdfRoute } from "./files.ts";

export const RawRoutesLive = HttpApiBuilder.Router.use((router) =>
  Effect.gen(function* () {
    const manager = yield* SessionManager;
    yield* router.get("/sessions/:id/export.html", exportRoute(manager));
    yield* router.get("/fs/pdf", pdfRoute);
    yield* router.get("/fs/image", imageRoute);
  }),
);
