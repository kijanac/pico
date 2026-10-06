import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { adminPairing, adminStatus, rotatePairing } from "../local-admin.ts";
import { PicoHostApi } from "./api.ts";
import { SessionManager } from "../session.ts";
import { SessionNotFound } from "../errors.ts";

export const SystemApiLive = HttpApiBuilder.group(PicoHostApi, "system", (handlers) =>
  handlers.handle("healthz", () => Effect.succeed("ok")),
);

export const AdminApiLive = HttpApiBuilder.group(PicoHostApi, "admin", (handlers) =>
  handlers
    .handle("status", () => Effect.sync(adminStatus))
    .handle("pairing", () => Effect.sync(adminPairing))
    .handle("pairingRotate", () => rotatePairing().pipe(Effect.orDie))
    .handle("sessionRelease", ({ payload }) =>
      Effect.flatMap(SessionManager, (manager) => manager.releaseToTerminal(payload.id)).pipe(
        Effect.map((released) => ({ ok: true as const, ...released })),
        Effect.catchAll((error) => {
          const reason = error instanceof SessionNotFound
            ? `Session not found: ${error.id}`
            : error.message || "Could not return this session to the terminal";
          return Effect.logWarning("session_terminal_release_failed").pipe(
            Effect.annotateLogs({ session_id: payload.id, reason }),
            Effect.as({ ok: false as const, error: reason }),
          );
        }),
      ),
    ),
);
