import { mkdirSync } from "node:fs";
import {
  ensureTailscaleServe,
  getOrCreatePairingToken,
  healthcheck,
  picoHostPathsFromEnv,
  portIsOpen,
  startPicoHost,
  type Diagnostic,
  type PicoHostHandle,
} from "@pico/host";

async function waitForHealth(host: string, port: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  const url = `http://${host}:${port}`;
  while (Date.now() < deadline) {
    if (await healthcheck(url, 1_000)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("Timed out waiting for Pico host /healthz");
}

async function waitUntilStopped(host: PicoHostHandle): Promise<void> {
  let stopping = false;
  await new Promise<void>((resolveStopped) => {
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void host.close().finally(resolveStopped);
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export async function serveCommand(): Promise<void> {
  const paths = picoHostPathsFromEnv();
  const token = getOrCreatePairingToken(paths.dataDir);

  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.workspacesDir, { recursive: true });

  if (await portIsOpen(paths.host, paths.port)) {
    throw new Error(`Port ${paths.host}:${paths.port} is already in use. Stop the existing Pico host process, or set PICO_HOST_PORT.`);
  }

  const host = await startPicoHost({
    dbPath: paths.dbPath,
    workspacesDir: paths.workspacesDir,
    pairingToken: token,
    host: paths.host,
    port: paths.port,
    nodeEnv: process.env.NODE_ENV || "production",
  });

  try {
    await waitForHealth(paths.host, paths.port);
    const tailscale = await ensureTailscaleServe(paths.port, { configure: true, inheritStdio: true });
    printDiagnostics(tailscale.diagnostics);
    console.log("Pico host is serving");
    console.log(`  local:      http://${paths.host}:${paths.port}`);
    if (tailscale.serveUrl) console.log(`  tailnet:    ${tailscale.serveUrl}`);
    console.log(`  workspaces: ${paths.workspacesDir}`);
    console.log(`  data:       ${paths.dataDir}`);
    await waitUntilStopped(host);
  } catch (error) {
    await host.close();
    throw error;
  }
}

function printDiagnostics(diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    if (diagnostic.level === "ok") continue;
    console.warn(`\nWARNING: ${diagnostic.label}${diagnostic.detail ? `: ${diagnostic.detail}` : ""}`);
    if (diagnostic.fix) console.warn(`  ${diagnostic.fix}`);
  }
}
