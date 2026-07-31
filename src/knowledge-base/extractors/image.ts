/**
 * Image OCR extractor — package: tesseract.js. Recovers visible text
 * labels from a diagram photo/screenshot; no understanding of the
 * diagram's structure or meaning (see docs/kb-architecture/architecture.md's
 * "Future considerations" for the vision-model alternative, deliberately
 * not built).
 *
 * The English language-training data (assets/tessdata/eng.traineddata,
 * ~5MB) is vendored directly into this repo/package rather than left to
 * tesseract.js's default behavior (a one-time download from jsdelivr's CDN
 * on first use). Passing `cachePath` pointing at that folder makes
 * tesseract.js treat it as an already-populated cache, so it's read
 * straight off disk and the CDN code path is never reached — zero network
 * calls, not even a one-time bootstrap, consistent with every other
 * extractor in this pipeline. Re-vendor by deleting the file and letting
 * tesseract.js re-download it once (it writes back to `cachePath`) if a
 * newer trained-data release is ever needed.
 */

import * as path from 'path';
import { createWorker } from 'tesseract.js';

export interface ExtractedDoc {
  title: string;
  body: string;
}

const TESSDATA_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'tessdata');

export async function extractImage(filePath: string): Promise<ExtractedDoc> {
  const worker = await createWorker('eng', 1, { cachePath: TESSDATA_DIR });
  try {
    const { data } = await worker.recognize(filePath);
    const title = path.basename(filePath, path.extname(filePath));
    return { title, body: data.text.trim() };
  } finally {
    await worker.terminate();
  }
}
