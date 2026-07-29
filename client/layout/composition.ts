import { layoutProcess } from 'bpmn-auto-layout';

import { type Rect, type BpmnServices, bboxOfShapes, POOL_PADDING } from '../element-shared';
import { seedExpandedHints } from './bo-builders';
import { applyPostProcessing } from './post-process';
import { collectExpandedSubprocessIds, findFlowElementById } from './subtree';
import { addMessageFlow, addAnnotation, addGroup } from '../elements/create';

export interface ParticipantCore {
  participantId: string | null; // null when there's no bpmn:Collaboration wrapper
  participantName?: string;
  processBo: any;
  laneInfos: { id: string; name?: string; memberIds: string[] }[];
}

export interface ExtractedComposition {
  hadCollaboration: boolean;
  collaborationId?: string;
  participants: ParticipantCore[];
  messageFlows: { id: string; name?: string; sourceId: string; targetId: string }[];
  annotations: { id: string; text: string; x: number; y: number; width: number; height: number; associatedIds: string[] }[];
  groups: { id: string; name?: string; x: number; y: number; width: number; height: number }[];
}

/**
 * Pulls every collaboration/lane/annotation/group/message-flow out of a
 * parsed diagram, leaving each participant's `processBo` holding only its
 * flow nodes and sequence flows — the one thing `layoutProcess` can
 * actually handle. Lane membership is read directly from each `bpmn:Lane`'s
 * existing `flowNodeRef` array (already the authoritative membership list —
 * no need to infer it from geometry).
 */
export function extractComposition(definitions: any): ExtractedComposition {
  const collaboration = definitions.rootElements?.find((el: any) => el.$type === 'bpmn:Collaboration') || null;
  const participants: ParticipantCore[] = [];
  const messageFlows: ExtractedComposition['messageFlows'] = [];
  const annotations: ExtractedComposition['annotations'] = [];
  const groups: ExtractedComposition['groups'] = [];

  const plane = definitions.diagrams?.[0]?.plane;
  const shapeById = new Map<string, any>();
  for (const pe of plane?.planeElement || []) {
    if (pe.$type === 'bpmndi:BPMNShape' && pe.bpmnElement) shapeById.set(pe.bpmnElement.id, pe);
  }

  const sources = collaboration
    ? collaboration.participants.map((p: any) => ({ participantBo: p, processBo: p.processRef }))
    : [{ participantBo: null, processBo: definitions.rootElements.find((el: any) => el.$type === 'bpmn:Process') }];

  const collectArtifact = (fe: any) => {
    if (fe.$type === 'bpmn:TextAnnotation') {
      const shape = shapeById.get(fe.id);
      annotations.push({
        id: fe.id, text: fe.text || '',
        x: shape?.bounds?.x ?? 100, y: shape?.bounds?.y ?? 100,
        width: shape?.bounds?.width ?? 100, height: shape?.bounds?.height ?? 80,
        associatedIds: [],
      });
      return true;
    }
    if (fe.$type === 'bpmn:Group') {
      const shape = shapeById.get(fe.id);
      groups.push({
        id: fe.id, name: fe.categoryValueRef?.value,
        x: shape?.bounds?.x ?? 100, y: shape?.bounds?.y ?? 100,
        width: shape?.bounds?.width ?? 300, height: shape?.bounds?.height ?? 200,
      });
      return true;
    }
    if (fe.$type === 'bpmn:Association') {
      const sourceId = fe.sourceRef?.id, targetId = fe.targetRef?.id;
      const ann = annotations.find((a) => a.id === sourceId || a.id === targetId);
      if (ann) {
        const otherId = ann.id === sourceId ? targetId : sourceId;
        if (otherId) ann.associatedIds.push(otherId);
      }
      return true;
    }
    return false;
  };

  for (const { participantBo, processBo } of sources) {
    if (!processBo) continue;

    const laneInfos: ParticipantCore['laneInfos'] = [];
    for (const laneSet of processBo.laneSets || []) {
      for (const lane of laneSet.lanes || []) {
        laneInfos.push({ id: lane.id, name: lane.name, memberIds: (lane.flowNodeRef || []).map((ref: any) => ref.id) });
      }
    }

    const kept: any[] = [];
    for (const fe of processBo.flowElements || []) {
      if (!collectArtifact(fe)) kept.push(fe);
    }
    processBo.flowElements = kept;

    // TextAnnotation/Group/Association are Artifact subtypes, stored on
    // bpmn:Process#artifacts — a property separate from #flowElements (the
    // collaboration-level loop below already reads collaboration.artifacts
    // correctly; this was the missing per-participant equivalent, so any
    // annotation/group attached directly to a specific pool's process
    // rather than the collaboration root was silently invisible to
    // extraction entirely, never even attempted for restoration).
    const keptArtifacts: any[] = [];
    for (const art of processBo.artifacts || []) {
      if (!collectArtifact(art)) keptArtifacts.push(art);
    }
    processBo.artifacts = keptArtifacts;

    processBo.laneSets = [];

    participants.push({ participantId: participantBo?.id ?? null, participantName: participantBo?.name, processBo, laneInfos });
  }

  for (const mf of collaboration?.messageFlows || []) {
    messageFlows.push({ id: mf.id, name: mf.name, sourceId: mf.sourceRef?.id, targetId: mf.targetRef?.id });
  }
  for (const art of collaboration?.artifacts || []) collectArtifact(art);

  return { hadCollaboration: !!collaboration, collaborationId: collaboration?.id, participants, messageFlows, annotations, groups };
}

