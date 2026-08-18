/**
 * PDF extractor — package: pdfjs-dist. Extracts the PDF's text layer;
 * works for anything with real text, not a scanned-only image (those need
 * the image OCR extractor instead).
 *
 * pdfjs-dist ships ESM-only (no CommonJS build) — a dynamic import()
 * works from this CommonJS module regardless, since Node's CJS loader
 * supports importing ESM natively. Using the `legacy` build specifically:
 * pdfjs-dist's own docs recommend it for Node.js (no DOM assumed), vs. the
 * main build which targets browsers.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ExtractedDoc {
  title: string;
  body: string;
}

export async function extractPdf(filePath: string): Promise<ExtractedDoc> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));

  const loadingTask = pdfjs.getDocument({ data, useWorkerFetch: false });
  const pdf = await loadingTask.promise;

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    pageTexts.push(pageText);
  }
  await loadingTask.destroy();

  const title = path.basename(filePath, path.extname(filePath));
  const body = pageTexts.join('\n\n');
  return { title, body };
}
