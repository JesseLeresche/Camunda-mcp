/**
 * Live file watcher — the second of reindex()'s two triggers (see
 * reindex.ts). Watches docs/knowledge-base/ so a file dropped in, edited,
 * or removed while Modeler is already running gets picked up without a
 * restart, on top of the plugin-load reindex that covers changes made
 * while it wasn't running.
 *
 * Any add/change/unlink re-runs the same manifest-diff reindex() rather
 * than touching just the one file that fired the event — cheap at this
 * corpus's scale (no ML inference step, see docs/kb-architecture/
 * architecture.md's "Why FTS5 not vector search") and it keeps this module
 * from having to duplicate reindex()'s add/remove logic. A short debounce
 * coalesces a burst of events (e.g. several files added by a git pull)
 * into a single reindex() pass instead of one per file.
 *
 * The generated SQLite DB lives in .data/, outside docs/knowledge-base/
 * (see db.ts), so the watcher never sees its own writes and can't loop.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import { KB_SOURCE_DIR } from './db';
import { reindex } from './reindex';

const LOG_PREFIX = '[camunda-mcp][kb]';
const DEBOUNCE_MS = 500;

let watcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReindex(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    reindex()
      .then(({ indexed, removed, skipped, unsupported }) => {
        console.log(
          `${LOG_PREFIX} Live reindex: ${indexed} indexed, ${removed} removed, `
          + `${skipped} unchanged, ${unsupported} unsupported format(s) skipped`
        );
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error('%s Live reindex failed:', LOG_PREFIX, message);
      });
  }, DEBOUNCE_MS);
}

/**
 * Starts watching docs/knowledge-base/ for add/change/unlink events.
 * Safe to call once at plugin load; a second call is a no-op if a watcher
 * is already running.
 */
export function startKnowledgeBaseWatcher(): void {
  if (watcher) return;

  watcher = chokidar.watch(KB_SOURCE_DIR, {
    ignoreInitial: true, // the plugin-load reindex() call already covers existing files
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  watcher
    .on('add', scheduleReindex)
    .on('change', scheduleReindex)
    .on('unlink', scheduleReindex)
    .on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('%s Knowledge base watcher error:', LOG_PREFIX, message);
    });

  console.log(`${LOG_PREFIX} Watching ${KB_SOURCE_DIR} for changes`);
}

/** Stops the watcher, if running. Used for graceful shutdown. */
export async function stopKnowledgeBaseWatcher(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}
