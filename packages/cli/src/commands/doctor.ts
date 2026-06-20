import { collectDoctorChecks } from "@pico/host";
import { printDiagnosticTable } from "../lib/diagnostics.ts";

export async function doctorCommand(): Promise<void> {
  const checks = await collectDoctorChecks();
  console.log("Pico host doctor\n");

  printDiagnosticTable(checks);

  const failures = checks.filter((check) => check.level === "fail").length;
  const warnings = checks.filter((check) => check.level === "warn").length;
  console.log(`\n${failures} failure(s), ${warnings} warning(s)`);
  if (failures > 0) process.exitCode = 1;
}
