import * as FileSystem from "@effect/platform/FileSystem";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { SessionStatus } from "@pico/protocol";
import type { FileSession, SessionFile, SessionRecord } from "./session-record.ts";


export class Store extends Context.Tag("Store")<
  Store,
  {
    readonly insertSession: (record: SessionRecord) => Effect.Effect<void>;
    readonly getSession: (id: string) => Effect.Effect<Option.Option<SessionRecord>>;
    readonly listSessions: (filter?: { archived?: boolean }) => Effect.Effect<SessionRecord[]>;
    readonly updateSession: (
      id: string,
      patch: Partial<Pick<SessionRecord, "title" | "status" | "updatedAtMs" | "tokens" | "costUsd" | "archived">>,
    ) => Effect.Effect<void>;
    readonly deleteSession: (id: string) => Effect.Effect<void>;
    // The pi session files indexed so far, with their sessions' ids.
    readonly indexedFiles: () => Effect.Effect<(SessionFile & { id: string })[]>;
    // Adds or refreshes a session from its pi file; status and archived stay Pico's.
    readonly indexFile: (file: SessionFile, session: FileSession) => Effect.Effect<void>;
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
    archived    INTEGER NOT NULL DEFAULT 0,
    path        TEXT,
    stamp       TEXT
  ) STRICT;

  -- The event journal, replaced by pi's own session files.
  DROP TABLE IF EXISTS events;
  DROP TABLE IF EXISTS session_prune;
`;

const SessionRow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  cwd: Schema.String,
  status: SessionStatus,
  updated_at: Schema.Number,
  tokens_in: Schema.Number,
  tokens_out: Schema.Number,
  cost_usd: Schema.Number,
  archived: Schema.Int,
  created_at: Schema.Number,
  path: Schema.NullOr(Schema.String),
});

const decodeRow = Schema.decodeUnknownSync(SessionRow);

const decodeIndexedFile = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, path: Schema.String, stamp: Schema.String }));

const rowToRecord = (raw: unknown): SessionRecord => {
  const r = decodeRow(raw);
  return {
    id: r.id,
    title: r.title,
    cwd: r.cwd,
    status: r.status,
    updatedAtMs: r.updated_at,
    tokens: { in: r.tokens_in, out: r.tokens_out },
    costUsd: r.cost_usd,
    archived: r.archived === 1,
    path: r.path,
  };
};


const make = (dbPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(dirname(dbPath), { recursive: true });

    const db = yield* Effect.acquireRelease(Effect.sync(() => {
      const d = new DatabaseSync(dbPath);
      d.exec("PRAGMA journal_mode = WAL");
      d.exec("PRAGMA synchronous = NORMAL");
      // Checkpoint WAL every ~2MB to keep the side file small.
      d.exec("PRAGMA wal_autocheckpoint = 500");

      d.exec(SCHEMA);
      // Tables from before the list was filled from pi's files.
      const columns = d.prepare("SELECT name FROM pragma_table_info('sessions')").all().map((column) => column.name);
      if (!columns.includes("path")) d.exec("ALTER TABLE sessions ADD COLUMN path TEXT; ALTER TABLE sessions ADD COLUMN stamp TEXT");

      // Non-terminal status from a prior (possibly crashed) run is stale at
      // boot; without this reset a session caught mid-turn shows a perpetual
      // "thinking" dot until reopened.
      d.exec("UPDATE sessions SET status = 'idle' WHERE status IN ('thinking', 'tool', 'waiting')");

      return d;
    }), (d) => Effect.sync(() => d.close()));

    const stmtInsertSession: StatementSync = db.prepare(`
      INSERT INTO sessions
        (id, title, cwd, status, updated_at,
         tokens_in, tokens_out, cost_usd, created_at, archived, path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const stmtIndexFile: StatementSync = db.prepare(`
      INSERT INTO sessions
        (id, title, cwd, status, updated_at,
         tokens_in, tokens_out, cost_usd, created_at, archived, path, stamp)
      VALUES (?, ?, ?, 'idle', ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        title = excluded.title,
        cwd = excluded.cwd,
        updated_at = MAX(updated_at, excluded.updated_at),
        tokens_in = excluded.tokens_in,
        tokens_out = excluded.tokens_out,
        cost_usd = excluded.cost_usd,
        path = excluded.path,
        stamp = excluded.stamp
    `);

    const stmtIndexedFiles: StatementSync = db.prepare(
      `SELECT id, path, stamp FROM sessions WHERE path IS NOT NULL`,
    );

    // Writes only the given columns (NULL keeps the current value), so
    // concurrent updates of different fields can't overwrite each other.
    const stmtUpdateSession: StatementSync = db.prepare(`
      UPDATE sessions SET
        title = COALESCE(?, title),
        status = COALESCE(?, status),
        updated_at = COALESCE(?, updated_at),
        tokens_in = COALESCE(?, tokens_in),
        tokens_out = COALESCE(?, tokens_out),
        cost_usd = COALESCE(?, cost_usd),
        archived = COALESCE(?, archived)
      WHERE id = ?
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

    return Store.of({
      insertSession: (record) =>
        Effect.sync(() => {
          const now = Date.now();
          stmtInsertSession.run(
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
            record.path,
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
          stmtUpdateSession.run(
            patch.title ?? null,
            patch.status ?? null,
            patch.updatedAtMs ?? null,
            patch.tokens?.in ?? null,
            patch.tokens?.out ?? null,
            patch.costUsd ?? null,
            patch.archived === undefined ? null : patch.archived ? 1 : 0,
            id,
          );
        }),

      deleteSession: (id) =>
        Effect.sync(() => {
          stmtDeleteSession.run(id);
        }),

      indexedFiles: () =>
        Effect.sync(() => stmtIndexedFiles.all().map((row) => decodeIndexedFile(row))),

      indexFile: (file, session) =>
        Effect.sync(() => {
          stmtIndexFile.run(
            session.id,
            session.title,
            session.cwd,
            session.updatedAtMs,
            session.tokens.in,
            session.tokens.out,
            session.costUsd,
            Date.now(),
            file.path,
            file.stamp,
          );
        }),
    });
  });

export const StoreLive = (dbPath: string) => Layer.scoped(Store, make(dbPath));
