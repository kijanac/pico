import { Context, Effect, Layer, Option } from "effect";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  parseSessionMeta,
  parseWireEvent,
  type SessionMeta,
  type WireEvent,
} from "@pi-mobile/protocol";


export class Store extends Context.Tag("Store")<
  Store,
  {
    readonly insertSession: (meta: SessionMeta) => Effect.Effect<void>;
    readonly getSession: (id: string) => Effect.Effect<Option.Option<SessionMeta>>;
    readonly listSessions: () => Effect.Effect<SessionMeta[]>;
    readonly updateSession: (
      id: string,
      patch: Partial<SessionMeta>,
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

    readonly close: () => Effect.Effect<void>;
  }
>() {}


const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    cwd         TEXT NOT NULL,
    worktree_cwd TEXT,
    branch      TEXT,
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
`;

const MIGRATIONS = [
  `ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE sessions ADD COLUMN worktree_cwd TEXT`,
];


type SqlValue = string | number | bigint | null | Uint8Array;
type SqlRow = Record<string, SqlValue>;

const rowToMeta = (r: SqlRow): SessionMeta =>
  parseSessionMeta({
    id: r.id,
    title: r.title,
    cwd: r.cwd,
    worktreeCwd: r.worktree_cwd ?? undefined,
    branch: r.branch ?? undefined,
    status: r.status,
    updatedAt: r.updated_at,
    tokens: { in: r.tokens_in, out: r.tokens_out },
    costUsd: r.cost_usd,
    archived: r.archived === 1,
  });


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
        (id, title, cwd, worktree_cwd, branch, status, updated_at,
         tokens_in, tokens_out, cost_usd, created_at, archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const stmtGetSession: StatementSync = db.prepare(
      `SELECT * FROM sessions WHERE id = ?`,
    );

    const stmtListSessions: StatementSync = db.prepare(
      `SELECT * FROM sessions WHERE archived = 0 ORDER BY updated_at DESC`,
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

    return Store.of({
      insertSession: (meta) =>
        Effect.sync(() => {
          const now = Date.now();
          stmtUpsertSession.run(
            meta.id,
            meta.title,
            meta.cwd,
            meta.worktreeCwd ?? null,
            meta.branch ?? null,
            meta.status,
            meta.updatedAt,
            meta.tokens.in,
            meta.tokens.out,
            meta.costUsd,
            now,
            meta.archived ? 1 : 0,
          );
        }),

      getSession: (id) =>
        Effect.sync(() => {
          const row = stmtGetSession.get(id);
          return row ? Option.some(rowToMeta(row)) : Option.none();
        }),

      listSessions: () =>
        Effect.sync(() => {
          const rows = stmtListSessions.all() as SqlRow[];
          return rows.map(rowToMeta);
        }),

      updateSession: (id, patch) =>
        Effect.sync(() => {
          const existing = stmtGetSession.get(id);
          if (!existing) return;
          const merged = { ...rowToMeta(existing), ...patch };
          stmtUpsertSession.run(
            merged.id,
            merged.title,
            merged.cwd,
            merged.worktreeCwd ?? null,
            merged.branch ?? null,
            merged.status,
            merged.updatedAt,
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

      close: () => Effect.sync(() => db.close()),
    });
  });

export const StoreLive = (dbPath: string) => Layer.effect(Store, make(dbPath));
