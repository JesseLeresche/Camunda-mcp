/**
 * Layout Test Harness
 *
 * Connects to the live Camunda Modeler MCP server, fetches the active diagram,
 * runs smartAutoLayout with configurable options, then checks whether any
 * element collisions remain after layout.
 *
 * Usage:
 *   npx tsx src/layout-tests.ts
 *   npx tsx src/layout-tests.ts --dry-run          # fetch + collision check only, no layout
 *   npx tsx src/layout-tests.ts --diagram <id>     # target a specific diagram tab ID
 *
 * Layout options are at the top of this file — edit and re-run to test variations.
 */

import { OccupancyMap } from './tools/layout-engine';

const MCP_URL = process.env.MCP_URL ?? 'http://localhost:3100/mcp';
const MCP_API_KEY = process.env.MCP_API_KEY;

// ── Layout options to experiment with ──────────────────────────────────────
// Edit these values, re-run, press Ctrl+Z in the Modeler to undo, repeat.
const LAYOUT_OPTIONS = {
  horizontalSpacing: 80,        // px gap between columns (default 50)
  branchSpacing: 120,           // px between parallel branches (default 120)
  flowRouting: 'orthogonal',    // 'orthogonal' | 'direct'
  mergeAlignment: 'center',     // 'center' | 'top-branch'
  boundaryEventPosition: 'bottom', // 'bottom' | 'bottom-right'
};
// ───────────────────────────────────────────────────────────────────────────

let requestId = 1;

// ── MCP transport ──────────────────────────────────────────────────────────

async function mcpCall(method: string, params: Record<string, unknown>): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (MCP_API_KEY) headers['Authorization'] = `Bearer ${MCP_API_KEY}`;

  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: requestId++ });
  const res = await fetch(MCP_URL, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const text = await res.text();
  const jsonText = text.includes('data:')
    ? text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('')
    : text;

  const json = JSON.parse(jsonText);
  if (json.error) throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
  return json.result;
}

async function toolCall(name: string, args: Record<string, unknown>): Promise<any> {
  const result = await mcpCall('tools/call', { name, arguments: args });
  const content = result?.content?.[0]?.text;
  if (!content) return result;
  try { return JSON.parse(content); } catch { return content; }
}

// ── Collision detection ────────────────────────────────────────────────────

interface Shape {
  id: string;
  type: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function extractShapes(elements: any[]): Shape[] {
  return elements.filter(
    (e: any) => e.x !== undefined && e.width !== undefined &&
      e.type !== 'label' && !e.type?.startsWith('bpmndi:') && !e.waypoints
  ) as Shape[];
}

interface Collision {
  a: Shape;
  b: Shape;
  overlapX: number;
  overlapY: number;
}

function findCollisions(shapes: Shape[], padding = 0): Collision[] {
  const collisions: Collision[] = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i], b = shapes[j];
      const ax1 = a.x - padding, ay1 = a.y - padding;
      const ax2 = a.x + a.width + padding, ay2 = a.y + a.height + padding;
      const bx1 = b.x - padding, by1 = b.y - padding;
      const bx2 = b.x + b.width + padding, by2 = b.y + b.height + padding;

      const overlapX = Math.min(ax2, bx2) - Math.max(ax1, bx1);
      const overlapY = Math.min(ay2, by2) - Math.max(ay1, by1);

      if (overlapX > 0 && overlapY > 0) {
        collisions.push({ a, b, overlapX: Math.round(overlapX), overlapY: Math.round(overlapY) });
      }
    }
  }
  return collisions;
}

function reportCollisions(label: string, shapes: Shape[]) {
  const collisions = findCollisions(shapes);
  const strictCollisions = findCollisions(shapes, 0);     // exact overlap
  const paddedCollisions = findCollisions(shapes, 5);     // within 5px

  if (strictCollisions.length === 0) {
    console.log(`  ✓ No collisions (${shapes.length} shapes checked)`);
  } else {
    console.log(`  ✗ ${strictCollisions.length} collision(s) found:`);
    for (const c of strictCollisions) {
      const aLabel = c.a.name || c.a.id;
      const bLabel = c.b.name || c.b.id;
      console.log(`    - "${aLabel}" overlaps "${bLabel}" by ${c.overlapX}×${c.overlapY}px`);
    }
  }

  if (paddedCollisions.length > strictCollisions.length) {
    const nearMisses = paddedCollisions.length - strictCollisions.length;
    console.log(`  ⚠  ${nearMisses} element(s) within 5px of another (near-miss)`);
  }

  return { collisions: strictCollisions, nearMisses: paddedCollisions.length - strictCollisions.length };
}

// ── Display helpers ────────────────────────────────────────────────────────