/** Pure translation — always safe (preserves every segment's orthogonality and every shape's size) unlike shifting nodes relative to each other. */
function translateShapesAndEdges(shapes: any[], edges: any[], dx: number, dy: number): void {
  for (const s of shapes) {
    s.bounds.x += dx; s.bounds.y += dy;
    if (s.label?.bounds) { s.label.bounds.x += dx; s.label.bounds.y += dy; }
  }
  for (const e of edges) {
    for (const p of e.waypoint) { p.x += dx; p.y += dy; }
    if (e.label?.bounds) { e.label.bounds.x += dx; e.label.bounds.y += dy; }
  }
}

const POOL_LABEL_BAND = 30;
const LANE_PADDING = 20;
const STACK_GAP = 60;

/**
 * Lays out each participant's flow-node core independently via the normal
 * Phase 1 + Phase 2 pipeline, stacks the results vertically (pure
 * translation per participant — never touches individual node positions
 * relative to each other, so orthogonality and validity are guaranteed),
 * and rebuilds pool/lane DI around the translated positions.
 *
 * Lane bounds are computed from each lane's actual post-layout member
 * positions and stacked in declaration order. `layoutProcess` has zero lane
 * awareness, so it can legitimately interleave two lanes' members in Y —
 * when that happens, a clean non-overlapping stack isn't achievable without
 * either re-routing edges or moving nodes independently of the graph
 * layout, both of which risk corrupting a result that's otherwise fully
 * correct. Rather than attempt that, this detects the conflict, still draws
 * each lane's bounds around its own members (bands may overlap in that
 * case), and reports it via `warnings` — mirrors `validateLayout`'s
 * existing "detect and report" philosophy for `subprocess_too_small`.
 *
 * Message flows, annotations, groups, and associations are deliberately
 * NOT rebuilt here — they get reapplied after import via the existing live
 * `addMessageFlow`/`addAnnotation`/`addGroup` modeling calls, which compute
 * their own correct DI, rather than hand-building connection routing here.
 */
interface LaneBand {
  memberIds: string[];
  y: number;
  height: number;
}

