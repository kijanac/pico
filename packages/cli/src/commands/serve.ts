import { prepareServing } from "@pico/host";
import { printActionDiagnostics } from "../lib/diagnostics.ts";
import { waitForStopSignal } from "../lib/signals.ts";

export async function serveCommand(): Promise<void> {
  const plan = await prepareServing({ configureServe: true, inheritTailscaleStdio: true });
  try {
    printActionDiagnostics(plan.diagnostics);
    console.log("Pico host is serving");
    console.log(`  local:      ${plan.localUrl}`);
    if (plan.hostUrl) console.log(`  tailnet:    ${plan.hostUrl}`);
    console.log(`  workspaces: ${plan.workspacesDir}`);
    console.log(`  data:       ${plan.dataDir}`);
    await waitForStopSignal();
  } finally {
    await plan.host.close();
  }
}
