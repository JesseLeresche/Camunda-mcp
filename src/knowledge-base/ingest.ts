/**
 * Per-file ingestion: extracts text (via the format-appropriate extractor),
 * then writes/replaces one row per document (Phase 1 whole-document
 * granularity — see docs/kb-architecture/architecture.md).
 */

import * as path from 'path';
import type Database from 'better-sqlite3';
import { extractMarkdown, type ExtractedDoc } from './extractors/markdown';

/** One extractor per supported format — Phase 3 adds .pdf, .bpmn/.xml, .png/.jpg here. */
const EXTRACTORS: Record<string, (filePath: string) => ExtractedDoc> = {
  '.md': extractMarkdown,
};

export function isSupportedFormat(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() in EXTRACTORS;
}

/**
 * Ingests (or re-ingests) a single file: removes any existing row for that
 * source file, then inserts a fresh one. Silently no-ops on unsupported
 * formats so reindex()'s directory walk doesn't need to pre-filter.
 */
export function ingestFile(db: Database.Database, filePath: string, mtimeMs: number): void {
  const ext = path.extname(filePath).toLowerCase();
  const extractor = EXTRACTORS[ext];
  if (!extractor) return;

  const { title, body } = extractor(filePath);

  removeFile(db, filePath);

  const info = db
    .prepare(
      `INSERT INTO documents (title, source_file, source_format, mtime_ms, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(title, filePath, ext.slice(1), mtimeMs, new Date().toISOString());

  db.prepare(`INSERT INTO documents_fts (rowid, title, body) VALUES (?, ?, ?)`).run(
    info.lastInsertRowid,
    title,
    body
  );
}

/** Removes a document (and its FTS row) by source file path, if present. */
export function removeFile(db: Database.Database, filePath: string): void {
  const existing = db.prepare('SELECT id FROM documents WHERE source_file = ?').get(filePath) as
    | { id: number }
    | undefined;
  if (!existing) return;

  db.prepare('DELETE FROM documents_fts WHERE rowid = ?').run(existing.id);
  db.prepare('DELETE FROM documents WHERE id = ?').run(existing.id);
}
