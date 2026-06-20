import { getLocalAdminStatus, healthcheck, inspectTailscale, localAdminTokenPath, pairingTokenPath, picoHostPathsFromEnv, portIsOpen, readLocalAdminToken, readPairingToken, systemPicoHostPathsFromEnv, type ServiceMode } from "@pico/host";

export async function statusCommand(options: { readonly mode?: ServiceMode; readonly systemUser?: string } = {}): Promise<void> {
  const paths = options.mode === "system" ? systemPicoHostPathsFromEnv(options.systemUser) : picoHostPathsFromEnv();
  const localUrl = `http://${paths.host}:${paths.port}`;
  const open = await portIsOpen(paths.host, paths.port);
  const healthy = open ? await healthcheck(localUrl) : false;
  const tailscale = inspectTailscale(paths.port);
  const serveStatus = tailscale.serveStatus;
  const tailnetUrl = tailscale.serveUrl;
  const token = readPairingToken(paths.dataDir);
  const adminToken = readLocalAdminToken(paths.dataDir);
  const adminStatus = open && adminToken ? await getLocalAdminStatus(paths).catch(() => undefined) : undefined;

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
}
