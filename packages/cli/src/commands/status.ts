import { Effect } from "effect";
import { getLocalAdminStatus, localAdminTokenPath, readLocalAdminToken } from "../host/admin.ts";
import { healthcheck, portIsOpen } from "../host/network.ts";
import { picoHostPathsFromEnv, systemPicoHostPathsFromEnv } from "../host/paths.ts";
import { pairingTokenPath, readPairingToken } from "../host/pairing.ts";
import { type ServiceMode } from "../host/service.ts";
import { inspectTailscale } from "../host/tailscale.ts";

export const statusCommand = (options: { readonly mode?: ServiceMode; readonly systemUser?: string } = {}) =>
  Effect.gen(function* () {
    const paths = options.mode === "system" ? systemPicoHostPathsFromEnv(options.systemUser) : picoHostPathsFromEnv();
    const localUrl = `http://${paths.host}:${paths.port}`;
    const open = yield* portIsOpen(paths.host, paths.port).pipe(Effect.catchAll(() => Effect.succeed(false)));
    const healthy = open ? yield* healthcheck(localUrl).pipe(Effect.catchAll(() => Effect.succeed(false))) : false;
    const tailscale = yield* inspectTailscale(paths.port);
    const serveStatus = tailscale.serveStatus;
    const tailnetUrl = tailscale.serveUrl;
    const token = yield* readPairingToken(paths.dataDir);
    const adminToken = yield* readLocalAdminToken(paths.dataDir);
    const adminStatus = open && adminToken
      ? yield* getLocalAdminStatus(paths).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
      : undefined;

    yield* Effect.sync(() => {
      console.log("Pico host status\n");
      console.log(`local:      ${localUrl} (${healthy ? "healthy" : open ? "listening" : "not running"})`);
      if (tailnetUrl) console.log(`tailnet:    ${tailnetUrl}`);
      console.log(`workspaces: ${adminStatus?.workspacesDir ?? paths.workspacesDir}`);
      console.log(`data:       ${adminStatus?.dataDir ?? paths.dataDir}`);
      if (adminStatus) {
        console.log(`admin:      pid ${adminStatus.pid}, ${adminStatus.claimed ? `claimed by ${adminStatus.owners.join(", ")}` : "unclaimed"}`);
      } else {
        console.log(`admin:      ${adminToken ? "not reachable" : `token not found at ${localAdminTokenPath(paths.dataDir)}`}`);
      }
      console.log(`pair token: ${adminStatus?.pairingTokenConfigured ? "loaded by running host" : token ? pairingTokenPath(paths.dataDir) : "not created yet"}`);
      if (serveStatus) {
        console.log("\nTailscale Serve:");
        console.log(serveStatus);
      }
    });
  });
