import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { pairCodeCommand } from "./pair.ts";
import { installCommand } from "./service.ts";
import { run, runInherit } from "../host/exec.ts";
import { healthcheck } from "../host/network.ts";
import { picoHostPathsFromEnv } from "../host/paths.ts";

const packageSource = resolve(dirname(fileURLToPath(import.meta.url)), "../../../pi-extension");

export const setupCommand = Effect.gen(function* () {
  const paths = picoHostPathsFromEnv();
  const extensionTarget = join(paths.dataDir, "pi-extension");

  yield* Effect.tryPromise({
    try: async () => {
      await rm(extensionTarget, { recursive: true, force: true });
      await mkdir(extensionTarget, { recursive: true });
      await Promise.all([
        cp(join(packageSource, "package.json"), join(extensionTarget, "package.json")),
        cp(join(packageSource, "README.md"), join(extensionTarget, "README.md")),
        cp(join(packageSource, "dist"), join(extensionTarget, "dist"), { recursive: true }),
      ]);
    },
    catch: (error) => new Error(`Could not stage the Pico Pi extension: ${String(error)}`, { cause: error }),
  });

  // Local-path packages are keyed by their resolved path. Remove both the
  // checkout/release source and the stable staged path so setup stays
  // idempotent instead of loading two copies of the extension.
  yield* run("pi", ["remove", packageSource], { timeoutMs: 15_000 });
  yield* run("pi", ["remove", extensionTarget], { timeoutMs: 15_000 });
  const piInstallExit = yield* runInherit("pi", ["install", extensionTarget]);
  if (piInstallExit !== 0) {
    return yield* Effect.fail(new Error("Could not install the Pico extension into system Pi"));
  }

  yield* installCommand({
    mode: "user",
    createSystemUser: false,
    tailscaleServe: true,
    autoUpdate: false,
  });

  const localUrl = `http://${paths.host}:${paths.port}`;
  const deadline = Date.now() + 15_000;
  let healthy = false;
  while (!healthy && Date.now() < deadline) {
    healthy = yield* healthcheck(localUrl, 1_000).pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (!healthy) yield* Effect.sleep("250 millis");
  }
  if (!healthy) {
    return yield* Effect.fail(new Error(`Pico host did not become healthy at ${localUrl}; run pico logs`));
  }

  yield* pairCodeCommand();
});
