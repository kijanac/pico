import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Effect, Option } from "effect";
import {
  MIN_MOBILE_VERSION,
  PRODUCT_VERSION,
  PROTOCOL_VERSION,
  RECOMMENDED_MOBILE_VERSION,
  type HostUpdateStatus,
} from "@pico/protocol";
import { AUTO_UPDATE, UPDATE_REQUEST_PATH, UPDATE_STATE_PATH } from "../config.ts";

const UPDATE_CHANNEL = "stable";

export const readUpdateStatus = (): Effect.Effect<HostUpdateStatus, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const state = yield* fs.readFileString(UPDATE_STATE_PATH, "utf8").pipe(
      Effect.flatMap((raw) => Effect.try(() => JSON.parse(raw) as Partial<HostUpdateStatus>)),
      Effect.orElseSucceed(() => ({}) as Partial<HostUpdateStatus>),
    );

    const requestedAt = yield* fs.stat(UPDATE_REQUEST_PATH).pipe(
      Effect.map((info) => Option.map(info.mtime, (d) => d.toISOString())),
      Effect.orElseSucceed(() => Option.none<string>()),
    );

    const manualUpdate = yield* fs
      .exists("/etc/systemd/system/pico-host-update.path")
      .pipe(Effect.orElseSucceed(() => false));

    return {
      currentVersion: PRODUCT_VERSION,
      autoUpdate: AUTO_UPDATE,
      manualUpdate,
      ...(state.lastSeenVersion ? { lastSeenVersion: state.lastSeenVersion } : {}),
      ...(Option.isSome(requestedAt) ? { requestedAt: requestedAt.value } : {}),
      ...(state.updatedAt ? { updatedAt: new Date(state.updatedAt).toISOString() } : {}),
      ...(state.failure ? { failure: state.failure } : {}),
    };
  });

export function hostSystemInfo() {
  return {
    hostVersion: PRODUCT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    minMobileVersion: MIN_MOBILE_VERSION,
    recommendedMobileVersion: RECOMMENDED_MOBILE_VERSION,
    updateChannel: UPDATE_CHANNEL,
    autoUpdate: AUTO_UPDATE,
  };
}

export const requestHostUpdate = (): Effect.Effect<HostUpdateStatus, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(UPDATE_REQUEST_PATH, `${Date.now()}\n`);
    return yield* readUpdateStatus();
  });
