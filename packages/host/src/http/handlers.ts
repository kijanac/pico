import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { PicoHostApi } from "./api.ts";

export const SystemApiLive = HttpApiBuilder.group(PicoHostApi, "system", (handlers) =>
  handlers.handle("healthz", () => Effect.succeed("ok")),
);
