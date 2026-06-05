import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { Hono } from "hono";
import {
  MIN_MOBILE_VERSION,
  PRODUCT_VERSION,
  PROTOCOL_VERSION,
  RECOMMENDED_MOBILE_VERSION,
  type BridgeUpdateStatus,
} from "@pico/protocol";

const UPDATE_CHANNEL = "stable";
const AUTO_UPDATE = process.env.PI_BRIDGE_AUTO_UPDATE === "1";
const UPDATE_REQUEST_PATH = process.env.PI_BRIDGE_UPDATE_REQUEST_PATH ?? "/var/lib/pi-bridge/update-request";
const UPDATE_STATE_PATH = process.env.PI_BRIDGE_UPDATE_STATE_PATH ?? "/var/lib/pi-bridge/update-state.json";

export function readUpdateStatus(): BridgeUpdateStatus {
  let state: Partial<BridgeUpdateStatus> = {};
  try {
    if (existsSync(UPDATE_STATE_PATH)) {
      state = JSON.parse(readFileSync(UPDATE_STATE_PATH, "utf8")) as Partial<BridgeUpdateStatus>;
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
    manualUpdate: existsSync("/etc/systemd/system/pi-bridge-update.path"),
    ...(state.lastSeenVersion ? { lastSeenVersion: state.lastSeenVersion } : {}),
    ...(requestedAt ? { requestedAt } : {}),
    ...(state.updatedAt ? { updatedAt: new Date(state.updatedAt).toISOString() } : {}),
    ...(state.failure ? { failure: state.failure } : {}),
  };
}

export function bridgeSystemInfo() {
  return {
    bridgeVersion: PRODUCT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    minMobileVersion: MIN_MOBILE_VERSION,
    recommendedMobileVersion: RECOMMENDED_MOBILE_VERSION,
    updateChannel: UPDATE_CHANNEL,
    autoUpdate: AUTO_UPDATE,
  };
}

export function requestBridgeUpdate(): BridgeUpdateStatus {
  writeFileSync(UPDATE_REQUEST_PATH, `${Date.now()}\n`);
  return readUpdateStatus();
}

export function mountSystemRoutes(app: Hono): void {
  app.get("/healthz", (c) => c.text("ok"));
}
