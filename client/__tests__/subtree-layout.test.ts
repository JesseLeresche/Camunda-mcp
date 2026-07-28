import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-ignore — bpmn-moddle ships no types; same pattern as other test files.
import { BpmnModdle } from 'bpmn-moddle';
import { findScopeContainer, layoutSubtreeXml } from '../layout/subtree';

/**
 * #10 regression suite — the pure half of the subtree-scoped auto-layout
 * primitive (extract a subprocess's children, lay them out in isolation via
 * layoutProcess + Phase 2 post-processing). No live services involved, same
 * shape as composition.test.ts's coverage of composePoolsAndLanes.
 *
 * Reuses boundary-events-subprocess.bpmn (already has an expanded
 * "packSubprocess" with 3 children, plus plenty of sibling content outside
 * it) rather than adding a new fixture — exactly the shape needed to prove
 * scoping actually ignores everything outside the target subprocess.
 */

const FIXTURE_PATH = join(__dirname, '..', '..', 'test', 'fixtures', 'boundary-events-subprocess.bpmn');

describe('findScopeContainer', () => {
  it('finds a nested subprocess by id, searching across the whole tree', async () => {
    const xml = readFileSync(FIXTURE_PATH, 'utf8');
    const moddle = new BpmnModdle();
    const { rootElement: definitions } = await moddle.fromXML(xml);

    const found = findScopeContainer(definitions, 'packSubprocess');
    expect(found).toBeTruthy();
    expect(found.$type).toBe('bpmn:SubProcess');
    expect(found.flowElements.map((fe: any) => fe.id).sort()).toEqual(['fp1', 'fp2', 'packEnd', 'packItems', 'packStart']);
  });

  it('returns undefined for an id that does not exist', async () => {
    const xml = readFileSync(FIXTURE_PATH, 'utf8');
    const moddle = new BpmnModdle();
    const { rootElement: definitions } = await moddle.fromXML(xml);

    expect(findScopeContainer(definitions, 'nonexistent')).toBeUndefined();
  });
});

describe('layoutSubtreeXml', () => {
  it('lays out just the target subprocess\'s children, ignoring sibling content', async () => {
    const xml = readFileSync(FIXTURE_PATH, 'utf8');
    const moddle = new BpmnModdle();
    const { rootElement: definitions } = await moddle.fromXML(xml);

    const { shapes, edges } = await layoutSubtreeXml(definitions, 'packSubprocess', moddle, new Set());

    const shapeIds = shapes.map((s: any) => s.bpmnElement.id).sort();
    expect(shapeIds).toEqual(['packEnd', 'packItems', 'packStart']);
    // Nothing from outside the subprocess (checkStock, shipOrder, the
    // boundary events, etc.) leaked into the scoped layout.
    for (const s of shapes) {
      expect(['packStart', 'packItems', 'packEnd']).toContain(s.bpmnElement.id);
    }

    const edgeIds = edges.map((e: any) => e.bpmnElement.id).sort();
    expect(edgeIds).toEqual(['fp1', 'fp2']);

    // Every shape got real, non-overlapping geometry.
    for (const s of shapes) {
      expect(s.bounds.width).toBeGreaterThan(0);
      expect(s.bounds.height).toBeGreaterThan(0);
    }
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const a = shapes[i].bounds, b = shapes[j].bounds;
        const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlap, `${shapes[i].bpmnElement.id} overlaps ${shapes[j].bpmnElement.id}`).toBe(false);
      }
    }
  });

  it('throws a clear error when the scope id does not exist', async () => {
    const xml = readFileSync(FIXTURE_PATH, 'utf8');
    const moddle = new BpmnModdle();
    const { rootElement: definitions } = await moddle.fromXML(xml);

    await expect(layoutSubtreeXml(definitions, 'nonexistent', moddle, new Set())).rejects.toThrow('not found');
  });

  it('throws a clear error when the scope has no children', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:subProcess id="emptySub" />
  </bpmn:process>
</bpmn:definitions>`;
    const moddle = new BpmnModdle();
    const { rootElement: definitions } = await moddle.fromXML(xml);

    await expect(layoutSubtreeXml(definitions, 'emptySub', moddle, new Set())).rejects.toThrow('no children');
  });
});
