import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { Hono } from "hono";
import {
  MIN_MOBILE_VERSION,
  PRODUCT_VERSION,
  PROTOCOL_VERSION,
  RECOMMENDED_MOBILE_VERSION,
  type HostUpdateStatus,
} from "@pico/protocol";
import { AUTO_UPDATE, UPDATE_REQUEST_PATH, UPDATE_STATE_PATH } from "../config.ts";

const UPDATE_CHANNEL = "stable";

export function readUpdateStatus(): HostUpdateStatus {
  let state: Partial<HostUpdateStatus> = {};
  try {
    if (existsSync(UPDATE_STATE_PATH)) {
      state = JSON.parse(readFileSync(UPDATE_STATE_PATH, "utf8")) as Partial<HostUpdateStatus>;
    }
  } catch {
    state = {};
  }

  const requestedAt = existsSync(UPDATE_REQUEST_PATH)
    ? new Date(statSync(UPDATE_REQUEST_PATH).mtimeMs).toISOString()
    : undefined;

  return {
    currentVersion: PRODUCT_VERSION,
    autoUpdate: AUTO_UPDATE,
    manualUpdate: existsSync("/etc/systemd/system/pico-host-update.path"),
    ...(state.lastSeenVersion ? { lastSeenVersion: state.lastSeenVersion } : {}),
    ...(requestedAt ? { requestedAt } : {}),
    ...(state.updatedAt ? { updatedAt: new Date(state.updatedAt).toISOString() } : {}),
    ...(state.failure ? { failure: state.failure } : {}),
  };
}

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

export function requestHostUpdate(): HostUpdateStatus {
  writeFileSync(UPDATE_REQUEST_PATH, `${Date.now()}\n`);
  return readUpdateStatus();
}

export function mountSystemRoutes(app: Hono): void {
  app.get("/healthz", (c) => c.text("ok"));
}
