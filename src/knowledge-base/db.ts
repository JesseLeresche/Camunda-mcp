/**
 * SQLite FTS5 connection and schema for the knowledge base (Tier B1).
 *
 * The database is a generated artifact, never checked into git and never
 * shipped — nothing in it is irreplaceable, every row is regenerable from
 * the source files in docs/knowledge-base/. That's also why schema changes
 * don't need real migrations: on a version mismatch we just drop and
 * rebuild rather than ALTER in place.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// src/knowledge-base/db.ts -> dist/knowledge-base/db.js at runtime; two
// levels up from dist/knowledge-base/ reaches the repo root.
const ROOT_DIR = path.join(__dirname, '..', '..');

/** Source content a teammate drops files into — never touched by this module directly. */
export const KB_SOURCE_DIR = path.join(ROOT_DIR, 'docs', 'knowledge-base');

// Deliberately outside KB_SOURCE_DIR: once Phase 4 adds a live file watcher
// on that folder, a database living inside it would see its own writes and
// reindex-loop.
const DB_DIR = path.join(ROOT_DIR, '.data');
const DB_PATH = path.join(DB_DIR, 'knowledge-base.sqlite');

const SCHEMA_VERSION = '1';

let dbInstance: Database.Database | null = null;

/**
 * Returns the shared database connection, creating and schema-initializing
 * it on first call.
 */
export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  initSchema(db);

  dbInstance = db;
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)`);

  const row = db.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;

  if (row && row.value !== SCHEMA_VERSION) {
    // Schema shape changed since this DB was built — rebuild from scratch
    // rather than migrate in place (see module doc comment for why that's
    // safe here specifically).
    db.exec(`DROP TABLE IF EXISTS documents_fts; DROP TABLE IF EXISTS documents;`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source_file TEXT NOT NULL UNIQUE,
      source_format TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(title, body);
  `);

  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(SCHEMA_VERSION);
}
