import { Effect } from "effect";
import { backgroundCompatibility } from "@pico/host";
import { releaseLocalAdminSession } from "../host/admin.ts";
import { run, runInherit, runOutput } from "../host/exec.ts";

export const resumeCommand = (id: string) =>
  Effect.gen(function* () {
    const versionResult = yield* run("pi", ["--version"], { timeoutMs: 5_000 });
    if (versionResult.exitCode !== 0) {
      return yield* Effect.fail(new Error("system Pi is not available on PATH"));
    }
    const piVersion = runOutput(versionResult);
    const packages = yield* run("pi", ["list"], { timeoutMs: 10_000 });
    if (packages.exitCode !== 0 || !runOutput(packages).includes("pi-extension")) {
      return yield* Effect.fail(new Error("Pico's Pi extension is not installed; run pico setup first"));
    }
    const compatibility = backgroundCompatibility(piVersion);
    if (!compatibility.compatible) {
      return yield* Effect.fail(new Error(compatibility.reason));
    }

    const released = yield* releaseLocalAdminSession(id);
    yield* Effect.sync(() => {
      console.log(`Returning ${released.title} to terminal Pi…`);
      console.log(`  session: ${released.id}`);
      console.log(`  file:    ${released.runtimeSessionFile}`);
    });

    const exitCode = yield* runInherit(
      "pi",
      ["--session", released.runtimeSessionFile, "/pico"],
      {
        cwd: released.cwd,
        env: {
          ...process.env,
          PICO_RECLAIM_LEASE_ID: released.leaseId,
          PICO_RECLAIM_SESSION_ID: released.id,
        },
      },
    );
    if (exitCode !== 0) {
      return yield* Effect.fail(new Error(
        `Pi exited with status ${exitCode}. The JSONL is safe at ${released.runtimeSessionFile}.`,
      ));
    }
  });
