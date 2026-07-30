/**
 * BPMN XML extractor — no package. BPMN's structure is small and
 * predictable enough (name= attributes, <documentation> tags) that a full
 * XML parsing library isn't needed; exact values pulled directly via regex,
 * not guessed.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ExtractedDoc {
  title: string;
  body: string;
}

export function extractBpmnXml(filePath: string): ExtractedDoc {
  const xml = fs.readFileSync(filePath, 'utf-8');

  // Every element's name="..." attribute (task labels, pool/lane names,
  // gateway questions, etc.) — the human-authored labels on the diagram.
  const names = [...xml.matchAll(/\bname="([^"]*)"/g)]
    .map((m) => decodeXmlEntities(m[1]))
    .filter((n) => n.trim().length > 0);

  // <bpmn:documentation>...</bpmn:documentation> (any namespace prefix) —
  // free-text notes authors attach to elements/processes.
  const docs = [...xml.matchAll(/<(?:\w+:)?documentation[^>]*>([\s\S]*?)<\/(?:\w+:)?documentation>/g)]
    .map((m) => decodeXmlEntities(m[1]).trim())
    .filter((d) => d.length > 0);

  const processNameMatch = xml.match(/<(?:\w+:)?process\b[^>]*\bname="([^"]*)"/);
  const title = processNameMatch
    ? decodeXmlEntities(processNameMatch[1])
    : path.basename(filePath, path.extname(filePath));

  const body = [
    `Element labels: ${names.join(', ') || '(none)'}`,
    docs.length > 0 ? `Documentation:\n${docs.join('\n\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { title, body };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
