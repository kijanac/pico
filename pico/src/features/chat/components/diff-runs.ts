import { diffLines } from "diff/lib/diff/line.js";

export type DiffRun = {
  kind: "add" | "remove" | "context";
  oldLine: number | null;
  newLine: number | null;
  count: number;
  text: string;
};

const DIFF_TIMEOUT_MS = 100;

function lineCount(text: string): number {
  if (!text) return 0;
  let count = text.endsWith("\n") ? 0 : 1;
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) count += 1;
  return count;
}

export function diffRuns(before: string, after: string): DiffRun[] {
  const chunks = diffLines(before, after, { timeout: DIFF_TIMEOUT_MS }) ?? [
    { value: before, added: false, removed: true, count: lineCount(before) },
    { value: after, added: true, removed: false, count: lineCount(after) },
  ];
  let oldLine = 1;
  let newLine = 1;
  return chunks.flatMap((chunk): DiffRun[] => {
    const count = chunk.count ?? lineCount(chunk.value);
    if (!count) return [];
    const kind = chunk.added ? "add" : chunk.removed ? "remove" : "context";
    const run: DiffRun = { kind, oldLine: chunk.added ? null : oldLine, newLine: chunk.removed ? null : newLine, count, text: chunk.value };
    if (!chunk.added) oldLine += count;
    if (!chunk.removed) newLine += count;
    return [run];
  });
}

export function runLineNumbers(run: DiffRun): string {
  const start = run.newLine ?? run.oldLine ?? 1;
  return Array.from({ length: run.count }, (_, index) => start + index).join("\n");
}
