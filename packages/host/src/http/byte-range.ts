export type ByteRange = { kind: "full" } | { kind: "partial"; start: number; end: number } | { kind: "invalid" };

export function parseByteRange(header: string | undefined, size: number): ByteRange {
  if (header === undefined) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return { kind: "invalid" };
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return { kind: "invalid" };
  const start = match[1] ? first : Math.max(0, size - last);
  const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1;
  if ((!match[1] && last === 0) || start >= size || end < start) return { kind: "invalid" };
  return { kind: "partial", start, end };
}
