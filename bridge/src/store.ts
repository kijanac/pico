import { Context, Effect, Layer, Option } from "effect";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import * as v from "valibot";
import {
  parseWireEvent,
  SessionStatus,
  type WireEvent,
} from "@pico/protocol";
import type { SessionRecord } from "./session-record.ts";


export class Store extends Context.Tag("Store")<
  Store,
  {
    readonly insertSession: (record: SessionRecord) => Effect.Effect<void>;
    readonly getSession: (id: string) => Effect.Effect<Option.Option<SessionRecord>>;
    readonly listSessions: (filter?: { archived?: boolean }) => Effect.Effect<SessionRecord[]>;
    readonly updateSession: (
      id: string,
      patch: Partial<SessionRecord>,
    ) => Effect.Effect<void>;
    readonly deleteSession: (id: string) => Effect.Effect<void>;

    readonly appendEvent: (
      sessionId: string,
      event: WireEvent,
    ) => Effect.Effect<void>;

    readonly loadEventsAfter: (
      sessionId: string,
      afterSeq: number,
    ) => Effect.Effect<WireEvent[]>;

    readonly maxSeq: (sessionId: string) => Effect.Effect<number>;

    readonly prunedThrough: (sessionId: string) => Effect.Effect<number>;

    readonly close: () => Effect.Effect<void>;
  }
>() {}


