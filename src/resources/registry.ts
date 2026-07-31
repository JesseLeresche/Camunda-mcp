/**
 * Registry of static MCP resources (curated Markdown guides).
 *
 * Served over MCP's native Resources protocol (resources/list,
 * resources/read) so any MCP client can discover and fetch them — not just
 * an editor session that happens to be instructed to read a specific file.
 * Mirrors archi-mcp-server's ResourceRegistry pattern (commit ba0bdcc).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ResourceDescriptor {
  /** Unique URI used in resources/read requests. */
  uri: string;
  /** Human-readable name shown in resources/list. */
  name: string;
  /** One-line description shown in resources/list. */
  description: string;
  /** MIME type — text/markdown for every guide today. */
  mimeType: string;
  /** Absolute path to the file, read live at request time (no content duplication). */
  filePath: string;
}

// src/resources/registry.ts -> dist/resources/registry.js at runtime; two levels up from
// dist/resources/ reaches the repo root.
const ROOT_DIR = path.join(__dirname, '..', '..');

export const RESOURCES: ResourceDescriptor[] = [
  {
    uri: 'camunda-mcp://guides/bpmn-best-practices',
    name: 'BPMN Best Practices',
    description:
      'Coordinate systems, flow routing, and layout rules to follow before creating or ' +
      'modifying any BPMN diagram.',
    mimeType: 'text/markdown',
    filePath: path.join(ROOT_DIR, 'BPMN-BEST-PRACTICES.md'),
  },
  {
    uri: 'camunda-mcp://guides/bpmn-gateways',
    name: 'BPMN Gateways: Which One to Use',
    description:
      'Exclusive vs parallel vs inclusive vs event-based gateways — when to use each, and the ' +
      'add_element / connect parameters each one needs.',
    mimeType: 'text/markdown',
    filePath: path.join(ROOT_DIR, 'docs', 'knowledge-base', 'camunda-docs', 'bpmn-gateways.md'),
  },
  {
    uri: 'camunda-mcp://guides/bpmn-error-and-escalation-events',
    name: 'BPMN Error & Escalation Events',
    description:
      'Interrupting error events vs non-interrupting escalation events, errorCode/escalationCode ' +
      'matching, and business-vs-technical-error framing.',
    mimeType: 'text/markdown',
    filePath: path.join(
      ROOT_DIR, 'docs', 'knowledge-base', 'camunda-docs', 'bpmn-error-and-escalation-events.md'
    ),
  },
];

/**
 * Reads a registered resource's current content off disk.
 */
export function readResource(resource: ResourceDescriptor): string {
  return fs.readFileSync(resource.filePath, 'utf-8');
}
