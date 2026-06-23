import type { Diagnostic } from "../host/errors.ts";
import type { ServiceResult } from "../host/service.ts";

export type Level = Diagnostic["level"];

export function levelSymbol(level: Level): string {
  if (level === "ok") return "✓";
  if (level === "warn") return "!";
  return "✕";
}

export function levelColor(level: Level): string {
  if (!process.stdout.isTTY) return "";
  if (level === "ok") return "\x1b[32m";
  if (level === "warn") return "\x1b[33m";
  return "\x1b[31m";
}

export function resetColor(): string {
  return process.stdout.isTTY ? "\x1b[0m" : "";
}

export function printDiagnosticTable(diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    console.log(formatLevelLine(diagnostic.level, diagnostic.label, diagnostic.detail));
    if (diagnostic.fix) console.log(`    ${diagnostic.fix}`);
  }
}

export function printActionDiagnostics(diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    if (diagnostic.level === "ok") continue;
    const prefix = diagnostic.level === "fail" ? "WARNING" : "note";
    console.log(`\n${prefix}: ${diagnostic.label}${diagnostic.detail ? `: ${diagnostic.detail}` : ""}`);
    if (diagnostic.fix) console.log(`  ${diagnostic.fix}`);
  }
}

export function printServiceResults(results: readonly ServiceResult[]): boolean {
  for (const result of results) {
    console.log(formatLevelLine(result.level, result.message, result.detail));
  }
  const failed = results.some((result) => result.level === "fail");
  if (failed) process.exitCode = 1;
  return failed;
}

function formatLevelLine(level: Level, label: string, detail?: string): string {
  return `${levelColor(level)}${levelSymbol(level)}${resetColor()} ${label}${detail ? `: ${detail}` : ""}`;
}
