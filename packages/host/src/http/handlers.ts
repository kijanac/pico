import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as Effect from "effect/Effect";
import { PicoHostApi } from "./api.ts";

export const SystemApiLive = HttpApiBuilder.group(PicoHostApi, "system", (handlers) =>
  handlers.handle("healthz", () => Effect.succeed("ok")),
);
