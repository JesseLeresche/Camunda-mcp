/**
 * Image OCR extractor — package: tesseract.js. Recovers visible text
 * labels from a diagram photo/screenshot; no understanding of the
 * diagram's structure or meaning (see docs/kb-architecture/architecture.md's
 * "Future considerations" for the vision-model alternative, deliberately
 * not built).
 *
 * The OCR engine itself (tesseract.js-core, WASM) is a normal local npm
 * dependency — no network involved. The one exception: the English
 * language-training data (~15MB) is not bundled in the npm package and
 * defaults to a one-time download from jsdelivr's CDN the first time an
 * image is processed, cached locally (via tesseract.js's own cache) for
 * every use after that — not a per-file or per-query cost, just a one-time
 * bootstrap the first time this extractor actually runs.
 */

import * as path from 'path';
import { createWorker } from 'tesseract.js';

export interface ExtractedDoc {
  title: string;
  body: string;
}

export async function extractImage(filePath: string): Promise<ExtractedDoc> {
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(filePath);
    const title = path.basename(filePath, path.extname(filePath));
    return { title, body: data.text.trim() };
  } finally {
    await worker.terminate();
  }
}
