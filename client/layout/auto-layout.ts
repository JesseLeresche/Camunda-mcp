import { layoutProcess } from 'bpmn-auto-layout';

import type { BpmnServices } from '../element-shared';
import { seedExpandedHints } from './bo-builders';
import { applyPostProcessing } from './post-process';
import { collectExpandedSubprocessIds, findFlowElementById, layoutSubtree } from './subtree';
import { layoutViaComposition } from './composition';

/**
 * Standalone `auto_layout` tool, migrated to bpmn-auto-layout. Re-lays out
 * the whole current diagram (positions are replaced wholesale — matches the
 * library's greenfield nature, same interpretation buildProcessViaAutoLayout
 * uses for newly-built content).
 *
 * Collaborations/lanes/annotations/groups route through
 * `layoutViaComposition` (the Phase 3 composition layer) instead of the
 * direct `layoutProcess` call below, which only ever handles a single flat
 * process.
 *
 * `elementId` (subprocess-scoped layout) is handled upfront by
 * `layoutSubtree` (#10) before either of those paths is reached — true
 * subtree-only layout (extract just that subprocess's children, lay out in
 * isolation, merge positions back without touching anything else), not a
 * whole-diagram-widening fallback.
 */
export async function layoutDiagramViaAutoLayout(
  params: Record<string, unknown>,
  services: BpmnServices,
): Promise<any> {
  const { moddle, injector, elementRegistry } = services;
  const scopeId = params.elementId as string | undefined;

  if (scopeId) {
    return await layoutSubtree(scopeId, services);
  }

  let modeler: any;
  try {
    modeler = injector.get('modeler');
  } catch {
    modeler = injector.get('bpmnjs');
  }

  const { xml: currentXml } = await modeler.saveXML({ format: false });
  const { rootElement: definitions } = await moddle.fromXML(currentXml);
  const process = definitions.rootElements?.find((el: any) => el.$type === 'bpmn:Process');
  if (!process) throw new Error('No bpmn:Process found in the current diagram');

  const hasCollaboration = definitions.rootElements?.some((el: any) => el.$type === 'bpmn:Collaboration');
  const hasLanes = !!process.laneSets?.length;
  // bpmn:TextAnnotation/bpmn:Group are Artifact subtypes, stored on
  // bpmn:Process#artifacts — a property entirely separate from
  // #flowElements (confirmed against the bpmn-moddle schema). Checking
  // only flowElements meant a diagram with annotations/groups but no
  // pools/lanes never triggered the composition path at all, silently
  // taking the plain layoutProcess route instead — which doesn't preserve
  // Artifact DI, so they'd end up semantically present but invisible on
  // canvas 100% of the time for exactly this diagram shape.
  const hasAnnotationsOrGroups = [...(process.flowElements || []), ...(process.artifacts || [])].some(
    (fe: any) => fe.$type === 'bpmn:TextAnnotation' || fe.$type === 'bpmn:Group',
  );
  if (hasCollaboration || hasLanes || hasAnnotationsOrGroups) {
    try {
      return await layoutViaComposition(currentXml, services);
    } catch (err: any) {
      // No ELK fallback (removed entirely, see #9) — surface a clear error
      // instead of silently degrading to a different, unmaintained engine.
      throw new Error(`Pool/lane/annotation/group layout failed: ${err.message}`);
    }
  }

  const expandedIds = collectExpandedSubprocessIds(elementRegistry);
  const expandedBos: any[] = [];
  for (const id of expandedIds) {
    const bo = findFlowElementById(process, id);
    if (bo) expandedBos.push(bo);
  }
  seedExpandedHints(moddle, definitions, process, expandedBos);

  const { xml: mergedXml } = await moddle.toXML(definitions, { format: false });
  const rawLaidOutXml = await layoutProcess(mergedXml);
  const laidOutXml = await applyPostProcessing(rawLaidOutXml, moddle);
  await modeler.importXML(laidOutXml);

  await new Promise<void>(r => setTimeout(r, 50));

  const { rootElement: laidOutDefs } = await moddle.fromXML(laidOutXml);
  const planeElements: any[] = laidOutDefs.diagrams?.[0]?.plane?.planeElement || [];
  const positioned = planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNShape').length;
  const routed = planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNEdge').length;

  const result: Record<string, unknown> = { positioned, routed };
  return result;
}
