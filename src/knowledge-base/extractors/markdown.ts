/**
 * Markdown extractor — no package, used as-is. Markdown is already plain
 * text, so there's no parsing step; the only work here is picking a title.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ExtractedDoc {
  title: string;
  body: string;
}

export function extractMarkdown(filePath: string): ExtractedDoc {
  const body = fs.readFileSync(filePath, 'utf-8');
  const heading = body.match(/^#\s+(.+)$/m);
  const title = heading ? heading[1].trim() : path.basename(filePath, path.extname(filePath));
  return { title, body };
}
