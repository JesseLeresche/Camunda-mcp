import { layoutProcess } from 'bpmn-auto-layout';

import {
  type Rect, type BpmnServices,
  TYPE_MAP, END_EVENT_DEFS,
  eventDefRefProps, getDefinitions, getBoundaryPosition,
  setMessageSubscription, setZeebeCalledElement, setZeebeTaskDefinition, findOrCreateRootElement,
  DEFAULT_START_X, DEFAULT_Y, DEFAULT_SPACING_X,
} from '../element-shared';
import { buildElementBo, buildFlowBo, seedExpandedHints } from './bo-builders';
import { applyPostProcessing } from './post-process';
import { layoutSubtree } from './subtree';
import { enforcePoolBoundary } from './pool-boundary';
import { addAnnotation, addGroup, validateDiagram } from '../bpmn-tools';

/**
 * Thrown by `buildProcessViaAutoLayout` when the *existing* diagram already
 * has a collaboration/lanes — merging new elements into "the" process and
 * feeding the whole merged XML to `layoutProcess` would silently corrupt it
 * (confirmed: bpmn-auto-layout's own `getProcess()` is a
 * first-bpmn:Process-only lookup, so every other participant, every lane,
 * and every annotation/group would be dropped on import). `buildProcess`
 * catches this specifically and falls back to the old incremental path,
 * which has no such blind spot. `build_process` has no schema field to
 * target a specific participant/lane for a new element anyway, so this
 * isn't a capability regression — just a safety guard against a case the
 * new pipeline was never able to handle correctly.
 */
class CollaborationUnsupportedError extends Error {}

/**
 * Builds elements/flows as a bare semantic tree, merges them into the
 * current diagram's existing content, lays the combination out via
 * bpmn-auto-layout, and imports the result. Returns the logical-id ->
 * real-bpmn-js-id map, same contract as the original incremental
 * modeling.createShape()-based path this replaced for auto-layout requests.
 */
async function buildProcessViaAutoLayout(
  elements: any[],
  flows: any[],
  services: BpmnServices,
): Promise<Record<string, string>> {
  const { moddle, bpmnFactory, injector } = services;

  let modeler: any;
  try {
    modeler = injector.get('modeler');
  } catch {
    modeler = injector.get('bpmnjs');
  }

  // Start from the diagram's current semantic content, not a fresh empty
  // one — build_process is additive (can be called against an
  // already-populated diagram), so a wholesale replace would be destructive.
  const { xml: currentXml } = await modeler.saveXML({ format: false });
  const { rootElement: definitions } = await moddle.fromXML(currentXml);
  const process = definitions.rootElements?.find((el: any) => el.$type === 'bpmn:Process');
  if (!process) throw new Error('No bpmn:Process found in the current diagram');
  if (definitions.rootElements?.some((el: any) => el.$type === 'bpmn:Collaboration') || process.laneSets?.length) {
    throw new CollaborationUnsupportedError();
  }
  if (!process.flowElements) process.flowElements = [];

  const boMap: Record<string, any> = {};
  const idMap: Record<string, string> = {};
  const expandedBos: any[] = [];

  for (const el of elements) {
    const bo = buildElementBo(moddle, bpmnFactory, definitions, process, el, boMap);
    boMap[el.id as string] = bo;
    idMap[el.id as string] = bo.id;
    if (el.type === 'subprocess' && !(el.collapsed ?? false)) {
      expandedBos.push(bo);
    }
  }

  for (const flow of flows) {
    const sourceBo = boMap[flow.from as string];
    const targetBo = boMap[flow.to as string];
    if (!sourceBo) throw new Error(`Flow source "${flow.from}" not found in idMap`);
    if (!targetBo) throw new Error(`Flow target "${flow.to}" not found in idMap`);
    buildFlowBo(moddle, bpmnFactory, sourceBo, targetBo, flow);
  }

  seedExpandedHints(moddle, definitions, process, expandedBos);

  const { xml: mergedXml } = await moddle.toXML(definitions, { format: false });
  const rawLaidOutXml = await layoutProcess(mergedXml);
  const laidOutXml = await applyPostProcessing(rawLaidOutXml, moddle);
  await modeler.importXML(laidOutXml);

  // A single importXML() replacing the whole diagram settles its reactive
  // listeners (including the linting service's report cache) more slowly
  // than the many small incremental modeling.* commands the old pipeline
  // used — confirmed live: validateDiagram()'s forced _update() can still
  // return a stale "missing start event" false-positive several calls after
  // import, well after the actual Modeler UI has already caught up. Give it
  // a short settle delay before anything (validateDiagram, the caller) reads
  // diagram state. Deliberately setTimeout, not requestAnimationFrame —
  // confirmed live that rAF callbacks get throttled/suspended by Chromium
  // when the Modeler window isn't focused/visible (routine during automated
  // testing that creates/switches tabs rapidly), which hung this exact call
  // indefinitely; setTimeout fires on a normal timer regardless of focus.
  await new Promise<void>(r => setTimeout(r, 50));

  return idMap;
}

