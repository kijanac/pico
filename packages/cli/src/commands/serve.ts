import { Effect } from "effect";
import { prepareServing } from "../host/setup.ts";
import { printActionDiagnostics } from "../lib/diagnostics.ts";

export const serveCommand = Effect.gen(function* () {
  // tailscale serve is owned by pair/install, not the serve loop.
  const plan = yield* prepareServing({});
  yield* Effect.addFinalizer(() => Effect.promise(() => plan.host.close()));
  yield* Effect.sync(() => {
    printActionDiagnostics(plan.diagnostics);
    console.log("Pico host is serving");
    console.log(`  local:      ${plan.localUrl}`);
    if (plan.hostUrl) console.log(`  tailnet:    ${plan.hostUrl}`);
    console.log(`  workspaces: ${plan.workspacesDir}`);
    console.log(`  data:       ${plan.dataDir}`);
  });
  // NodeRuntime.runMain interrupts this on Ctrl+C, triggering the finalizer.
  yield* Effect.never;
}).pipe(Effect.scoped);