export async function composePoolsAndLanes(
  extracted: ExtractedComposition,
  services: BpmnServices,
): Promise<{ xml: string; warnings: string[]; laneBands: LaneBand[] }> {
  const { moddle, elementRegistry } = services;
  const warnings: string[] = [];
  const laneBands: LaneBand[] = [];

  const definitions = moddle.create('bpmn:Definitions', {
    id: 'Definitions_composed', targetNamespace: 'http://bpmn.io/schema/bpmn', rootElements: [],
  });

  let collaboration: any = null;
  if (extracted.hadCollaboration) {
    collaboration = moddle.create('bpmn:Collaboration', { id: extracted.collaborationId || 'Collaboration_composed', participants: [], messageFlows: [] });
    collaboration.$parent = definitions;
    definitions.rootElements.push(collaboration);
  }

  const plane = moddle.create('bpmndi:BPMNPlane', { planeElement: [] });
  const diagram = moddle.create('bpmndi:BPMNDiagram', { plane });
  plane.$parent = diagram;
  diagram.$parent = definitions;
  definitions.diagrams = [diagram];

  const allExpandedIds = collectExpandedSubprocessIds(elementRegistry);
  let stackY = 0;
  let firstLaidOutProcess: any = null;

  for (const participant of extracted.participants) {
    const tempDefs = moddle.create('bpmn:Definitions', { id: `Definitions_tmp_${participant.processBo.id}`, targetNamespace: 'http://bpmn.io/schema/bpmn', rootElements: [participant.processBo] });
    participant.processBo.$parent = tempDefs;

    const expandedBos: any[] = [];
    for (const id of allExpandedIds) {
      const bo = findFlowElementById(participant.processBo, id);
      if (bo) expandedBos.push(bo);
    }
    seedExpandedHints(moddle, tempDefs, participant.processBo, expandedBos);

    const { xml: tempXml } = await moddle.toXML(tempDefs, { format: false });
    const rawLaidOutXml = await layoutProcess(tempXml);
    const postXml = await applyPostProcessing(rawLaidOutXml, moddle);
    const { rootElement: laidOutDefs } = await moddle.fromXML(postXml);
    const laidOutProcess = laidOutDefs.rootElements.find((el: any) => el.$type === 'bpmn:Process');
    const laidOutPlaneElements: any[] = laidOutDefs.diagrams[0].plane.planeElement;
    const shapes = laidOutPlaneElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNShape');
    const edges = laidOutPlaneElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNEdge');

    if (!firstLaidOutProcess) firstLaidOutProcess = laidOutProcess;

    const bbox = bboxOfShapes(shapes);
    const marginX = POOL_PADDING + (extracted.hadCollaboration ? POOL_LABEL_BAND : 0);
    const dx = -bbox.x + marginX;
    const dy = -bbox.y + stackY + POOL_PADDING;
    translateShapesAndEdges(shapes, edges, dx, dy);
    for (const s of shapes) plane.planeElement.push(s);
    for (const e of edges) plane.planeElement.push(e);
    const contentRect: Rect = { x: bbox.x + dx, y: bbox.y + dy, width: bbox.width, height: bbox.height };

    const shapeById = new Map<string, any>(shapes.map((s: any) => [s.bpmnElement.id, s]));
    let contentBottom = contentRect.y + contentRect.height + POOL_PADDING;

    if (participant.laneInfos.length > 0) {
      const laneSet = moddle.create('bpmn:LaneSet', { id: `LaneSet_${participant.processBo.id}`, lanes: [] });
      laneSet.$parent = laidOutProcess;
      laidOutProcess.laneSets = [laneSet];

      const laneEntries = participant.laneInfos.map((laneInfo) => {
        const memberShapes = laneInfo.memberIds.map((id) => shapeById.get(id)).filter(Boolean);
        const rect = memberShapes.length > 0 ? bboxOfShapes(memberShapes) : { x: contentRect.x, y: contentRect.y, width: contentRect.width, height: 80 };
        const memberBos = laneInfo.memberIds.map((id) => findFlowElementById(laidOutProcess, id)).filter(Boolean);
        return { laneInfo, rect, memberBos };
      });

      let interleaved = false;
      for (let i = 1; i < laneEntries.length; i++) {
        if (laneEntries[i].rect.y < laneEntries[i - 1].rect.y + laneEntries[i - 1].rect.height) { interleaved = true; break; }
      }
      if (interleaved) {
        warnings.push(
          `Lanes in participant "${participant.participantName || participant.participantId || participant.processBo.id}" were interleaved by bpmn-auto-layout's lane-unaware layout and have been repositioned into their correct bands (moving the affected elements and re-routing their connections); worth a visual check since it's a best-effort correction, not a lane-aware re-layout.`,
        );
      }

      const laneMinX = contentRect.x - LANE_PADDING;
      const laneWidth = contentRect.width + LANE_PADDING * 2;
      let laneY = contentRect.y - LANE_PADDING;
      for (const { laneInfo, rect, memberBos } of laneEntries) {
        const lane = moddle.create('bpmn:Lane', { id: laneInfo.id, name: laneInfo.name, flowNodeRef: memberBos });
        lane.$parent = laneSet;
        laneSet.lanes.push(lane);
        const laneHeight = rect.height + LANE_PADDING * 2;
        const laneBounds = moddle.create('dc:Bounds', { x: laneMinX, y: laneY, width: laneWidth, height: laneHeight });
        const laneShape = moddle.create('bpmndi:BPMNShape', { id: `${lane.id}_di`, bpmnElement: lane, bounds: laneBounds, isHorizontal: true });
        laneBounds.$parent = laneShape; laneShape.$parent = plane;
        plane.planeElement.unshift(laneShape); // lanes render behind flow nodes
        laneBands.push({ memberIds: laneInfo.memberIds, y: laneY, height: laneHeight });
        laneY += laneHeight;
      }
      contentBottom = laneY + POOL_PADDING;
    }

    laidOutProcess.$parent = definitions;
    definitions.rootElements.push(laidOutProcess);

    if (extracted.hadCollaboration) {
      const participantBo = moddle.create('bpmn:Participant', { id: participant.participantId!, name: participant.participantName, processRef: laidOutProcess });
      participantBo.$parent = collaboration;
      collaboration.participants.push(participantBo);

      const poolBounds = moddle.create('dc:Bounds', {
        x: contentRect.x - POOL_PADDING - POOL_LABEL_BAND, y: contentRect.y - POOL_PADDING,
        width: contentRect.width + POOL_PADDING * 2 + POOL_LABEL_BAND, height: contentBottom - (contentRect.y - POOL_PADDING),
      });
      const poolShape = moddle.create('bpmndi:BPMNShape', { id: `${participantBo.id}_di`, bpmnElement: participantBo, bounds: poolBounds, isHorizontal: true });
      poolBounds.$parent = poolShape; poolShape.$parent = plane;
      plane.planeElement.unshift(poolShape); // pool renders behind everything inside it

      stackY = contentBottom + STACK_GAP;
    } else {
      stackY = contentBottom + STACK_GAP;
    }
  }

  plane.bpmnElement = extracted.hadCollaboration ? collaboration : firstLaidOutProcess;

  // Place annotations/groups in a dedicated notes area below all pools,
  // rather than trying to preserve their original coordinates — confirmed
  // live that keeping the original position let a group sized/placed
  // relative to the *old* layout overlap or overhang past a pool whose
  // final bounds came out a different shape. A fixed area below everything
  // is never at risk of colliding with pool/lane content, at the cost of
  // not staying visually "attached" to whatever it originally annotated.
  const notesX0 = extracted.hadCollaboration ? POOL_LABEL_BAND : 0;
  let noteX = notesX0;
  const noteY = stackY;
  for (const ann of extracted.annotations) {
    ann.x = noteX;
    ann.y = noteY;
    noteX += ann.width + POOL_PADDING;
  }
  let groupY = noteY;
  if (extracted.annotations.length > 0) {
    groupY += Math.max(...extracted.annotations.map((a) => a.height)) + POOL_PADDING;
  }
  noteX = notesX0;
  for (const grp of extracted.groups) {
    grp.x = noteX;
    grp.y = groupY;
    noteX += grp.width + POOL_PADDING;
  }

  const { xml } = await moddle.toXML(definitions, { format: false });
  return { xml, warnings, laneBands };
}