export async function buildProcess(
  params: Record<string, unknown>,
  services: BpmnServices
) {
  const { modeling, canvas, elementRegistry, moddle, bpmnFactory, commandStack } = services;
  const elements = params.elements as any[];
  const flows = (params.flows as any[]) || [];
  const autoLayoutFlag = (params.autoLayout as boolean) || false;

  const root = canvas.getRootElement();
  if (!root) throw new Error('No diagram is currently open');

  // Confirmed live: an element with no parentId defaults to `root` via
  // resolveParent(), and when root is a bpmn:Collaboration (multiple
  // pools), bpmn-js's own createShape internals crash trying to resolve a
  // FlowElementsContainer for it ("Cannot read properties of undefined
  // (reading 'push')") — neither this old path nor the new autoLayout
  // pipeline has ever supported targeting "the" process inside a
  // collaboration, since this schema has no field to name one. A parentId
  // pointing at an expanded subprocess bypasses root resolution entirely
  // and works fine regardless of collaboration structure — only the
  // no-parentId case is actually broken.
  const rootType = (root as any).businessObject?.$type || (root as any).type;
  if (rootType === 'bpmn:Collaboration' && elements.some((el: any) => !el.parentId)) {
    throw new Error(
      'This diagram has a collaboration (multiple pools) — build_process can only place new elements inside an existing expanded subprocess ("parentId"), since there is no field to target a specific pool/process directly. Use add_element for individual elements inside a specific pool, or target an expanded subprocess via parentId.',
    );
  }

  // bpmn-auto-layout pipeline: builds a semantic tree, merges it into the
  // current diagram, and lays the combination out in one pass. textAnnotation/
  // group aren't flow nodes bpmn-auto-layout can position (it only
  // understands tasks/events/gateways/sequenceFlows) — they're split out
  // here and reapplied live afterward via the same addAnnotation/addGroup
  // functions Phase 3's composition layer already uses, the same pattern
  // (lay out what the engine understands, reapply what it doesn't via live
  // modeling calls) rather than a second, ELK-only code path for this one
  // case. If the *existing* diagram already has a collaboration/lanes,
  // buildProcessViaAutoLayout throws CollaborationUnsupportedError and this
  // falls through to the old incremental path, which has no such blind spot.
  //
  // Snapshot every existing element's bounds *before* attempting
  // buildProcessViaAutoLayout at all — confirmed live (#13) that its own
  // modeler.saveXML() call (needed to read the current diagram) has the
  // same real side effect on live positions found in #10's layoutSubtree:
  // it can shift the whole canvas once, and that shift had already
  // happened by the time the incremental path's own restore snapshot used
  // to be taken (right before this fix), making that snapshot itself
  // already-corrupted and the restore below a no-op. Captured unconditionally
  // here so the incremental path's restore has the true original state
  // regardless of whether buildProcessViaAutoLayout was attempted first.
  const preCreatePositions = new Map<string, { x: number; y: number; width: number; height: number }>(
    elementRegistry.getAll()
      .filter((el: any) => el.x !== undefined && el.type !== 'label')
      .map((el: any) => [el.id, { x: el.x, y: el.y, width: el.width, height: el.height }]),
  );

  if (autoLayoutFlag) {
    try {
      const flowElements = elements.filter((el: any) => el.type !== 'textAnnotation' && el.type !== 'group');
      const decorativeElements = elements.filter((el: any) => el.type === 'textAnnotation' || el.type === 'group');

      const idMap = await buildProcessViaAutoLayout(flowElements, flows, services);

      for (const el of decorativeElements) {
        try {
          const x = (el.x as number) ?? DEFAULT_START_X;
          const y = (el.y as number) ?? DEFAULT_Y;
          const created: any = el.type === 'textAnnotation'
            ? addAnnotation({ text: el.name || '', x, y }, services)
            : addGroup({ name: el.name, x, y, width: el.width || 300, height: el.height || 200 }, services);
          if (created?.elementId) idMap[el.id as string] = created.elementId;
        } catch {
          // best-effort — a decorative element that fails to create shouldn't abort the whole build
        }
      }

      const result: Record<string, unknown> = {
        idMap,
        elementCount: elements.length,
        flowCount: flows.length,
      };
      try {
        result.validation = await validateDiagram({}, services);
      } catch (err: any) {
        result.validation = { issues: [], count: 0, warning: `Validation check failed: ${err.message}` };
      }
      return result;
    } catch (err) {
      if (!(err instanceof CollaborationUnsupportedError)) throw err;
    }
  }

  const idMap: Record<string, string> = {};
  const flowIds: string[] = [];
  let nextX = DEFAULT_START_X;

  // Wrap all element + flow creation in a single undoable compound command
  commandStack.execute('mcp.compound', { fn: () => {

  // Phase 1: Create all elements
  for (const el of elements) {
    const logicalId = el.id as string;
    const typeName = el.type as string;
    const name = el.name as string | undefined;
    const x = (el.x as number) ?? nextX;
    const y = (el.y as number) ?? DEFAULT_Y;

    // Resolve parent: a logical ID created earlier in this same call, or a
    // real element id already on canvas (mirrors resolveParent's
    // validation, used by add_element). Previously this only ever checked
    // idMap and silently fell back to root when a parentId didn't resolve
    // — confirmed live (#10) that targeting a pre-existing subprocess (not
    // created in this call) via parentId silently misrouted to root and,
    // when root is a bpmn:Collaboration, crashed one level later inside
    // bpmn-js's own shape creation — the exact case the upfront
    // Collaboration-safety guard above was meant to prevent.
    let parent = root;
    if (el.parentId) {
      const targetId = idMap[el.parentId] || (el.parentId as string);
      const resolvedParent = elementRegistry.get(targetId);
      if (!resolvedParent) {
        throw new Error(`parentId "${el.parentId}" does not match any element created earlier in this call or already on canvas`);
      }
      const parentBo = resolvedParent.businessObject;
      if (parentBo.$type !== 'bpmn:SubProcess') {
        throw new Error(`parentId "${el.parentId}" resolves to a ${parentBo.$type}, not a bpmn:SubProcess`);
      }
      const isExpanded = (resolvedParent as any).isExpanded ?? (resolvedParent as any).di?.isExpanded ?? false;
      if (!isExpanded) {
        throw new Error(`parentId "${el.parentId}" resolves to a collapsed subprocess — expand it first`);
      }
      parent = resolvedParent;
    }

    let shape: any;

    // Handle typed end events (endEventError, endEventTerminate, etc.)
    if (END_EVENT_DEFS[typeName]) {
      shape = modeling.createShape({ type: 'bpmn:EndEvent' }, { x, y }, parent);
      const bo = shape.businessObject;
      const defType = END_EVENT_DEFS[typeName];
      const refProps = eventDefRefProps(bpmnFactory, moddle, getDefinitions(bo, canvas), defType, el.properties || {});
      const eventDef = moddle.create(defType, refProps);
      eventDef.$parent = bo;
      bo.eventDefinitions = [eventDef];
      modeling.updateProperties(shape, { eventDefinitions: bo.eventDefinitions });
      const endProps = el.properties as any;
      if (defType === 'bpmn:MessageEventDefinition' && endProps?.correlationKey && refProps.messageRef) {
        setMessageSubscription(moddle, refProps.messageRef, endProps.correlationKey);
      }

    // Handle subprocesses
    } else if (typeName === 'subprocess' || typeName === 'callActivity') {
      const bpmnType = TYPE_MAP[typeName];
      const shapeAttrs: any = { type: bpmnType };
      if (typeName === 'subprocess') {
        shapeAttrs.isExpanded = !(el.collapsed ?? false);
      }
      const w = (el.width as number) || 350;
      const h = (el.height as number) || 200;
      shape = modeling.createShape(shapeAttrs, { x, y, width: w, height: h }, parent);
      if (el.calledElement && typeName === 'callActivity') {
        setZeebeCalledElement(moddle, modeling, shape, el.calledElement as string);
      }

    // Handle boundary events
    } else if (typeName === 'boundaryEvent') {
      const hostId = el.attachedToId ? (idMap[el.attachedToId] || el.attachedToId) : undefined;
      if (!hostId) throw new Error(`BoundaryEvent "${logicalId}" requires attachedToId`);
      const host = elementRegistry.get(hostId);
      if (!host) throw new Error(`Host element "${hostId}" not found for BoundaryEvent`);
      const boundaryPos = getBoundaryPosition(host, el.boundaryPosition || 'bottom');
      shape = modeling.createShape(
        { type: 'bpmn:BoundaryEvent', cancelActivity: el.cancelActivity !== false },
        boundaryPos,
        host,
        { attach: true },
      );
      if (el.eventDefinitionType) {
        const bo = shape.businessObject;
        const refProps = eventDefRefProps(bpmnFactory, moddle, getDefinitions(bo, canvas), el.eventDefinitionType, el.properties || {});
        const eventDef = moddle.create(el.eventDefinitionType, refProps);
        eventDef.$parent = bo;
        bo.eventDefinitions = [eventDef];
        modeling.updateProperties(shape, { eventDefinitions: bo.eventDefinitions });
        // Boundary events always "catch" — require correlationKey on the Message itself.
        if (el.eventDefinitionType === 'bpmn:MessageEventDefinition' && el.properties?.correlationKey && refProps.messageRef) {
          setMessageSubscription(moddle, refProps.messageRef, el.properties.correlationKey);
        }
      }

    // Handle start events (typed, e.g. Message Start Event) and intermediate events
    } else if (typeName === 'startEvent' || typeName === 'intermediateCatchEvent' || typeName === 'intermediateThrowEvent') {
      shape = modeling.createShape({ type: TYPE_MAP[typeName] }, { x, y }, parent);
      if (el.eventDefinitionType && el.eventDefinitionType !== 'none') {
        const bo = shape.businessObject;
        const refProps = eventDefRefProps(bpmnFactory, moddle, getDefinitions(bo, canvas), el.eventDefinitionType, el.properties || {});
        const eventDef = moddle.create(el.eventDefinitionType, refProps);
        eventDef.$parent = bo;
        bo.eventDefinitions = [eventDef];
        modeling.updateProperties(shape, { eventDefinitions: bo.eventDefinitions });
        // Only intermediateCatchEvent "catches" — startEvent/intermediateThrowEvent don't correlate.
        if (
          el.eventDefinitionType === 'bpmn:MessageEventDefinition' &&
          typeName === 'intermediateCatchEvent' &&
          el.properties?.correlationKey &&
          refProps.messageRef
        ) {
          setMessageSubscription(moddle, refProps.messageRef, el.properties.correlationKey);
        }
      }

    // Standard elements
    } else {
      const bpmnType = TYPE_MAP[typeName];
      if (!bpmnType) throw new Error(`Unknown element type "${typeName}"`);
      shape = modeling.createShape({ type: bpmnType }, { x, y }, parent);
    }

    // Set label
    if (name) {
      modeling.updateLabel(shape, name);
    }

    // Apply properties
    if (el.properties) {
      const props: any = {};
      if (el.properties.documentation) {
        const doc = moddle.create('bpmn:Documentation', { text: el.properties.documentation });
        props.documentation = [doc];
      }
      if (el.properties.conditionExpression) {
        const expr = moddle.create('bpmn:FormalExpression', { body: el.properties.conditionExpression });
        props.conditionExpression = expr;
      }
      if (el.properties.isExecutable !== undefined) props.isExecutable = el.properties.isExecutable;
      if (el.properties.messageRef && (shape.type === 'bpmn:ReceiveTask' || shape.type === 'bpmn:SendTask')) {
        const definitions = getDefinitions(shape.businessObject, canvas);
        if (definitions) {
          props.messageRef = findOrCreateRootElement(bpmnFactory, definitions, 'bpmn:Message', el.properties.messageRef);
        }
      }
      if (el.properties.correlationKey && shape.type === 'bpmn:ReceiveTask' && moddle.getPackage('zeebe') && props.messageRef) {
        setMessageSubscription(moddle, props.messageRef, el.properties.correlationKey);
      }
      if (el.properties.taskType && moddle.getPackage('zeebe')) {
        setZeebeTaskDefinition(moddle, modeling, shape, el.properties.taskType, el.properties.taskRetries);
      }
      if (Object.keys(props).length > 0) {
        modeling.updateProperties(shape, props);
      }
    }

    idMap[logicalId] = shape.id;
    nextX = x + DEFAULT_SPACING_X;
  }

  // Phase 2: Create all flows
  for (const flow of flows) {
    const sourceRealId = idMap[flow.from];
    const targetRealId = idMap[flow.to];
    if (!sourceRealId) throw new Error(`Flow source "${flow.from}" not found in idMap`);
    if (!targetRealId) throw new Error(`Flow target "${flow.to}" not found in idMap`);

    const source = elementRegistry.get(sourceRealId);
    const target = elementRegistry.get(targetRealId);
    if (!source) throw new Error(`Source element "${sourceRealId}" not found`);
    if (!target) throw new Error(`Target element "${targetRealId}" not found`);

    let connection;
    if (flow.waypoints?.length > 0) {
      connection = modeling.createConnection(source, target, {
        type: 'bpmn:SequenceFlow',
        waypoints: flow.waypoints.map((wp: any) => ({ x: wp.x, y: wp.y })),
      }, source.parent);
    } else {
      connection = modeling.connect(source, target);
    }

    // Set flow name and condition
    if (flow.name) {
      modeling.updateLabel(connection, flow.name);
    }
    if (flow.conditionExpression) {
      const expr = moddle.create('bpmn:FormalExpression', { body: flow.conditionExpression });
      modeling.updateProperties(connection, { conditionExpression: expr });
    }
    if (flow.isDefault) {
      modeling.updateProperties(source, { default: connection.businessObject });
    }

    flowIds.push(connection.id);
  }

  }}); // end mcp.compound — all elements + flows are a single undo step

  // Undo the cascade (#13): restore every pre-existing element outside the
  // newly-created elements' own ancestor chain back to its exact pre-create
  // bounds. Walking .parent up to the root (rather than hardcoding
  // "subprocess + pool" as two levels) handles arbitrary nesting depth —
  // ancestors legitimately may need to have grown to contain new content;
  // everything else must not have changed at all.
  const allowedToChange = new Set<string>();
  for (const realId of Object.values(idMap)) {
    let node: any = elementRegistry.get(realId);
    while (node) {
      allowedToChange.add(node.id);
      node = node.parent;
    }
  }
  for (const [id, original] of preCreatePositions) {
    if (allowedToChange.has(id)) continue;
    const shape = elementRegistry.get(id);
    if (!shape) continue;
    const sizeChanged = shape.width !== original.width || shape.height !== original.height;
    const positionChanged = shape.x !== original.x || shape.y !== original.y;
    if (!sizeChanged && !positionChanged) continue;
    try {
      if (sizeChanged) {
        // resizeShape only — some element types (events) reject resize
        // commands with a fixed, non-resizable size in bpmn-js's rule
        // layer, so only take this path when a real size change needs
        // undoing.
        modeling.resizeShape(shape, { x: original.x, y: original.y, width: original.width, height: original.height });
      } else {
        modeling.moveElements([shape], { x: original.x - shape.x, y: original.y - shape.y });
      }
    } catch {
      // best-effort — leave shapes that can't be restored where they are
    }
  }

  // Same logical-id-or-real-id fallback as the parent-resolution fix above
  // (#10) — a parentId targeting a pre-existing subprocess (not created in
  // this call) has no idMap entry, so without this fallback scopeIds ends
  // up empty. Computed unconditionally (not just under autoLayoutFlag)
  // since enforcePoolBoundary below needs it regardless of auto-layout.
  const scopeIds = new Set(
    elements
      .filter((el: any) => el.parentId)
      .map((el: any) => idMap[el.parentId as string] || (el.parentId as string))
      .filter(Boolean),
  );

  // Constrain any pool that grew to contain a target subprocess so it never
  // visually overlaps a sibling pool — #14. Runs regardless of autoLayout,
  // since the creation-phase growth above (bpmn-js's own automatic
  // container-fit behavior) happens independently of it.
  const warnings: string[] = [];
  for (const scopeId of scopeIds) {
    const boundaryResult = enforcePoolBoundary(scopeId as string, preCreatePositions, services);
    if (boundaryResult.warning) warnings.push(boundaryResult.warning);
  }

  // This incremental path is now only reached for one narrow case:
  // build_process targeting an expanded subprocess (parentId) inside an
  // *existing* collaboration, since that's the one scenario the new
  // bpmn-auto-layout pipeline can't handle (it only ever sees the first
  // bpmn:Process — see CollaborationUnsupportedError). If autoLayout was
  // requested, auto-arrange each distinct target subprocess afterward via
  // the true subtree-scoped primitive (#10) instead of leaving it a no-op.
  // Elements without a (logical, batch-scoped) parentId can't be scoped
  // this way — same bounded limitation as before, just narrower now.
  if (autoLayoutFlag) {
    for (const scopeId of scopeIds) {
      try {
        const layoutResult = await layoutSubtree(scopeId as string, services);
        if (layoutResult.warning) warnings.push(layoutResult.warning);
      } catch {
        // best-effort — a subprocess that can't be auto-arranged shouldn't fail the whole build
      }
    }
  }

  const result: Record<string, unknown> = {
    idMap,
    elementCount: elements.length,
    flowCount: flowIds.length,
  };
  if (warnings.length) result.warnings = warnings;

  // Surface validation in the same turn instead of requiring a separate
  // query_diagram {operation: "validate"} follow-up call — non-blocking,
  // never fails the build itself.
  try {
    result.validation = await validateDiagram({}, services);
  } catch (err: any) {
    result.validation = { issues: [], count: 0, warning: `Validation check failed: ${err.message}` };
  }

  return result;
}
