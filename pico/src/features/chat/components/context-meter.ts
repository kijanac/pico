export type ContextMeter = { kind: "unknown" } | { kind: "known"; percent: number; fill: number };

export function contextMeter(percent: number | null | undefined): ContextMeter {
  if (percent === null || percent === undefined || !Number.isFinite(percent) || percent < 0) return { kind: "unknown" };
  return { kind: "known", percent: Math.round(percent), fill: Math.min(percent, 100) };
}