/**
 * Reapplies message flows, annotations, groups, and their associations
 * after import — live `modeling.*` calls compute correct DI/routing
 * themselves, so there's no need to hand-build any of it pre-import.
 * Elements keep their original ids through the moddle round-trip, so
 * `elementRegistry.get(originalId)` reliably finds the right live shape.
 *
 * Each restoration is best-effort (an endpoint that no longer resolves
 * shouldn't fail the whole layout run), but a silently dropped artifact is
 * indistinguishable from one that was never there — so every failure is
 * reported back via the returned warnings instead of swallowed, mirroring
 * `composePoolsAndLanes`'s existing lane-interleaving warning.
 */
async function reapplyArtifacts(extracted: ExtractedComposition, services: BpmnServices): Promise<string[]> {
  const warnings: string[] = [];
  for (const mf of extracted.messageFlows) {
    try {
      addMessageFlow({ sourceId: mf.sourceId, targetId: mf.targetId, name: mf.name }, services);
    } catch (err: any) {
      warnings.push(`Message flow "${mf.name || mf.id}" could not be restored: ${err.message || err}`);
    }
  }
  const { elementRegistry, modeling } = services;
  for (const ann of extracted.annotations) {
    try {
      const [firstTarget, ...rest] = ann.associatedIds;
      // Prefer placing it right below its associated element's actual
      // final position (post lane-correction) instead of the shared notes
      // area — confirmed live that using the notes area for an annotation
      // WITH an association produced a valid but visually absurd result: a
      // single Association line stretching diagonally across the entire
      // diagram to reach it. Below (not beside/above) is deliberate: the
      // row directly below a flow element is far more likely to be open
      // space than left/right (which risk colliding with the next element
      // in sequence) or above (which risks escaping past the lane/pool's
      // own top edge for elements sitting near it, as "Review Request"
      // does here). Orphan annotations with no association keep the
      // notes-area fallback position computed in composePoolsAndLanes,
      // since they have no natural anchor to place near.
      let x = ann.x, y = ann.y;
      const targetShape = firstTarget ? elementRegistry.get(firstTarget) : null;
      if (targetShape) {
        x = targetShape.x;
        y = targetShape.y + targetShape.height + POOL_PADDING;
      }
      const result = addAnnotation({ text: ann.text, x, y, attachToId: firstTarget }, services) as any;
      const annotationShape = elementRegistry.get(result.elementId);
      for (const targetId of rest) {
        const target = elementRegistry.get(targetId);
        if (annotationShape && target) modeling.connect(annotationShape, target, { type: 'bpmn:Association' });
      }
    } catch (err: any) {
      warnings.push(`Annotation "${ann.text || ann.id}" could not be restored: ${err.message || err}`);
    }
  }
  for (const grp of extracted.groups) {
    try {
      addGroup({ name: grp.name, x: grp.x, y: grp.y, width: grp.width, height: grp.height }, services);
    } catch (err: any) {
      warnings.push(`Group "${grp.name || grp.id}" could not be restored: ${err.message || err}`);
    }
  }
  return warnings;
}

