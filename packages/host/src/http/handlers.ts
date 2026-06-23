import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { adminPairing, adminStatus, rotatePairing } from "../local-admin.ts";
import { PicoHostApi } from "./api.ts";

export const SystemApiLive = HttpApiBuilder.group(PicoHostApi, "system", (handlers) =>
  handlers.handle("healthz", () => Effect.succeed("ok")),
);

export const AdminApiLive = HttpApiBuilder.group(PicoHostApi, "admin", (handlers) =>
  handlers
    .handle("status", () => Effect.sync(adminStatus))
    .handle("pairing", () => Effect.sync(adminPairing))
    .handle("pairingRotate", () => rotatePairing().pipe(Effect.orDie)),
);
