import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { layoutProcess } from 'bpmn-auto-layout';
// @ts-ignore — bpmn-moddle ships no types; same pattern as the smoke test.
import { BpmnModdle } from 'bpmn-moddle';

/**
 * Phase 1 regression suite — proves the bpmn-auto-layout pipeline (the exact
 * `layoutProcess` call `buildProcessViaAutoLayout`/`layoutDiagramViaAutoLayout`
 * make in client/bpmn-tools.ts) produces structurally sound output for the
 * three scenarios already manually validated live in the running Modeler:
 * boundary events + an expanded subprocess, a gateway split/join/decision,
 * and a 30-element scenario exercising every supported event/task/gateway
 * type. Fixture XML lives in test/fixtures/ (semantic-only, generated via
 * bpmn-moddle so it's guaranteed well-formed — see that directory's README).
 *
 * These assertions check structure (every element positioned, expanded
 * subprocesses actually contain their children, no two unrelated shapes
 * overlap), not exact pixel coordinates — bpmn-auto-layout's output is
 * expected to shift as its own version changes or as Phase 2's
 * post-processing pass gets added on top.
 */

const FIXTURES_DIR = join(__dirname, '..', '..', 'test', 'fixtures');

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boundsOf(shape: any): Rect {
  const b = shape.bounds;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Every flowElement id in the process, including inside nested subprocesses. */
function collectAllFlowElementIds(container: any): string[] {
  const ids: string[] = [];
  for (const fe of container.flowElements || []) {
    if (fe.$type === 'bpmn:SequenceFlow') continue;
    ids.push(fe.id);
    if (fe.$type === 'bpmn:SubProcess') ids.push(...collectAllFlowElementIds(fe));
  }
  return ids;
}

/** Maps every flowElement id -> the id of its nearest bpmn:SubProcess/bpmn:Process container. */
function buildContainerMap(container: any, containerId: string, map: Record<string, string>): void {
  for (const fe of container.flowElements || []) {
    if (fe.$type === 'bpmn:SequenceFlow') continue;
    map[fe.id] = containerId;
    if (fe.$type === 'bpmn:SubProcess') buildContainerMap(fe, fe.id, map);
  }
}

/** Ids of boundary events, keyed by their host's id — boundary events dock on their host's border by design, so they're expected to overlap it. */
function buildBoundaryHostPairs(container: any, pairs: Set<string>): void {
  for (const fe of container.flowElements || []) {
    if (fe.$type === 'bpmn:BoundaryEvent' && fe.attachedToRef) {
      pairs.add(`${fe.id}|${fe.attachedToRef.id}`);
    }
    if (fe.$type === 'bpmn:SubProcess') buildBoundaryHostPairs(fe, pairs);
  }
}

/**
 * No two shapes that share a container (siblings) should overlap. Excludes:
 * parent/child containment (a subprocess vs. its own members, expected), and
 * boundary-event/host pairs (a boundary event deliberately docks on its
 * host's border, so some overlap there is correct BPMN rendering, not a
 * layout defect).
 */
function assertNoSiblingOverlap(shapes: any[], containerMap: Record<string, string>, boundaryHostPairs: Set<string>): void {
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i];
      const b = shapes[j];
      const aId = a.bpmnElement.id;
      const bId = b.bpmnElement.id;
      if (containerMap[aId] !== containerMap[bId]) continue;
      if (boundaryHostPairs.has(`${aId}|${bId}`) || boundaryHostPairs.has(`${bId}|${aId}`)) continue;
      const overlap = rectsOverlap(boundsOf(a), boundsOf(b));
      expect(overlap, `sibling shapes "${aId}" and "${bId}" overlap`).toBe(false);
    }
  }
}

