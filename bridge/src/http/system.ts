import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { Hono } from "hono";
import { authorizeHeaders, claimBridgeOwner } from "../auth.ts";
import {
  MIN_MOBILE_VERSION,
  PRODUCT_VERSION,
  PROTOCOL_VERSION,
  RECOMMENDED_MOBILE_VERSION,
  type BridgeUpdateStatus,
} from "@pi-mobile/protocol";

const UPDATE_CHANNEL = "stable";
const AUTO_UPDATE = process.env.PI_BRIDGE_AUTO_UPDATE === "1";
const UPDATE_REQUEST_PATH = process.env.PI_BRIDGE_UPDATE_REQUEST_PATH ?? "/var/lib/pi-bridge/update-request";
const UPDATE_STATE_PATH = process.env.PI_BRIDGE_UPDATE_STATE_PATH ?? "/var/lib/pi-bridge/update-state.json";

function readUpdateStatus(): BridgeUpdateStatus {
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

export function mountSystemRoutes(app: Hono): void {
  app.get("/healthz", (c) => c.text("ok"));

  app.get("/system/identity", (c) => {
    const result = authorizeHeaders(c.req.raw.headers);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ user: result.user, claimed: result.claimed });
  });

  app.post("/setup/claim", (c) => {
    const result = authorizeHeaders(c.req.raw.headers);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    if (!result.user) return c.json({ error: "missing_tailscale_identity" }, 401);
    try {
      return c.json(claimBridgeOwner(result.user));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  app.get("/system/info", (c) =>
    c.json({
      bridgeVersion: PRODUCT_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      minMobileVersion: MIN_MOBILE_VERSION,
      recommendedMobileVersion: RECOMMENDED_MOBILE_VERSION,
      updateChannel: UPDATE_CHANNEL,
      autoUpdate: AUTO_UPDATE,
    }),
  );

  app.get("/system/update", (c) => c.json(readUpdateStatus()));

  app.post("/system/update", (c) => {
    writeFileSync(UPDATE_REQUEST_PATH, `${Date.now()}\n`);
    return c.json(readUpdateStatus(), 202);
  });
}
