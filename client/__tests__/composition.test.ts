import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-ignore — bpmn-moddle ships no types; same pattern as other test files.
import { BpmnModdle } from 'bpmn-moddle';
import { extractComposition, composePoolsAndLanes } from '../layout/composition';
import { bboxOfShapes } from '../element-shared';

/**
 * Phase 3 regression suite — extraction and retrofit of collaborations,
 * lanes, annotations, and groups, none of which bpmn-auto-layout can handle
 * natively (confirmed by reading its source: getProcess() is a
 * first-bpmn:Process-only lookup; laneSets/artifacts are never referenced).
 * Fixture: test/fixtures/pools-lanes-annotations-group.bpmn — 2 participants
 * (Customer: no lanes; Bank: 2 lanes), 1 message flow, 1 annotation with an
 * association, 1 group.
 */

const FIXTURE_PATH = join(__dirname, '..', '..', 'test', 'fixtures', 'pools-lanes-annotations-group.bpmn');

function fakeServices(moddle: any): any {
  return { moddle, elementRegistry: { getAll: () => [] } };
}

describe('extractComposition', () => {
  it('pulls the collaboration apart into participants, message flows, annotations, and groups', async () => {
    const xml = readFileSync(FIXTURE_PATH, 'utf8');
    const moddle = new BpmnModdle();
    const { rootElement: definitions } = await moddle.fromXML(xml);

    const extracted = extractComposition(definitions);

    expect(extracted.hadCollaboration).toBe(true);
    expect(extracted.participants).toHaveLength(2);

    const customer = extracted.participants.find((p) => p.participantId === 'Participant_customer')!;
    expect(customer.laneInfos).toHaveLength(0);
    expect(customer.processBo.flowElements.map((fe: any) => fe.id).sort()).toEqual(['customerDone', 'f1', 'f2', 'orderPlaced', 'submitOrder']);

    const bank = extracted.participants.find((p) => p.participantId === 'Participant_bank')!;
    expect(bank.laneInfos).toHaveLength(2);
    const front = bank.laneInfos.find((l) => l.id === 'lane_frontOffice')!;
    expect(front.memberIds.sort()).toEqual(['approveGateway', 'rejected', 'requestReceived', 'reviewRequest']);
    const back = bank.laneInfos.find((l) => l.id === 'lane_backOffice')!;
    expect(back.memberIds.sort()).toEqual(['paymentComplete', 'processPayment']);
    // laneSets stripped from the process bo so layoutProcess never sees them
    expect(bank.processBo.laneSets).toEqual([]);

    expect(extracted.messageFlows).toEqual([{ id: 'mf1', name: 'Order Details', sourceId: 'submitOrder', targetId: 'requestReceived' }]);

    expect(extracted.annotations).toHaveLength(1);
    expect(extracted.annotations[0]).toMatchObject({ id: 'annotation1', text: 'Manual review required for orders over $10k', associatedIds: ['reviewRequest'] });

    expect(extracted.groups).toHaveLength(1);
    expect(extracted.groups[0]).toMatchObject({ id: 'group1', name: 'Payment Processing' });
  });
});

