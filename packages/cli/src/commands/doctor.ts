import { Effect } from "effect";
import { collectDoctorChecks } from "../host/doctor.ts";
import { printDiagnosticTable } from "../lib/diagnostics.ts";

export const doctorCommand = Effect.gen(function* () {
  const checks = yield* collectDoctorChecks();
  yield* Effect.sync(() => {
    console.log("Pico host doctor\n");
    printDiagnosticTable(checks);
    const failures = checks.filter((check) => check.level === "fail").length;
    const warnings = checks.filter((check) => check.level === "warn").length;
    console.log(`\n${failures} failure(s), ${warnings} warning(s)`);
    if (failures > 0) process.exitCode = 1;
  });
});
