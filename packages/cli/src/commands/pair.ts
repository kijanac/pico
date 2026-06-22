import { Effect } from "effect";
import { makePairingDeepLink } from "../host/pairing.ts";
import { preparePairing, type PairingPlan } from "../host/setup.ts";
import { printActionDiagnostics } from "../lib/diagnostics.ts";
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

export const pairCommand = Effect.gen(function* () {
  const plan = yield* preparePairing({ startHost: true, configureServe: true, inheritTailscaleStdio: true });
  const host = plan.host;
  yield* Effect.addFinalizer(() => (host ? Effect.promise(() => host.close()) : Effect.void));
  yield* Effect.promise(() => printPairingPlan(plan, { foreground: plan.foregroundHostStarted }));
  // runMain closes the host via the finalizer on interrupt.
  if (plan.foregroundHostStarted) yield* Effect.never;
}).pipe(Effect.scoped);

export const pairCodeCommand = (options: { readonly rotate?: boolean } = {}) =>
  Effect.gen(function* () {
    const plan = yield* preparePairing({ rotate: options.rotate, startHost: false, configureServe: true });
    yield* Effect.promise(() => printPairingPlan(plan, { foreground: false }));
    if (plan.rotationUnavailable) {
      yield* Effect.sync(() =>
        console.log("\nCould not rotate the running host token through local admin. Restart it with the current `pico serve`/`pico pair` first."),
      );
    }
  });

async function printPairingPlan(plan: PairingPlan, options: { readonly foreground: boolean }): Promise<void> {
  printActionDiagnostics(plan.diagnostics);
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
