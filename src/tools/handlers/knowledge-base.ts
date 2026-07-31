import { getDb } from '../../knowledge-base/db';
import { kbSearchSchema } from '../registry';
import type { CallToolResult } from '../handlers';

/**
 * kb_search — FTS5 MATCH query with bm25() ranking, returning cited,
 * highlighted excerpts rather than full documents.
 */
export async function kbSearch(params: Record<string, unknown>): Promise<CallToolResult> {
  const parsed = kbSearchSchema.parse(params);
  const db = getDb();

  let rows: Array<{ title: string; sourceFile: string; sourceFormat: string; snippet: string }>;
  try {
    rows = db
      .prepare(
        `SELECT d.title AS title, d.source_file AS sourceFile, d.source_format AS sourceFormat,
                snippet(documents_fts, 1, '**', '**', '…', 12) AS snippet
         FROM documents_fts
         JOIN documents d ON d.id = documents_fts.rowid
         WHERE documents_fts MATCH ?
         ORDER BY bm25(documents_fts)
         LIMIT ?`
      )
      .all(parsed.query, parsed.limit) as typeof rows;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Search query failed: ${message}` }) }],
      isError: true,
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify({ results: rows, count: rows.length }) }],
  };
}
