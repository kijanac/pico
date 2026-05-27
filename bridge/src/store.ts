/**
 * Durable store — Node's built-in `node:sqlite` (Node 24+, RC as of v25.7).
 *
 * Schema:
 *   sessions(id, title, cwd, branch, status, updated_at,
 *            tokens_in, tokens_out, cost_usd, created_at)
 *   events  (session_id, seq, type, payload, created_at)  PK (session_id, seq)
 *
 * Notes on the design choices:
 *
 *  - No `last_seq` column. The session's current seq is `MAX(seq)` of its
 *    events, computed once on attach and tracked in-memory thereafter. This
 *    removes the need for a transaction around event insert + counter bump.
 *
 *  - DatabaseSync is synchronous (good — pairs with Effect.sync directly).
 *    All operations are wrapped via Effect.sync; the runtime treats them as
 *    point-in-time effects without async overhead.
 *
 *  - WAL mode for concurrent reads, NORMAL sync for performance. Repeatable
 *    reads aren't a requirement here — single writer, snapshotting reads.
 */
import { Context, Effect, Layer, Option } from "effect";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { SessionMeta, WireEvent } from "@pi-mobile/protocol";

/* ── tag ─────────────────────────────────────────────────────────────── */

export class Store extends Context.Tag("Store")<
  Store,
  {
    readonly insertSession: (meta: SessionMeta) => Effect.Effect<void>;
    readonly getSession: (id: string) => Effect.Effect<Option.Option<SessionMeta>>;
    readonly listSessions: () => Effect.Effect<ReadonlyArray<SessionMeta>>;
    readonly updateSession: (
      id: string,
      patch: Partial<SessionMeta>,
    ) => Effect.Effect<void>;
    readonly deleteSession: (id: string) => Effect.Effect<void>;

    /** Append an event. Caller owns seq assignment (single-writer per session). */
    readonly appendEvent: (
      sessionId: string,
      event: WireEvent,
    ) => Effect.Effect<void>;

    /** Events with seq > `afterSeq`, in order. */
    readonly loadEventsAfter: (
      sessionId: string,
      afterSeq: number,
    ) => Effect.Effect<ReadonlyArray<WireEvent>>;

    /** Highest seq written for `sessionId`, or 0 if none. */
    readonly maxSeq: (sessionId: string) => Effect.Effect<number>;

    readonly close: () => Effect.Effect<void>;
  }
>() {}

/* ── schema ──────────────────────────────────────────────────────────── */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    cwd         TEXT NOT NULL,
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

/**
 * Schema migrations applied after the base CREATE statements.
 *
 * Each entry runs once at startup; failures are swallowed because the
 * typical reason is "column already exists" on an upgraded DB. Anything
 * that *must* succeed (constraint additions, data backfills) should be
 * its own first-class step with explicit error handling — not a member
 * of this list.
 */
const MIGRATIONS: ReadonlyArray<string> = [
  // Added when session archiving shipped (Tier 2 polish). Old DBs that
  // were created before this column existed get it tacked on; new DBs
  // already have it from SCHEMA above and this ALTER fails harmlessly.
  `ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`,
];

/* ── row mapping ─────────────────────────────────────────────────────── */

/** Mirrors node:sqlite's module-private SQLOutputValue. */
type SqlValue = string | number | bigint | null | Uint8Array;
type SqlRow = Record<string, SqlValue>;

/**
 * Convert a raw sqlite row to SessionMeta. Accepts the lazy
 * `Record<string, SqlValue>` shape that node:sqlite hands back, and
 * narrows each field individually. Per-field casts are legitimate union
 * narrowings (SqlValue → constituent type), so no `as unknown` is
 * needed and call sites don't have to cast at all.
 */
const rowToMeta = (r: SqlRow): SessionMeta => ({
  id: r.id as string,
  title: r.title as string,
  cwd: r.cwd as string,
  branch: ((r.branch as string | null) ?? undefined) as string | undefined,
  status: r.status as SessionMeta["status"],
  updatedAt: r.updated_at as number,
  tokens: { in: r.tokens_in as number, out: r.tokens_out as number },
  costUsd: r.cost_usd as number,
  archived: (r.archived as number) === 1,
});

/* ── implementation ─────────────────────────────────────────────────── */

const make = (dbPath: string) =>
  Effect.gen(function* () {
    const db = yield* Effect.sync(() => {
      const d = new DatabaseSync(dbPath);
      // node:sqlite doesn't have a dedicated .pragma() helper — use exec.
      d.exec("PRAGMA journal_mode = WAL");
      d.exec("PRAGMA synchronous = NORMAL");
      d.exec("PRAGMA foreign_keys = ON");
      d.exec(SCHEMA);
      // Apply additive migrations. Each statement is wrapped in its own
      // try/catch so a column-exists error from one doesn't skip the rest.
      for (const sql of MIGRATIONS) {
        try {
          d.exec(sql);
        } catch {
          // Expected on already-migrated DBs.
        }
      }
      return d;
    });

    /* prepared statements */
    const stmtUpsertSession: StatementSync = db.prepare(`
      INSERT OR REPLACE INTO sessions
        (id, title, cwd, branch, status, updated_at,
         tokens_in, tokens_out, cost_usd, created_at, archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const stmtGetSession: StatementSync = db.prepare(
      `SELECT * FROM sessions WHERE id = ?`,
    );

    // Archived sessions are excluded from the default list — they live
    // in a separate "archive" view (not yet built; the column is there
    // ready for it). The boolean is read as a number per SQLite STRICT.
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
        Effect.sync(
          () =>
            stmtListSessions.all().map(rowToMeta) as ReadonlyArray<SessionMeta>,
        ),

      updateSession: (id, patch) =>
        Effect.sync(() => {
          const existing = stmtGetSession.get(id);
          if (!existing) return;
          const merged = { ...rowToMeta(existing), ...patch };
          stmtUpsertSession.run(
            merged.id,
            merged.title,
            merged.cwd,
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

      // Hard delete — events first, then the session row, wrapped in a
      // transaction so a crash mid-delete can't leave orphaned events.
      // The events table has no FK (see schema), so cascade isn't an
      // option; we do it explicitly here.
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
          return rows.map((r) => JSON.parse(r.payload) as WireEvent);
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
