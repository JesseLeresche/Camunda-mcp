/**
 * Per-file ingestion: extracts text (via the format-appropriate extractor),
 * then writes/replaces one row per document (Phase 1 whole-document
 * granularity — see docs/kb-architecture/architecture.md).
 */

import * as path from 'path';
import type Database from 'better-sqlite3';
import { extractMarkdown, type ExtractedDoc } from './extractors/markdown';
import { extractPdf } from './extractors/pdf';
import { extractBpmnXml } from './extractors/bpmn-xml';
import { extractImage } from './extractors/image';

/** One extractor per supported format, keyed by file extension. */
const EXTRACTORS: Record<string, (filePath: string) => ExtractedDoc | Promise<ExtractedDoc>> = {
  '.md': extractMarkdown,
  '.pdf': extractPdf,
  '.bpmn': extractBpmnXml,
  '.xml': extractBpmnXml,
  '.png': extractImage,
  '.jpg': extractImage,
  '.jpeg': extractImage,
};

export function isSupportedFormat(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() in EXTRACTORS;
}

/**
 * Ingests (or re-ingests) a single file: removes any existing row for that
 * source file, then inserts a fresh one. Silently no-ops on unsupported
 * formats so reindex()'s directory walk doesn't need to pre-filter.
 */
export async function ingestFile(db: Database.Database, filePath: string, mtimeMs: number): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  const extractor = EXTRACTORS[ext];
  if (!extractor) return;

  const { title, body } = await extractor(filePath);

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
