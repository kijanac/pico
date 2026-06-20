import { collectDoctorChecks, type Diagnostic } from "@pico/host";

function symbol(level: Diagnostic["level"]): string {
  if (level === "ok") return "✓";
  if (level === "warn") return "!";
  return "✕";
}

function color(level: Diagnostic["level"]): string {
  if (!process.stdout.isTTY) return "";
  if (level === "ok") return "\x1b[32m";
  if (level === "warn") return "\x1b[33m";
  return "\x1b[31m";
}

function reset(): string {
  return process.stdout.isTTY ? "\x1b[0m" : "";
}

export async function doctorCommand(): Promise<void> {
  const checks = await collectDoctorChecks();
  console.log("Pico host doctor\n");

  for (const check of checks) {
    console.log(`${color(check.level)}${symbol(check.level)}${reset()} ${check.label}${check.detail ? `: ${check.detail}` : ""}`);
    if (check.fix) console.log(`    ${check.fix}`);
  }

  const failures = checks.filter((check) => check.level === "fail").length;
  const warnings = checks.filter((check) => check.level === "warn").length;
  console.log(`\n${failures} failure(s), ${warnings} warning(s)`);
  if (failures > 0) process.exitCode = 1;
}