async function layoutFixture(fixtureName: string) {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  // fixtureName is always a hardcoded literal from this file's own call sites (e.g. 'gateways.bpmn'), never external input.
  const xml = readFileSync(join(FIXTURES_DIR, fixtureName), 'utf8');
  const moddle = new BpmnModdle();

  const { rootElement: inputDefs } = await moddle.fromXML(xml);
  const process = inputDefs.rootElements.find((el: any) => el.$type === 'bpmn:Process');
  const containerMap: Record<string, string> = {};
  buildContainerMap(process, process.id, containerMap);
  const boundaryHostPairs = new Set<string>();
  buildBoundaryHostPairs(process, boundaryHostPairs);

  const laidOutXml = await layoutProcess(xml);
  const { rootElement: outDefs } = await moddle.fromXML(laidOutXml);
  const planeElements: any[] = outDefs.diagrams?.[0]?.plane?.planeElement || [];
  const shapes = planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNShape');
  const edges = planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNEdge');

  return { process, containerMap, boundaryHostPairs, shapes, edges };
}

describe('bpmn-auto-layout fixtures (Phase 1 regression)', () => {
  it('boundary-events-subprocess: every element positioned, subprocess expanded and contains its children, no sibling overlap', async () => {
    const { process, containerMap, boundaryHostPairs, shapes } = await layoutFixture('boundary-events-subprocess.bpmn');

    const allIds = collectAllFlowElementIds(process);
    const shapeIds = new Set(shapes.map((s: any) => s.bpmnElement.id));
    for (const id of allIds) {
      expect(shapeIds.has(id), `missing shape for "${id}"`).toBe(true);
    }

    const subShape = shapes.find((s: any) => s.bpmnElement.id === 'packSubprocess');
    expect(subShape.isExpanded).toBe(true);
    const subRect = boundsOf(subShape);
    for (const childId of ['packStart', 'packItems', 'packEnd']) {
      const childShape = shapes.find((s: any) => s.bpmnElement.id === childId);
      expect(rectContains(subRect, boundsOf(childShape)), `"${childId}" not contained in expanded subprocess bounds`).toBe(true);
    }

    assertNoSiblingOverlap(shapes, containerMap, boundaryHostPairs);
  });

  it('gateways: every element positioned, decision default flow preserved, no sibling overlap', async () => {
    const { process, containerMap, boundaryHostPairs, shapes, edges } = await layoutFixture('gateways.bpmn');

    const allIds = collectAllFlowElementIds(process);
    const shapeIds = new Set(shapes.map((s: any) => s.bpmnElement.id));
    for (const id of allIds) {
      expect(shapeIds.has(id), `missing shape for "${id}"`).toBe(true);
    }

    const flowIds = new Set(edges.map((e: any) => e.bpmnElement.id));
    for (let i = 1; i <= 10; i++) {
      expect(flowIds.has(`f${i}`), `missing edge for "f${i}"`).toBe(true);
    }

    assertNoSiblingOverlap(shapes, containerMap, boundaryHostPairs);
  });

  it('complex-loan-underwriting: 29 elements all positioned, subprocess expanded and contains its children, no sibling overlap', async () => {
    const { process, containerMap, boundaryHostPairs, shapes } = await layoutFixture('complex-loan-underwriting.bpmn');

    const allIds = collectAllFlowElementIds(process);
    expect(allIds.length).toBe(29);
    const shapeIds = new Set(shapes.map((s: any) => s.bpmnElement.id));
    for (const id of allIds) {
      expect(shapeIds.has(id), `missing shape for "${id}"`).toBe(true);
    }

    const subShape = shapes.find((s: any) => s.bpmnElement.id === 'subprocessDocs');
    expect(subShape.isExpanded).toBe(true);
    const subRect = boundsOf(subShape);
    for (const childId of ['subStart', 'reviewDocs', 'subEnd']) {
      const childShape = shapes.find((s: any) => s.bpmnElement.id === childId);
      expect(rectContains(subRect, boundsOf(childShape)), `"${childId}" not contained in expanded subprocess bounds`).toBe(true);
    }

    assertNoSiblingOverlap(shapes, containerMap, boundaryHostPairs);
  });
});