/**
 * Live post-import correction pass: for any lane member whose actual Y
 * position falls outside its lane's assigned band (bpmn-auto-layout has no
 * lane awareness, so this happens whenever a branch/exception path in the
 * graph lands above or below where its lane says it should be —
 * `composePoolsAndLanes` only draws the band boundary, it never moves
 * shapes into it), nudges the *whole out-of-band group within that lane*
 * (preserving their relative spacing, not collapsing them onto each other)
 * so its center lands in the band's center. Uses `modeling.moveElements` —
 * bpmn-js re-routes connected edges (including ones crossing into a
 * different lane) as part of that command, the same as a user dragging a
 * shape, so there's no need to hand-roll edge re-routing here.
 */
function correctLanePositions(laneBands: LaneBand[], services: BpmnServices): string[] {
  const { elementRegistry, modeling } = services;
  const warnings: string[] = [];
  for (const band of laneBands) {
    const bandTop = band.y;
    const bandBottom = band.y + band.height;
    const outOfBand: any[] = [];
    for (const id of band.memberIds) {
      const shape = elementRegistry.get(id);
      if (!shape) continue;
      const centerY = shape.y + shape.height / 2;
      if (centerY < bandTop || centerY > bandBottom) outOfBand.push(shape);
    }
    if (outOfBand.length === 0) continue;

    const minY = Math.min(...outOfBand.map((s: any) => s.y));
    const maxY = Math.max(...outOfBand.map((s: any) => s.y + s.height));
    const dy = (band.y + band.height / 2) - (minY + maxY) / 2;

    for (const shape of outOfBand) {
      try {
        modeling.moveElements([shape], { x: 0, y: dy });
      } catch (err: any) {
        warnings.push(`Element "${shape.businessObject?.name || shape.id}" could not be repositioned into its lane band: ${err.message || err}`);
      }
    }
  }
  return warnings;
}

export async function layoutViaComposition(currentXml: string, services: BpmnServices): Promise<any> {
  const { moddle, injector } = services;
  let modeler: any;
  try {
    modeler = injector.get('modeler');
  } catch {
    modeler = injector.get('bpmnjs');
  }

  const { rootElement: definitions } = await moddle.fromXML(currentXml);
  const extracted = extractComposition(definitions);
  const { xml: composedXml, warnings, laneBands } = await composePoolsAndLanes(extracted, services);
  await modeler.importXML(composedXml);

  await new Promise<void>(r => setTimeout(r, 50));

  warnings.push(...correctLanePositions(laneBands, services));

  await new Promise<void>(r => setTimeout(r, 50));

  warnings.push(...await reapplyArtifacts(extracted, services));

  await new Promise<void>(r => setTimeout(r, 50));

  const { rootElement: finalDefs } = await moddle.fromXML(composedXml);
  const planeElements: any[] = finalDefs.diagrams?.[0]?.plane?.planeElement || [];
  const positioned = planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNShape').length + extracted.annotations.length + extracted.groups.length;
  const routed = planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNEdge').length + extracted.messageFlows.length;

  const result: Record<string, unknown> = { positioned, routed, participants: extracted.participants.length };
  if (warnings.length) result.warnings = warnings;
  return result;
}
