import { Effect } from "effect";
import { prepareServing } from "@pico/host";
import { printActionDiagnostics } from "../lib/diagnostics.ts";

export const serveCommand = Effect.gen(function* () {
  const plan = yield* prepareServing({ configureServe: true, inheritTailscaleStdio: true });
  yield* Effect.addFinalizer(() => Effect.promise(() => plan.host.close()));
  yield* Effect.sync(() => {
    printActionDiagnostics(plan.diagnostics);
    console.log("Pico host is serving");
    console.log(`  local:      ${plan.localUrl}`);
    if (plan.hostUrl) console.log(`  tailnet:    ${plan.hostUrl}`);
    console.log(`  workspaces: ${plan.workspacesDir}`);
    console.log(`  data:       ${plan.dataDir}`);
  });
  // Run until interrupted; NodeRuntime.runMain handles Ctrl+C and closes the
  // host via the finalizer above.
  yield* Effect.never;
}).pipe(Effect.scoped);