describe('composePoolsAndLanes', () => {
  it('produces a valid, re-parseable diagram with both pools stacked, non-overlapping, and lanes reconstructed', async () => {
    const xml = readFileSync(FIXTURE_PATH, 'utf8');
    const moddle = new BpmnModdle();
    const { rootElement: definitions } = await moddle.fromXML(xml);
    const extracted = extractComposition(definitions);

    const { xml: composedXml, warnings } = await composePoolsAndLanes(extracted, fakeServices(moddle));

    const { rootElement: composedDefs, warnings: parseWarnings } = await moddle.fromXML(composedXml);
    expect(parseWarnings).toEqual([]);

    const collaboration = composedDefs.rootElements.find((el: any) => el.$type === 'bpmn:Collaboration');
    expect(collaboration.participants).toHaveLength(2);

    const plane = composedDefs.diagrams[0].plane;
    const shapes = plane.planeElement.filter((pe: any) => pe.$type === 'bpmndi:BPMNShape');
    const poolShapes = shapes.filter((s: any) => s.bpmnElement.$type === 'bpmn:Participant');
    expect(poolShapes).toHaveLength(2);

    // Pools must not overlap vertically (stacked, not on top of each other).
    const [poolA, poolB] = poolShapes.sort((a: any, b: any) => a.bounds.y - b.bounds.y);
    expect(poolA.bounds.y + poolA.bounds.height).toBeLessThanOrEqual(poolB.bounds.y);

    // The Bank pool's lanes were reconstructed with real bounds.
    const laneShapes = shapes.filter((s: any) => s.bpmnElement.$type === 'bpmn:Lane');
    expect(laneShapes).toHaveLength(2);
    for (const laneShape of laneShapes) {
      expect(laneShape.bounds.width).toBeGreaterThan(0);
      expect(laneShape.bounds.height).toBeGreaterThan(0);
    }

    // Every flow-node shape from both processes made it into the final DI.
    const flowNodeIds = ['orderPlaced', 'submitOrder', 'customerDone', 'requestReceived', 'reviewRequest', 'approveGateway', 'processPayment', 'paymentComplete', 'rejected'];
    const shapeIds = new Set(shapes.map((s: any) => s.bpmnElement.id));
    for (const id of flowNodeIds) expect(shapeIds.has(id), `missing shape for "${id}"`).toBe(true);

    // Lane membership (flowNodeRef) survived the round-trip through layoutProcess.
    const bankProcess = composedDefs.rootElements.find((el: any) => el.$type === 'bpmn:Process' && el.id === 'Process_bank');
    const rebuiltLaneSet = bankProcess.laneSets[0];
    const frontLane = rebuiltLaneSet.lanes.find((l: any) => l.id === 'lane_frontOffice');
    expect(frontLane.flowNodeRef.map((r: any) => r.id).sort()).toEqual(['approveGateway', 'rejected', 'requestReceived', 'reviewRequest']);

    // Any interleaving warning (if produced) names the actual participant.
    for (const w of warnings) expect(w).toContain('Bank');
  });

  it('returns laneBands describing each lane\'s assigned Y-range, matching the drawn lane shapes', async () => {
    const xml = readFileSync(FIXTURE_PATH, 'utf8');
    const moddle = new BpmnModdle();
    const { rootElement: definitions } = await moddle.fromXML(xml);
    const extracted = extractComposition(definitions);

    const { xml: composedXml, laneBands } = await composePoolsAndLanes(extracted, fakeServices(moddle));
    expect(laneBands).toHaveLength(2);

    const { rootElement: composedDefs } = await moddle.fromXML(composedXml);
    const laneShapes = composedDefs.diagrams[0].plane.planeElement.filter((pe: any) => pe.$type === 'bpmndi:BPMNShape' && pe.bpmnElement.$type === 'bpmn:Lane');

    for (const band of laneBands) {
      const matchingLaneShape = laneShapes.find((s: any) => band.memberIds.every((id: string) => s.bpmnElement.flowNodeRef.some((r: any) => r.id === id)));
      expect(matchingLaneShape, `no lane shape matches band members ${band.memberIds}`).toBeTruthy();
      expect(band.y).toBeCloseTo(matchingLaneShape.bounds.y, 1);
      expect(band.height).toBeCloseTo(matchingLaneShape.bounds.height, 1);
    }
  });

  it('places annotations and groups in a notes area below all pools, not overlapping any pool', async () => {
    const xml = readFileSync(FIXTURE_PATH, 'utf8');
    const moddle = new BpmnModdle();
    const { rootElement: definitions } = await moddle.fromXML(xml);
    const extracted = extractComposition(definitions);
    const originalAnnotationY = extracted.annotations[0].y;
    const originalGroupY = extracted.groups[0].y;

    const { xml: composedXml } = await composePoolsAndLanes(extracted, fakeServices(moddle));

    // composePoolsAndLanes repositions the extracted annotation/group
    // records in place — their original (pre-layout) coordinates should no
    // longer be used once repositioned into the notes area below the pools.
    expect(extracted.annotations[0].y).not.toBe(originalAnnotationY);
    expect(extracted.groups[0].y).not.toBe(originalGroupY);

    const { rootElement: composedDefs } = await moddle.fromXML(composedXml);
    const shapes = composedDefs.diagrams[0].plane.planeElement.filter((pe: any) => pe.$type === 'bpmndi:BPMNShape');
    const poolShapes = shapes.filter((s: any) => s.bpmnElement.$type === 'bpmn:Participant');
    const maxPoolBottom = Math.max(...poolShapes.map((s: any) => s.bounds.y + s.bounds.height));

    expect(extracted.annotations[0].y).toBeGreaterThanOrEqual(maxPoolBottom);
    expect(extracted.groups[0].y).toBeGreaterThanOrEqual(maxPoolBottom);
  });

  it('handles a diagram with no collaboration at all (single process, no lanes) without error', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="start"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="task"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="end"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="task" />
    <bpmn:sequenceFlow id="f2" sourceRef="task" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;
    const moddle = new BpmnModdle();
    const { rootElement: definitions } = await moddle.fromXML(xml);
    const extracted = extractComposition(definitions);
    expect(extracted.hadCollaboration).toBe(false);
    expect(extracted.participants).toHaveLength(1);
    expect(extracted.participants[0].participantId).toBeNull();

    const { xml: composedXml } = await composePoolsAndLanes(extracted, fakeServices(moddle));
    const { rootElement: composedDefs, warnings } = await moddle.fromXML(composedXml);
    expect(warnings).toEqual([]);
    expect(composedDefs.rootElements.some((el: any) => el.$type === 'bpmn:Collaboration')).toBe(false);
    expect(composedDefs.rootElements.find((el: any) => el.$type === 'bpmn:Process').flowElements.length).toBe(5);
  });
});

describe('bboxOfShapes', () => {
  it('computes the bounding box across multiple shapes', () => {
    const shapes = [
      { bounds: { x: 0, y: 0, width: 100, height: 80 } },
      { bounds: { x: 200, y: -50, width: 40, height: 40 } },
    ];
    expect(bboxOfShapes(shapes)).toEqual({ x: 0, y: -50, width: 240, height: 130 });
  });
});
