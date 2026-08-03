/**
 * Manifest-diff reindexing: walks docs/knowledge-base/, compares each file's
 * mtime against what's already indexed (the `documents` table doubles as
 * its own manifest — no separate manifest file needed), and only touches
 * what actually changed. Called from two independent triggers sharing this
 * one function: once at plugin load (this phase), and — from Phase 4 — live
 * via a chokidar watcher while the plugin is running.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDb, KB_SOURCE_DIR } from './db';
import { ingestFile, isSupportedFormat, removeFile } from './ingest';

export interface ReindexResult {
  indexed: number;
  removed: number;
  skipped: number;
  unsupported: number;
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    // entry.name comes from fs.readdirSync's own directory listing, not external input — the OS can't return '../' as an entry name.
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

export async function reindex(): Promise<ReindexResult> {
  const db = getDb();
  const files = walk(KB_SOURCE_DIR);

  const known = db.prepare('SELECT source_file, mtime_ms FROM documents').all() as {
    source_file: string;
    mtime_ms: number;
  }[];
  const knownMtimes = new Map(known.map((r) => [r.source_file, r.mtime_ms]));

  let indexed = 0;
  let skipped = 0;
  let unsupported = 0;
  const seen = new Set<string>();

  for (const file of files) {
    if (!isSupportedFormat(file)) {
      unsupported++;
      continue;
    }
    seen.add(file);

    const mtimeMs = fs.statSync(file).mtimeMs;
    const prevMtime = knownMtimes.get(file);
    if (prevMtime !== undefined && prevMtime === mtimeMs) {
      skipped++;
      continue;
    }

    try {
      await ingestFile(db, file, mtimeMs);
      indexed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[camunda-mcp][kb] Failed to ingest ${file}: ${message}`);
    }
  }

  let removed = 0;
  for (const knownFile of knownMtimes.keys()) {
    if (!seen.has(knownFile)) {
      removeFile(db, knownFile);
      removed++;
    }
  }

  return { indexed, removed, skipped, unsupported };
}
