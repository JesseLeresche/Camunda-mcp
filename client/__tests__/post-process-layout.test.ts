import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { layoutProcess } from 'bpmn-auto-layout';
// @ts-ignore — bpmn-moddle ships no types; same pattern as the smoke test.
import { BpmnModdle } from 'bpmn-moddle';
import { dedupEdgeWaypoints, findConflictGroups, routeAwayOverlaps, wrapLabelText, postProcessLayout } from '../layout/post-process';

/**
 * Phase 2 regression suite — the post-processing pass that runs on
 * bpmn-auto-layout's raw output before import (waypoint dedup, the
 * crossing/overlap lane-offset router, label authoring). Uses the same
 * complex-loan-underwriting fixture Phase 1 already validated live, since
 * that's where the real collinear-overlap bug (f3/f4 etc. sharing a
 * corridor) was actually observed.
 */

const FIXTURES_DIR = join(__dirname, '..', '..', 'test', 'fixtures');

async function loadLaidOutPlane(fixtureName: string) {
  // fixtureName is always a hardcoded literal from this file's own call sites (e.g. 'complex-loan-underwriting.bpmn'), never external input.
  const xml = readFileSync(join(FIXTURES_DIR, fixtureName), 'utf8'); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const laidOutXml = await layoutProcess(xml);
  const moddle = new BpmnModdle();
  const { rootElement: defs } = await moddle.fromXML(laidOutXml);
  const planeElements: any[] = defs.diagrams[0].plane.planeElement;
  const shapes = planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNShape');
  const edges = planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNEdge');
  return { moddle, shapes, edges };
}

function segments(edge: any): Array<{ a: any; b: any }> {
  const pts = edge.waypoint;
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) out.push({ a: pts[i], b: pts[i + 1] });
  return out;
}

describe('dedupEdgeWaypoints', () => {
  it('drops near-duplicate consecutive points but keeps distinct ones', () => {
    const edge = {
      waypoint: [
        { x: 750, y: 280 },
        { x: 750.2, y: 280.1 }, // near-duplicate of previous — should be dropped
        { x: 750, y: 210 },
        { x: 850, y: 210 },
      ],
    };
    dedupEdgeWaypoints([edge]);
    expect(edge.waypoint).toEqual([
      { x: 750, y: 280 },
      { x: 750, y: 210 },
      { x: 850, y: 210 },
    ]);
  });

  it('leaves a 2-point edge with distinct endpoints untouched', () => {
    const edge = { waypoint: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    dedupEdgeWaypoints([edge]);
    expect(edge.waypoint.length).toBe(2);
  });
});

describe('crossing/overlap router (complex-loan-underwriting fixture)', () => {
  it('finds the confirmed collinear-overlap conflicts in raw bpmn-auto-layout output', async () => {
    const { edges } = await loadLaidOutPlane('complex-loan-underwriting.bpmn');
    const groups = findConflictGroups(edges);
    expect(groups.length).toBeGreaterThan(0);
  });

  it('deliberately leaves dock-anchored conflicts untouched (user-confirmed: a jog there reads as a glitch, not a fix)', async () => {
    const { edges } = await loadLaidOutPlane('complex-loan-underwriting.bpmn');
    const before = edges.map((e: any) => ({ id: e.bpmnElement.id, waypoint: e.waypoint.map((p: any) => ({ x: p.x, y: p.y })) }));

    dedupEdgeWaypoints(edges);
    routeAwayOverlaps(edges);

    // Every conflict in this fixture is dock-anchored (confirmed by the test
    // above being the only source of conflicts) — none of them should have
    // been mutated at all.
    for (const b of before) {
      const after = edges.find((e: any) => e.bpmnElement.id === b.id);
      expect(after.waypoint.length, `${b.id} waypoint count changed`).toBe(b.waypoint.length);
      for (let i = 0; i < b.waypoint.length; i++) {
        expect(after.waypoint[i].x, `${b.id} point ${i}.x moved`).toBeCloseTo(b.waypoint[i].x, 1);
        expect(after.waypoint[i].y, `${b.id} point ${i}.y moved`).toBeCloseTo(b.waypoint[i].y, 1);
      }
    }
  });
});

describe('crossing/overlap router (synthetic interior conflict)', () => {
  it('shifts a genuine interior-segment conflict (both endpoints are elbows, not dock points) into separate lanes', () => {
    // Two edges with a shared vertical middle segment at x=100, neither
    // edge's dock points (first/last waypoint) touch it — the one case the
    // router is still allowed to fix.
    const edgeA = { bpmnElement: { id: 'edgeA' }, waypoint: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 300, y: 200 }] };
    const edgeB = { bpmnElement: { id: 'edgeB' }, waypoint: [{ x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 150 }, { x: 300, y: 150 }] };
    const edges = [edgeA, edgeB];

    const groups = findConflictGroups(edges);
    expect(groups.length).toBe(1);

    routeAwayOverlaps(edges);

    // Dock points (first/last waypoint of each edge) must be untouched.
    expect(edgeA.waypoint[0]).toEqual({ x: 0, y: 0 });
    expect(edgeA.waypoint[3]).toEqual({ x: 300, y: 200 });
    expect(edgeB.waypoint[0]).toEqual({ x: 0, y: 50 });
    expect(edgeB.waypoint[3]).toEqual({ x: 300, y: 150 });

    // The two interior elbow points on each edge must have shifted apart
    // (in opposite directions) and no longer collide.
    expect(edgeA.waypoint[1].x).not.toBeCloseTo(100, 1);
    expect(edgeB.waypoint[1].x).not.toBeCloseTo(100, 1);
    expect(edgeA.waypoint[1].x).toBeCloseTo(edgeA.waypoint[2].x, 1);
    expect(edgeB.waypoint[1].x).toBeCloseTo(edgeB.waypoint[2].x, 1);
    expect(Math.abs(edgeA.waypoint[1].x - edgeB.waypoint[1].x)).toBeGreaterThan(5);

    // Every segment stays orthogonal.
    for (const edge of edges) {
      for (const { a, b } of segments(edge)) {
        const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
        expect(dx < 0.5 || dy < 0.5, `${edge.bpmnElement.id} has a non-orthogonal segment`).toBe(true);
      }
    }
  });
});

