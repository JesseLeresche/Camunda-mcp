import { layoutProcess } from 'bpmn-auto-layout';

import { type Rect, type BpmnServices, bboxOfShapes } from '../element-shared';
import { seedExpandedHints } from './bo-builders';
import { applyPostProcessing } from './post-process';
import { enforcePoolBoundary } from './pool-boundary';

/** All ids of currently-expanded subprocesses on the live canvas, using the same isExpanded check `validateLayout` uses. */
export function collectExpandedSubprocessIds(elementRegistry: any): Set<string> {
  const ids = new Set<string>();
  for (const el of elementRegistry.getAll()) {
    if (el.type !== 'bpmn:SubProcess') continue;
    const isExpanded = (el as any).isExpanded ?? (el as any).di?.isExpanded ?? false;
    if (isExpanded) ids.add(el.id);
  }
  return ids;
}

/** Recursively finds a flowElement by id, descending into subprocesses. */
export function findFlowElementById(container: any, id: string): any {
  if (!container?.flowElements) return undefined;
  for (const fe of container.flowElements) {
    if (fe.id === id) return fe;
    if (fe.$type === 'bpmn:SubProcess') {
      const found = findFlowElementById(fe, id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Finds `scopeId`'s flow-node container — an expanded bpmn:SubProcess anywhere in the tree, searched across every bpmn:Process root (every participant, if the diagram has a collaboration). */
export function findScopeContainer(definitions: any, scopeId: string): any {
  for (const process of definitions.rootElements?.filter((el: any) => el.$type === 'bpmn:Process') || []) {
    const found = findFlowElementById(process, scopeId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Pure half of the #10 subtree-scoped auto-layout primitive: extracts
 * `scopeId`'s current children into a standalone temp bpmn:Process, lays it
 * out via the normal layoutProcess + Phase 2 post-processing pipeline, and
 * returns the resulting DI shapes/edges. No live services touched here —
 * same moddle-object-transform shape as composePoolsAndLanes, so it's
 * unit-testable against a fixture the same way.
 *
 * TextAnnotation/Group/Association children are excluded from the temp
 * process (layoutProcess only understands flow nodes + sequence flows,
 * same reason Phase 3's extractComposition strips them before ever calling
 * it) and are simply left untouched — they never appear in the returned
 * `shapes`, so the live merge step in `layoutSubtree` below has nothing to
 * move for them.
 */
export async function layoutSubtreeXml(
  definitions: any,
  scopeId: string,
  moddle: any,
  expandedIds: Set<string>,
): Promise<{ shapes: any[]; edges: any[] }> {
  const scopeBo = findScopeContainer(definitions, scopeId);
  if (!scopeBo) throw new Error(`Element "${scopeId}" not found`);
  if (!scopeBo.flowElements?.length) throw new Error(`Element "${scopeId}" has no children to lay out`);

  const layoutableFlowElements = scopeBo.flowElements.filter(
    (fe: any) => fe.$type !== 'bpmn:TextAnnotation' && fe.$type !== 'bpmn:Group' && fe.$type !== 'bpmn:Association',
  );
  if (!layoutableFlowElements.length) throw new Error(`Element "${scopeId}" has no flow-node children to lay out`);

  const tempDefs = moddle.create('bpmn:Definitions', {
    id: 'Definitions_subtree', targetNamespace: 'http://bpmn.io/schema/bpmn', rootElements: [],
  });
  const tempProcess = moddle.create('bpmn:Process', { id: 'Process_subtree', flowElements: layoutableFlowElements });
  tempProcess.$parent = tempDefs;
  for (const fe of layoutableFlowElements) fe.$parent = tempProcess;
  tempDefs.rootElements = [tempProcess];

  const expandedBos: any[] = [];
  for (const id of expandedIds) {
    const bo = findFlowElementById(tempProcess, id);
    if (bo) expandedBos.push(bo);
  }
  seedExpandedHints(moddle, tempDefs, tempProcess, expandedBos);

  const { xml: tempXml } = await moddle.toXML(tempDefs, { format: false });
  const rawLaidOutXml = await layoutProcess(tempXml);
  const postXml = await applyPostProcessing(rawLaidOutXml, moddle);
  const { rootElement: laidOutDefs } = await moddle.fromXML(postXml);
  const planeElements: any[] = laidOutDefs.diagrams[0].plane.planeElement;

  return {
    shapes: planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNShape'),
    edges: planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNEdge'),
  };
}

/**
 * Live half of #10: runs `layoutSubtreeXml` against the current diagram,
 * then merges the result back by moving each live shape to its new
 * position individually via `modeling.moveElements` — same mechanic
 * `correctLanePositions` already uses — instead of a wholesale `importXML`,
 * so content outside `scopeId` is never touched. bpmn-js re-routes each
 * moved shape's connections as part of that command, same as a user
 * dragging it, so internal sequence flows don't need hand-rolled routing.
 *
 * The relaid-out subtree is anchored at its own current top-left corner
 * (not the origin bpmn-auto-layout assigns starting from scratch), so it
 * resettles roughly where it already was instead of jumping to (0,0). If
 * the new layout comes out a different size than before, its containing
 * pool (if any) may need to grow to keep containing it — `enforcePoolBoundary`
 * (#14) constrains that growth so it never visually overlaps a sibling pool,
 * warning instead of forcing an overlap when there's no room to avoid it.
 * Non-pool sibling overlap (e.g. two subprocesses side by side in a flat,
 * non-collaboration process) has no equivalent boundary concept and remains
 * an accepted, documented tradeoff (see #10).
 */
export async function layoutSubtree(scopeId: string, services: BpmnServices): Promise<{ positioned: number; routed: number; warning?: string }> {
  const { moddle, modeling, elementRegistry, injector } = services;
  let modeler: any;
  try {
    modeler = injector.get('modeler');
  } catch {
    modeler = injector.get('bpmnjs');
  }

  // Confirmed live: modeler.saveXML() below has a real side effect on this
  // diagram's *live* element positions (not just the string it returns) —
  // Camunda Modeler normalizes/shifts the whole canvas as part of
  // exporting, at least the first time it's called after an
  // autoLayout-built import. Snapshot every element's position up front so
  // anything outside scopeId can be restored exactly afterward — this
  // primitive's whole contract (#10) is that content outside scope is never
  // touched, and that has to hold regardless of what saveXML does as a
  // side effect underneath it.
  const preSaveXmlPositions = new Map<string, { x: number; y: number; width: number; height: number }>(
    elementRegistry.getAll()
      .filter((el: any) => el.x !== undefined && el.type !== 'label')
      .map((el: any) => [el.id, { x: el.x, y: el.y, width: el.width, height: el.height }]),
  );

  const { xml: currentXml } = await modeler.saveXML({ format: false });
  const { rootElement: definitions } = await moddle.fromXML(currentXml);
  const expandedIds = collectExpandedSubprocessIds(elementRegistry);
  const { shapes, edges } = await layoutSubtreeXml(definitions, scopeId, moddle, expandedIds);

  const liveShapes = shapes
    .map((s: any) => elementRegistry.get(s.bpmnElement.id))
    .filter(Boolean);
  if (liveShapes.length === 0) {
    throw new Error(`Element "${scopeId}" has no children currently on canvas to reposition`);
  }

  const liveBbox = bboxOfShapes(liveShapes.map((s: any) => ({ bounds: { x: s.x, y: s.y, width: s.width, height: s.height } })));
  const laidOutBbox = bboxOfShapes(shapes);
  const dx = liveBbox.x - laidOutBbox.x;
  const dy = liveBbox.y - laidOutBbox.y;

  // Grow the container to fit every target position before moving any
  // child, so it visually contains its relaid-out children afterward.
  // Grow-only — never shrinks it smaller than it already was.
  const scopeShape = elementRegistry.get(scopeId);
  if (scopeShape) {
    const targetRects = shapes.map((s: any) => ({ bounds: { x: s.bounds.x + dx, y: s.bounds.y + dy, width: s.bounds.width, height: s.bounds.height } }));
    const targetsBbox = bboxOfShapes(targetRects);
    const PADDING = 40;
    const minX = Math.min(scopeShape.x, targetsBbox.x - PADDING);
    const minY = Math.min(scopeShape.y, targetsBbox.y - PADDING);
    const maxX = Math.max(scopeShape.x + scopeShape.width, targetsBbox.x + targetsBbox.width + PADDING);
    const maxY = Math.max(scopeShape.y + scopeShape.height, targetsBbox.y + targetsBbox.height + PADDING);
    if (minX < scopeShape.x || minY < scopeShape.y || maxX > scopeShape.x + scopeShape.width || maxY > scopeShape.y + scopeShape.height) {
      try {
        modeling.resizeShape(scopeShape, { x: minX, y: minY, width: maxX - minX, height: maxY - minY });
      } catch {
        // best-effort — individual child moves below still try even if this fails
      }
    }
  }

  for (const s of shapes) {
    const liveShape = elementRegistry.get(s.bpmnElement.id);
    if (!liveShape) continue;
    const moveDx = (s.bounds.x + dx) - liveShape.x;
    const moveDy = (s.bounds.y + dy) - liveShape.y;
    if (moveDx === 0 && moveDy === 0) continue;
    try {
      modeling.moveElements([liveShape], { x: moveDx, y: moveDy });
    } catch {
      // best-effort — leave shapes that can't be moved where they are
    }
  }

  // Undo saveXML's normalization (and anything else unintended) for every
  // element that isn't part of scopeId's own subtree or its ancestor chain
  // — ancestors (e.g. a pool containing scopeId) legitimately may need to
  // have grown to keep containing it, same as buildProcess's analogous
  // restore pass (#13). Restores via resizeShape (full bounds), not just a
  // position move — confirmed live that an ancestor's *size*, not just
  // position, can also get perturbed as a side effect of the work above, so
  // a position-only restore can leave position and size inconsistent.
  const scopedIds = new Set(shapes.map((s: any) => s.bpmnElement.id));
  scopedIds.add(scopeId);
  let ancestor: any = scopeShape?.parent;
  while (ancestor) {
    scopedIds.add(ancestor.id);
    ancestor = ancestor.parent;
  }
  for (const [id, original] of preSaveXmlPositions) {
    if (scopedIds.has(id)) continue;
    const liveShape = elementRegistry.get(id);
    if (!liveShape) continue;
    const sizeChanged = liveShape.width !== original.width || liveShape.height !== original.height;
    const positionChanged = liveShape.x !== original.x || liveShape.y !== original.y;
    if (!sizeChanged && !positionChanged) continue;
    try {
      if (sizeChanged) {
        // resizeShape only — some element types (events) reject resize
        // commands with a fixed, non-resizable size in bpmn-js's rule
        // layer, so only take this path when a real size change needs
        // undoing.
        modeling.resizeShape(liveShape, { x: original.x, y: original.y, width: original.width, height: original.height });
      } else {
        modeling.moveElements([liveShape], { x: original.x - liveShape.x, y: original.y - liveShape.y });
      }
    } catch {
      // best-effort — leave shapes that can't be restored where they are
    }
  }

  const boundaryResult = enforcePoolBoundary(scopeId, preSaveXmlPositions, services);
  const result: { positioned: number; routed: number; warning?: string } = { positioned: shapes.length, routed: edges.length };
  if (boundaryResult.warning) result.warning = boundaryResult.warning;
  return result;
}
