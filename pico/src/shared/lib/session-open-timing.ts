export type SessionOpenPhase =
  | "tap"
  | "route-mounted"
  | "state-start"
  | "stream-start"
  | "ws-connected"
  | "hello"
  | "first-render";

export interface SessionOpenReport {
  sessionId: string;
  complete: boolean;
  totalMs: number;
  deltas: Partial<Record<SessionOpenPhase, number>>;
}

const phaseOrder: SessionOpenPhase[] = [
  "tap",
  "route-mounted",
  "state-start",
  "stream-start",
  "ws-connected",
  "hello",
  "first-render",
];

interface TimingRecord {
  sessionId: string;
  startedAt: number;
  complete: boolean;
  marks: Partial<Record<SessionOpenPhase, number>>;
}

const records = new Map<string, TimingRecord>();

function reports(): SessionOpenReport[] | null {
  if (typeof window === "undefined") return null;
  const target = window as Window & { __picoSessionOpenTimings?: SessionOpenReport[] };
  target.__picoSessionOpenTimings ??= [];
  return target.__picoSessionOpenTimings;
}

function toReport(record: TimingRecord, complete: boolean): SessionOpenReport {
  const base = record.marks.tap ?? record.marks["route-mounted"] ?? record.startedAt;
  const deltas: Partial<Record<SessionOpenPhase, number>> = {};
  for (const phase of phaseOrder) {
    const mark = record.marks[phase];
    if (mark !== undefined) deltas[phase] = Math.round(mark - base);
  }

  const latest = Math.max(...Object.values(record.marks).filter((mark) => mark !== undefined));
  return {
    sessionId: record.sessionId,
    complete,
    totalMs: Number.isFinite(latest) ? Math.round(latest - base) : 0,
    deltas,
  };
}

function publish(record: TimingRecord, complete: boolean): SessionOpenReport {
  const report = toReport(record, complete);
  const list = reports();
  if (list) {
    let index = -1;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].sessionId === record.sessionId) {
        index = i;
        break;
      }
    }
    if (index === -1) list.push(report);
    else list[index] = report;
  }
  return report;
}

export function markSessionOpen(sessionId: string, phase: SessionOpenPhase): void {
  const now = performance.now();
  let record = records.get(sessionId);
  if (!record || phase === "tap" || (phase === "route-mounted" && record.complete)) {
    record = { sessionId, startedAt: now, complete: false, marks: {} };
    records.set(sessionId, record);
  }
  if (record.complete && phase !== "tap" && phase !== "route-mounted") return;

  record.marks[phase] = now;
  performance.mark(`pico.session-open.${phase}.${sessionId}`);

  const complete = record.marks.hello !== undefined && record.marks["first-render"] !== undefined;
  record.complete = complete;
  const report = publish(record, complete);
  if (complete || phase === "hello") {
    console.info(`[pico] session open ${sessionId.slice(0, 8)}`, report);
  }
}
