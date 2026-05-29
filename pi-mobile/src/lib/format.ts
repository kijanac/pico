const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

const UNITS: Array<[number, number, Intl.RelativeTimeFormatUnit]> = [
  [60_000, 1_000, "second"],
  [3_600_000, 60_000, "minute"],
  [86_400_000, 3_600_000, "hour"],
  [604_800_000, 86_400_000, "day"],
  [2_592_000_000, 604_800_000, "week"],
  [Number.POSITIVE_INFINITY, 2_592_000_000, "month"],
];

export function relativeTime(at: string | number, now = Date.now()): string {
  const timestamp = typeof at === "string" ? Date.parse(at) : at;
  const diff = timestamp - now;
  for (const [threshold, div, unit] of UNITS) {
    if (Math.abs(diff) < threshold) {
      return rtf.format(Math.round(diff / div), unit);
    }
  }
  return rtf.format(Math.round(diff / 2_592_000_000), "month");
}

export function shortPath(p: string, segments = 3): string {
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= segments) return p;
  return "…/" + parts.slice(-segments).join("/");
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
