import type { LogEntry } from "@pico/protocol";

type Assistant = Extract<LogEntry, { kind: "assistant" }>;

const endsTurn = (entry: LogEntry): entry is Assistant =>
  entry.kind === "assistant" && entry.stopReason !== undefined && entry.stopReason !== "toolUse";

const hasWords = (answer: Assistant) => answer.text.trim().length > 0;

export const isStep = (entry: LogEntry): boolean => entry.kind !== "user" && !endsTurn(entry);

const groupKeyAfter = (entry: LogEntry | undefined) => `steps:${entry?.id ?? "start"}`;

export function groupKeyOf(entries: readonly LogEntry[], id: string): string | undefined {
  let index = entries.findIndex((entry) => entry.id === id);
  if (index < 0 || !isStep(entries[index])) return undefined;
  while (index > 0 && isStep(entries[index - 1])) index -= 1;
  return groupKeyAfter(entries[index - 1]);
}

export type Steps = { kind: "steps"; key: string; entries: LogEntry[]; answeredInWords: boolean; durationMs?: number };
export type Segment = { kind: "entry"; entry: LogEntry } | Steps;

export function gatherSteps(entries: readonly LogEntry[]): Segment[] {
  const nextAnswerHasWords: boolean[] = [];
  for (let index = entries.length - 1, answered = false; index >= 0; index -= 1) {
    const entry = entries[index];
    if (endsTurn(entry)) answered = hasWords(entry);
    nextAnswerHasWords[index] = answered;
  }

  const segments: Segment[] = [];
  let group: Steps | undefined;
  let startedAt = 0;
  const closeGroupAt = (end: number) => {
    if (!group) return;
    const calledTools = group.entries.some((entry) => entry.kind === "tool_call");
    if (calledTools) {
      group.answeredInWords = nextAnswerHasWords[end] ?? false;
      if (group.answeredInWords) group.durationMs = entries[end].at - startedAt;
      segments.push(group);
    } else {
      for (const entry of group.entries) segments.push({ kind: "entry", entry });
    }
    group = undefined;
  };
  entries.forEach((entry, index) => {
    if (!isStep(entry)) {
      closeGroupAt(index);
      segments.push({ kind: "entry", entry });
    } else if (group) {
      group.entries.push(entry);
    } else {
      group = { kind: "steps", key: groupKeyAfter(entries[index - 1]), entries: [entry], answeredInWords: false };
      startedAt = entries[index - 1]?.at ?? entry.at;
    }
  });
  closeGroupAt(entries.length);
  return segments;
}

export interface StepsSummary {
  steps: number;
  filesChanged: number;
  commandsRun: number;
  failed: number;
}

export function summarizeSteps(entries: readonly LogEntry[]): StepsSummary {
  const changedPaths = new Set<string>();
  let steps = 0;
  let commandsRun = 0;
  let failed = 0;
  for (const entry of entries) {
    if (entry.kind !== "tool_call") continue;
    steps += 1;
    if (entry.status === "error") failed += 1;
    if (entry.toolKind !== "builtin") continue;
    if (entry.tool === "edit" || entry.tool === "write") changedPaths.add(entry.args.path);
    else if (entry.tool === "bash") commandsRun += 1;
  }
  return { steps, filesChanged: changedPaths.size, commandsRun, failed };
}
