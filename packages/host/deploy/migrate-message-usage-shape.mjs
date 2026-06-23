#!/usr/bin/env node
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv[2] ?? process.env.PICO_HOST_DB ?? "/var/lib/pico-host/pico-host.db";

if (!existsSync(dbPath)) {
  console.error(`[message-usage-migration] database not found: ${dbPath}`);
  process.exit(1);
}

function migrateUsage(usage) {
  if (!usage || typeof usage !== "object") return [usage, false];
  if (typeof usage.totalTokens === "number") return [usage, false];
  if (typeof usage.total !== "number" || typeof usage.cost !== "number") return [usage, false];

  return [
    {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      totalTokens: usage.total,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: usage.cost,
      },
    },
    true,
  ];
}

function migrateAssistantPayload(payload) {
  const [usage, changed] = migrateUsage(payload.usage);
  if (!changed) return false;
  payload.usage = usage;
  return true;
}

function migrateLogResetPayload(payload) {
  if (!Array.isArray(payload.entries)) return false;

  let changed = false;
  for (const entry of payload.entries) {
    if (!entry || typeof entry !== "object" || entry.kind !== "assistant") continue;
    const [usage, usageChanged] = migrateUsage(entry.usage);
    if (!usageChanged) continue;
    entry.usage = usage;
    changed = true;
  }

  return changed;
}

function migratePayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.t === "assistant_end") return migrateAssistantPayload(payload);
  if (payload.t === "log_reset") return migrateLogResetPayload(payload);
  return false;
}

const db = new DatabaseSync(dbPath);
const rows = db.prepare(`
  SELECT session_id, seq, type, payload
  FROM events
  WHERE type IN ('assistant_end', 'log_reset')
  ORDER BY session_id, seq
`).all();
const update = db.prepare("UPDATE events SET payload = ? WHERE session_id = ? AND seq = ?");

let changed = 0;
let skipped = 0;

db.exec("BEGIN");
try {
  for (const row of rows) {
    let payload;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      skipped += 1;
      continue;
    }

    if (!migratePayload(payload)) continue;
    update.run(JSON.stringify(payload), row.session_id, row.seq);
    changed += 1;
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

console.log(`[message-usage-migration] migrated=${changed} skipped=${skipped} scanned=${rows.length} db=${dbPath}`);