function printElementTable(elements: any[]) {
  const shapes = extractShapes(elements);
  if (shapes.length === 0) { console.log('  (no shapes)'); return; }

  const maxId   = Math.max(12, ...shapes.map(e => (e.id  || '').length));
  const maxType = Math.max(10, ...shapes.map(e => (e.type || '').length));
  const maxName = Math.max(8,  ...shapes.map(e => (e.name || '').length));

  const header = '  ' +
    'ID'.padEnd(maxId) + '  ' + 'Type'.padEnd(maxType) + '  ' +
    'Name'.padEnd(maxName) + '  ' + 'x'.padStart(6) + '  ' + 'y'.padStart(6) +
    '  ' + 'w'.padStart(5) + '  ' + 'h'.padStart(5);
  console.log(header);
  console.log('  ' + '-'.repeat(header.length - 2));

  for (const el of shapes) {
    console.log(
      '  ' +
      (el.id   || '').padEnd(maxId)   + '  ' +
      (el.type || '').padEnd(maxType) + '  ' +
      (el.name || '').padEnd(maxName) + '  ' +
      String(el.x ?? '?').padStart(6) + '  ' +
      String(el.y ?? '?').padStart(6) + '  ' +
      String(el.width  ?? '?').padStart(5) + '  ' +
      String(el.height ?? '?').padStart(5)
    );
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const diagramArgIdx = args.indexOf('--diagram');
  let diagramId: string | undefined = diagramArgIdx >= 0 ? args[diagramArgIdx + 1] : undefined;

  // 1. Initialize MCP session
  console.log(`\nConnecting to MCP server at ${MCP_URL}…`);
  await mcpCall('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'layout-test-harness', version: '1.0' },
  });
  console.log('Connected.\n');

  // 2. Resolve diagram ID
  if (!diagramId) {
    const diagrams = await toolCall('manage_diagram', { operation: 'list' });
    const tabs: any[] = diagrams?.tabs ?? [];
    if (tabs.length === 0) {
      console.error('No open diagrams found. Open a BPMN file in the Camunda Modeler first.');
      process.exit(1);
    }
    diagramId = tabs[0].id;
    console.log('Open diagrams:');
    for (const t of tabs) {
      console.log(`  [${t.id}] ${t.name}${t.id === diagramId ? '  ← using this' : ''}`);
    }
    console.log();
  }

  // 3. Fetch element positions BEFORE layout
  console.log('── BEFORE layout ─────────────────────────────────');
  const beforeList = await toolCall('query_diagram', {
    operation: 'list',
    diagramId,
    fields: ['id', 'type', 'name', 'x', 'y', 'width', 'height'],
  });
  const beforeElements: any[] = beforeList?.elements ?? [];
  const beforeShapes = extractShapes(beforeElements);
  console.log(`${beforeShapes.length} shapes\n`);
  printElementTable(beforeElements);
  console.log('\nCollision check:');
  reportCollisions('before', beforeShapes);
  console.log();

  if (dryRun) {
    console.log('--dry-run: skipping layout. Press Ctrl+Z in the Modeler to undo any previous run.\n');
    return;
  }

  // 4. Run layout
  console.log('── Running smartAutoLayout ────────────────────────');
  console.log('Options:', JSON.stringify(LAYOUT_OPTIONS));
  console.log();

  const layoutResult = await toolCall('layout', {
    operation: 'auto',
    diagramId,
    options: LAYOUT_OPTIONS,
  });
  console.log('Result:', JSON.stringify(layoutResult));
  console.log();

  // 5. Fetch element positions AFTER layout
  console.log('── AFTER layout ──────────────────────────────────');
  const afterList = await toolCall('query_diagram', {
    operation: 'list',
    diagramId,
    fields: ['id', 'type', 'name', 'x', 'y', 'width', 'height'],
  });
  const afterElements: any[] = afterList?.elements ?? [];
  const afterShapes = extractShapes(afterElements);
  printElementTable(afterElements);
  console.log('\nCollision check:');
  const { collisions, nearMisses } = reportCollisions('after', afterShapes);
  console.log();

  // 6. Delta summary
  console.log('── Summary ───────────────────────────────────────');
  const beforeMap = new Map(beforeElements.map((e: any) => [e.id, e]));
  const moved = afterElements.filter((e: any) => {
    const b = beforeMap.get(e.id);
    return b && (e.x !== b.x || e.y !== b.y);
  });
  console.log(`Elements moved  : ${moved.length} / ${beforeShapes.length}`);
  console.log(`Collisions after: ${collisions.length}`);
  console.log(`Near-misses     : ${nearMisses}`);
  if (moved.length > 0) {
    console.log('\nMoved:');
    for (const e of moved) {
      const b = beforeMap.get(e.id)!;
      const label = e.name || e.type;
      console.log(`  ${label.padEnd(30)} (${b.x},${b.y}) → (${e.x},${e.y})`);
    }
  }
  console.log();
  console.log('Press Ctrl+Z in the Camunda Modeler to undo this layout run.');
}

main().catch(err => {
  console.error('\nFatal:', err.message ?? err);
  process.exit(1);
});