const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    cwd         TEXT NOT NULL,
    status      TEXT NOT NULL,
    updated_at  INTEGER NOT NULL,
    tokens_in   INTEGER NOT NULL DEFAULT 0,
    tokens_out  INTEGER NOT NULL DEFAULT 0,
    cost_usd    REAL    NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    archived    INTEGER NOT NULL DEFAULT 0
  ) STRICT;

  CREATE TABLE IF NOT EXISTS events (
    session_id  TEXT NOT NULL,
    seq         INTEGER NOT NULL,
    type        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (session_id, seq)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_events_session_seq
    ON events(session_id, seq);

  CREATE TABLE IF NOT EXISTS session_prune (
    session_id     TEXT PRIMARY KEY,
    pruned_through INTEGER NOT NULL
  ) STRICT;
`;

// Cap stored events per session so the events table (and reconnect replay)
// stays bounded. Clients whose cursor falls below the pruned boundary get a
// full log_reset instead of a stored replay.
const EVENTS_RETAIN_PER_SESSION = 5000;
const PRUNE_EVERY = 256;

const MIGRATIONS = [
  `ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`,
];


const SqlBool = v.pipe(v.number(), v.integer());

const SessionRow = v.object({
  id: v.string(),
  title: v.string(),
  cwd: v.string(),
  status: SessionStatus,
  updated_at: v.number(),
  tokens_in: v.number(),
  tokens_out: v.number(),
  cost_usd: v.number(),
  archived: SqlBool,
  created_at: v.number(),
});
type SessionRow = v.InferOutput<typeof SessionRow>;

const rowToRecord = (raw: unknown): SessionRecord => {
  const r = v.parse(SessionRow, raw);
  return {
    id: r.id,
    title: r.title,
    cwd: r.cwd,
    status: r.status,
    updatedAtMs: r.updated_at,
    tokens: { in: r.tokens_in, out: r.tokens_out },
    costUsd: r.cost_usd,
    archived: r.archived === 1,
  };
};


const make = (dbPath: string) =>
  Effect.gen(function* () {
    const db = yield* Effect.sync(() => {
      const d = new DatabaseSync(dbPath);
      d.exec("PRAGMA journal_mode = WAL");
      d.exec("PRAGMA synchronous = NORMAL");
      d.exec("PRAGMA foreign_keys = ON");

      d.exec(SCHEMA);
      for (const sql of MIGRATIONS) {
        try {
          d.exec(sql);
        } catch {
        }
      }

      return d;
    });

    const stmtUpsertSession: StatementSync = db.prepare(`
      INSERT OR REPLACE INTO sessions
        (id, title, cwd, status, updated_at,
         tokens_in, tokens_out, cost_usd, created_at, archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const stmtGetSession: StatementSync = db.prepare(
      `SELECT * FROM sessions WHERE id = ?`,
    );

    const stmtListActiveSessions: StatementSync = db.prepare(
      `SELECT * FROM sessions WHERE archived = 0 ORDER BY updated_at DESC`,
    );

    const stmtListArchivedSessions: StatementSync = db.prepare(
      `SELECT * FROM sessions WHERE archived = 1 ORDER BY updated_at DESC`,
    );

    const stmtDeleteSession: StatementSync = db.prepare(
      `DELETE FROM sessions WHERE id = ?`,
    );

    const stmtDeleteSessionEvents: StatementSync = db.prepare(
      `DELETE FROM events WHERE session_id = ?`,
    );

    const stmtInsertEvent: StatementSync = db.prepare(`
      INSERT INTO events (session_id, seq, type, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const stmtLoadEventsAfter: StatementSync = db.prepare(`
      SELECT payload FROM events
      WHERE session_id = ? AND seq > ?
      ORDER BY seq ASC
    `);

    const stmtMaxSeq: StatementSync = db.prepare(`
      SELECT COALESCE(MAX(seq), 0) AS m FROM events WHERE session_id = ?
    `);

    const stmtPruneEvents: StatementSync = db.prepare(
      `DELETE FROM events WHERE session_id = ? AND seq <= ?`,
    );

    const stmtSetPrunedThrough: StatementSync = db.prepare(
      `INSERT OR REPLACE INTO session_prune (session_id, pruned_through) VALUES (?, ?)`,
    );

    const stmtGetPrunedThrough: StatementSync = db.prepare(
      `SELECT pruned_through FROM session_prune WHERE session_id = ?`,
    );

    const stmtDeletePrune: StatementSync = db.prepare(
      `DELETE FROM session_prune WHERE session_id = ?`,
    );

    return Store.of({
      insertSession: (record) =>
        Effect.sync(() => {
          const now = Date.now();
          stmtUpsertSession.run(
            record.id,
            record.title,
            record.cwd,
            record.status,
            record.updatedAtMs,
            record.tokens.in,
            record.tokens.out,
            record.costUsd,
            now,
            record.archived ? 1 : 0,
          );
        }),

      getSession: (id) =>
        Effect.sync(() => {
          const row = stmtGetSession.get(id);
          return row ? Option.some(rowToRecord(row)) : Option.none();
        }),

      listSessions: (filter) =>
        Effect.sync(() => {
          const stmt = filter?.archived ? stmtListArchivedSessions : stmtListActiveSessions;
          return stmt.all().map(rowToRecord);
        }),

      updateSession: (id, patch) =>
        Effect.sync(() => {
          const existing = stmtGetSession.get(id);
          if (!existing) return;
          const merged = { ...rowToRecord(existing), ...patch };
          stmtUpsertSession.run(
            merged.id,
            merged.title,
            merged.cwd,
            merged.status,
            merged.updatedAtMs,
            merged.tokens.in,
            merged.tokens.out,
            merged.costUsd,
            existing.created_at,
            merged.archived ? 1 : 0,
          );
        }),

      deleteSession: (id) =>
        Effect.sync(() => {
          db.exec("BEGIN");
          try {
            stmtDeleteSessionEvents.run(id);
            stmtDeletePrune.run(id);
            stmtDeleteSession.run(id);
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
        }),

      appendEvent: (sessionId, event) =>
        Effect.sync(() => {
          stmtInsertEvent.run(
            sessionId,
            event.seq,
            event.t,
            JSON.stringify(event),
            Date.now(),
          );
          const boundary = event.seq - EVENTS_RETAIN_PER_SESSION;
          if (boundary > 0 && event.seq % PRUNE_EVERY === 0) {
            const result = stmtPruneEvents.run(sessionId, boundary);
            if (result.changes > 0) stmtSetPrunedThrough.run(sessionId, boundary);
          }
        }),

      loadEventsAfter: (sessionId, afterSeq) =>
        Effect.sync(() => {
          const rows = stmtLoadEventsAfter.all(sessionId, afterSeq) as Array<{
            payload: string;
          }>;
          return rows.map((r) => parseWireEvent(JSON.parse(r.payload)));
        }),

      maxSeq: (sessionId) =>
        Effect.sync(() => {
          const row = stmtMaxSeq.get(sessionId) as { m: number };
          return row.m;
        }),

      prunedThrough: (sessionId) =>
        Effect.sync(() => {
          const row = stmtGetPrunedThrough.get(sessionId) as
            | { pruned_through: number }
            | undefined;
          return row?.pruned_through ?? 0;
        }),

      close: () => Effect.sync(() => db.close()),
    });
  });

export const StoreLive = (dbPath: string) => Layer.effect(Store, make(dbPath));
