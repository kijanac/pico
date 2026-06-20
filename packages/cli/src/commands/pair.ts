import {
  makePairingDeepLink,
  preparePairing,
  type Diagnostic,
  type PairingPlan,
} from "@pico/host";
import { terminalQr } from "../lib/terminal.ts";

export async function printPairingInfo(options: {
  readonly hostUrl: string | undefined;
  readonly token?: string;
  readonly workspacesDir: string;
  readonly dataDir: string;
  readonly port: number;
  readonly existing?: boolean;
  readonly foreground?: boolean;
}): Promise<void> {
  console.log(`\n\x1b[1;36mPico host ${options.existing ? "is already running" : "is running"}\x1b[0m`);
  console.log(`  workspaces: ${options.workspacesDir}`);
  console.log(`  data:       ${options.dataDir}`);

  if (!options.hostUrl) {
    console.log("\nNo Tailscale HTTPS URL was detected yet.");
    console.log(`After Tailscale is connected, run: tailscale serve --bg --https=443 http://localhost:${options.port}`);
    console.log("Then enter the resulting https://…ts.net URL in Pico Settings.");
    return;
  }

  const connectUrl = makePairingDeepLink({ hostUrl: options.hostUrl, token: options.token });
  console.log(`  url:        ${options.hostUrl}`);
  console.log("\nScan this QR with your phone camera, or open the link below:");
  const qr = await terminalQr(connectUrl);
  if (qr) console.log(qr);
  console.log(`  ${connectUrl}`);
  console.log("\nManual fallback:");
  console.log(`  Pico host URL: ${options.hostUrl}`);
  if (options.token) {
    console.log(`  Pairing token: ${options.token}`);
  } else {
    console.log("  Pairing token: not included (host may already be claimed)");
  }
  if (options.foreground) console.log("\nPress Ctrl+C to stop this foreground host.");
}

export async function pairCommand(): Promise<void> {
  const plan = await preparePairing({ startHost: true, configureServe: true, inheritTailscaleStdio: true });
  try {
    await printPairingPlan(plan, { foreground: plan.foregroundHostStarted });
    if (plan.foregroundHostStarted) await waitForStopSignal();
  } finally {
    await plan.host?.close();
  }
}

export async function pairCodeCommand(options: { readonly rotate?: boolean } = {}): Promise<void> {
  const plan = await preparePairing({ rotate: options.rotate, startHost: false, configureServe: true });
  await printPairingPlan(plan, { foreground: false });
  if (plan.rotationUnavailable) {
    console.log("\nCould not rotate the running host token through local admin. Restart it with the current `pico serve`/`pico pair` first.");
  }
}

async function printPairingPlan(plan: PairingPlan, options: { readonly foreground: boolean }): Promise<void> {
  printDiagnostics(plan.diagnostics);
  await printPairingInfo({
    hostUrl: plan.hostUrl,
    token: plan.token,
    workspacesDir: plan.workspacesDir,
    dataDir: plan.dataDir,
    port: plan.port,
    existing: plan.existing,
    foreground: options.foreground,
  });
  if (plan.existing && !plan.token) {
    console.log("\nNo local pairing token file was found for the running host. If it is unclaimed, restart it with `pico serve` or `pico pair` to load a stored token.");
  }
}

function printDiagnostics(diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const prefix = diagnostic.level === "fail" ? "WARNING" : "note";
    console.log(`\n${prefix}: ${diagnostic.label}${diagnostic.detail ? `: ${diagnostic.detail}` : ""}`);
    if (diagnostic.fix) console.log(`  ${diagnostic.fix}`);
  }
}

async function waitForStopSignal(): Promise<void> {
  await new Promise<void>((resolveStopped) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolveStopped();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