describe('wrapLabelText', () => {
  it('never breaks a word across lines, even for a narrow max width', () => {
    const lines = wrapLabelText('Application Received', 10, 12);
    for (const line of lines) {
      for (const word of line.split(' ')) {
        expect('Application Received'.split(' ')).toContain(word);
      }
    }
    expect(lines.join(' ')).toBe('Application Received');
  });

  it('fits short text on one line', () => {
    const lines = wrapLabelText('Done', 100, 12);
    expect(lines).toEqual(['Done']);
  });
});

describe('postProcessLayout (full pass, complex-loan-underwriting fixture)', () => {
  it('authors external labels for named events/gateways and flow labels, leaves task labels alone', async () => {
    const { moddle, shapes, edges } = await loadLaidOutPlane('complex-loan-underwriting.bpmn');
    postProcessLayout(shapes, edges, moddle);

    const gateway = shapes.find((s: any) => s.bpmnElement.id === 'riskGateway');
    expect(gateway.label).toBeTruthy();
    expect(gateway.label.bounds.width).toBeGreaterThan(0);

    const task = shapes.find((s: any) => s.bpmnElement.id === 'taskCredit');
    expect(task.label).toBeUndefined();

    const namedFlow = edges.find((e: any) => e.bpmnElement.name === 'Low');
    expect(namedFlow.label).toBeTruthy();

    const unnamedFlow = edges.find((e: any) => !e.bpmnElement.name);
    expect(unnamedFlow.label).toBeUndefined();
  });

  it('never places a boundary event label on the side facing its host, even when every connector-facing side is taken', async () => {
    const { moddle, shapes, edges } = await loadLaidOutPlane('complex-loan-underwriting.bpmn');
    postProcessLayout(shapes, edges, moddle);

    const boundary = shapes.find((s: any) => s.bpmnElement.id === 'boundaryManualTimeout');
    const host = shapes.find((s: any) => s.bpmnElement.id === 'manualReview');
    expect(boundary.label).toBeTruthy();

    const labelRect = { x: boundary.label.bounds.x, y: boundary.label.bounds.y, width: boundary.label.bounds.width, height: boundary.label.bounds.height };
    const hostRect = { x: host.bounds.x, y: host.bounds.y, width: host.bounds.width, height: host.bounds.height };
    const overlaps = labelRect.x < hostRect.x + hostRect.width && labelRect.x + labelRect.width > hostRect.x
      && labelRect.y < hostRect.y + hostRect.height && labelRect.y + labelRect.height > hostRect.y;
    expect(overlaps, 'boundary event label overlaps its host shape').toBe(false);
  });
});
