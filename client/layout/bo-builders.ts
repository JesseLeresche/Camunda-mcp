/**
 * build_process (bpmn-auto-layout pipeline) — moddle-only business-object
 * builders. Builds a bare semantic moddle tree (no positions); the caller
 * (buildProcessViaAutoLayout in ./build-process) merges it into the current
 * diagram, runs bpmn-auto-layout, then imports the fully-laid-out result.
 */

import { TYPE_MAP, END_EVENT_DEFS, eventDefRefProps, findOrCreateRootElement, setMessageSubscription } from '../element-shared';

/** Moddle-only zeebe:TaskDefinition setter — no live shape/modeling.updateProperties needed. */
export function setZeebeTaskDefinitionOnBo(
  moddle: any,
  bo: any,
  taskType: string,
  taskRetries?: string,
): void {
  let extElements = bo.extensionElements;
  if (!extElements) {
    extElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    extElements.$parent = bo;
  }
  if (!extElements.values) extElements.values = [];
  extElements.values = extElements.values.filter((v: any) => v.$type !== 'zeebe:TaskDefinition');
  const taskDef = moddle.create('zeebe:TaskDefinition', { type: taskType, retries: taskRetries || '3' });
  taskDef.$parent = extElements;
  extElements.values.push(taskDef);
  bo.extensionElements = extElements;
}

/** Moddle-only zeebe:CalledElement setter — see setZeebeCalledElement's docs for why this (not the native calledElement attribute) is required. */
export function setZeebeCalledElementOnBo(
  moddle: any,
  bo: any,
  processId: string,
): void {
  let extElements = bo.extensionElements;
  if (!extElements) {
    extElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    extElements.$parent = bo;
  }
  if (!extElements.values) extElements.values = [];
  extElements.values = extElements.values.filter((v: any) => v.$type !== 'zeebe:CalledElement');
  const calledElementDef = moddle.create('zeebe:CalledElement', { processId, propagateAllChildVariables: false });
  calledElementDef.$parent = extElements;
  extElements.values.push(calledElementDef);
  bo.extensionElements = extElements;
}


/**
 * Builds one element's business object (no live shape) and appends it to
 * its container's flowElements. Mirrors buildProcess's original per-type
 * switch (modeling.createShape branch), but constructs bare moddle objects
 * instead of live canvas shapes — bpmn-auto-layout computes all positions
 * itself, so none of this needs x/y or a mounted shape to exist.
 */
export function buildElementBo(
  moddle: any,
  bpmnFactory: any,
  definitions: any,
  process: any,
  el: Record<string, unknown>,
  boMap: Record<string, any>,
): any {
  const typeName = el.type as string;
  const name = el.name as string | undefined;

  // Resolve container: the parent subprocess's flowElements, or the process's.
  let container = process;
  if (el.parentId) {
    const parentBo = boMap[el.parentId as string];
    if (parentBo) container = parentBo;
  }
  if (!container.flowElements) container.flowElements = [];

  let bo: any;

  if (END_EVENT_DEFS[typeName]) {
    bo = bpmnFactory.create('bpmn:EndEvent');
    const defType = END_EVENT_DEFS[typeName];
    const refProps = eventDefRefProps(bpmnFactory, moddle, definitions, defType, (el.properties as any) || {});
    const eventDef = moddle.create(defType, refProps);
    eventDef.$parent = bo;
    bo.eventDefinitions = [eventDef];
    const endProps = el.properties as any;
    if (defType === 'bpmn:MessageEventDefinition' && endProps?.correlationKey && refProps.messageRef) {
      setMessageSubscription(moddle, refProps.messageRef, endProps.correlationKey);
    }

  } else if (typeName === 'subprocess' || typeName === 'callActivity') {
    bo = bpmnFactory.create(TYPE_MAP[typeName]);
    if (el.calledElement && typeName === 'callActivity') {
      setZeebeCalledElementOnBo(moddle, bo, el.calledElement as string);
    }

  } else if (typeName === 'boundaryEvent') {
    const hostBo = el.attachedToId ? boMap[el.attachedToId as string] : undefined;
    if (!hostBo) throw new Error(`BoundaryEvent "${el.id}" requires attachedToId`);
    bo = bpmnFactory.create('bpmn:BoundaryEvent', {
      attachedToRef: hostBo,
      cancelActivity: el.cancelActivity !== false,
    });
    // A boundary event belongs to the same container as its host, not
    // whatever parentId (if any) was given.
    container = hostBo.$parent || process;
    if (!container.flowElements) container.flowElements = [];
    if (el.eventDefinitionType) {
      const refProps = eventDefRefProps(bpmnFactory, moddle, definitions, el.eventDefinitionType as string, (el.properties as any) || {});
      const eventDef = moddle.create(el.eventDefinitionType as string, refProps);
      eventDef.$parent = bo;
      bo.eventDefinitions = [eventDef];
      const props = el.properties as any;
      if (el.eventDefinitionType === 'bpmn:MessageEventDefinition' && props?.correlationKey && refProps.messageRef) {
        setMessageSubscription(moddle, refProps.messageRef, props.correlationKey);
      }
    }

  } else if (typeName === 'startEvent' || typeName === 'intermediateCatchEvent' || typeName === 'intermediateThrowEvent') {
    bo = bpmnFactory.create(TYPE_MAP[typeName]);
    if (el.eventDefinitionType && el.eventDefinitionType !== 'none') {
      const refProps = eventDefRefProps(bpmnFactory, moddle, definitions, el.eventDefinitionType as string, (el.properties as any) || {});
      const eventDef = moddle.create(el.eventDefinitionType as string, refProps);
      eventDef.$parent = bo;
      bo.eventDefinitions = [eventDef];
      const props = el.properties as any;
      if (
        el.eventDefinitionType === 'bpmn:MessageEventDefinition' &&
        typeName === 'intermediateCatchEvent' &&
        props?.correlationKey &&
        refProps.messageRef
      ) {
        setMessageSubscription(moddle, refProps.messageRef, props.correlationKey);
      }
    }

  } else {
    const bpmnType = TYPE_MAP[typeName];
    if (!bpmnType) throw new Error(`Unknown element type "${typeName}"`);
    bo = bpmnFactory.create(bpmnType);
  }

  if (name) bo.name = name;

  const properties = el.properties as any;
  if (properties) {
    if (properties.documentation) {
      const doc = moddle.create('bpmn:Documentation', { text: properties.documentation });
      doc.$parent = bo;
      bo.documentation = [doc];
    }
    if (properties.conditionExpression) {
      const expr = moddle.create('bpmn:FormalExpression', { body: properties.conditionExpression });
      expr.$parent = bo;
      bo.conditionExpression = expr;
    }
    if (properties.isExecutable !== undefined) bo.isExecutable = properties.isExecutable;
    if (properties.messageRef && (bo.$type === 'bpmn:ReceiveTask' || bo.$type === 'bpmn:SendTask')) {
      bo.messageRef = findOrCreateRootElement(bpmnFactory, definitions, 'bpmn:Message', properties.messageRef);
    }
    if (properties.correlationKey && bo.$type === 'bpmn:ReceiveTask' && moddle.getPackage('zeebe') && bo.messageRef) {
      setMessageSubscription(moddle, bo.messageRef, properties.correlationKey);
    }
    if (properties.taskType && moddle.getPackage('zeebe')) {
      setZeebeTaskDefinitionOnBo(moddle, bo, properties.taskType, properties.taskRetries);
    }
  }

  bo.$parent = container;
  container.flowElements.push(bo);
  return bo;
}

/** Builds one sequence flow's business object, wiring source/target incoming/outgoing. */
export function buildFlowBo(
  moddle: any,
  bpmnFactory: any,
  sourceBo: any,
  targetBo: any,
  flow: Record<string, unknown>,
): any {
  const container = sourceBo.$parent;
  if (!container.flowElements) container.flowElements = [];

  const flowBo = bpmnFactory.create('bpmn:SequenceFlow', { sourceRef: sourceBo, targetRef: targetBo });
  flowBo.$parent = container;
  container.flowElements.push(flowBo);

  if (!sourceBo.outgoing) sourceBo.outgoing = [];
  sourceBo.outgoing.push(flowBo);
  if (!targetBo.incoming) targetBo.incoming = [];
  targetBo.incoming.push(flowBo);

  if (flow.name) flowBo.name = flow.name;
  if (flow.conditionExpression) {
    const expr = moddle.create('bpmn:FormalExpression', { body: flow.conditionExpression });
    expr.$parent = flowBo;
    flowBo.conditionExpression = expr;
  }
  if (flow.isDefault) sourceBo.default = flowBo;

  return flowBo;
}

/**
 * Seeds an `isExpanded="true"` DI stub for each given subprocess id — the
 * only documented way to get bpmn-auto-layout to render a subprocess
 * expanded instead of its default collapsed state. Always builds a fresh
 * diagram/plane rather than reusing whatever the input XML already had —
 * any diagram that's already been laid out once (built before, or reloaded
 * from a saved file) has REAL DI for these same elements already, using
 * Camunda's own `<id>_di` convention. Confirmed live that pushing our stub
 * shape alongside an existing one produces a document with two
 * `bpmndi:BPMNShape` elements sharing the identical `id`, which
 * bpmn-auto-layout's internal re-parse can't handle (observed: it silently
 * produced an almost-empty result, wiping a 29-element diagram down to just
 * its bpmn:Process on import). Since bpmn-auto-layout recomputes every
 * position from scratch regardless of what DI it's given (labels aside, it
 * never preserves input bounds/waypoints), discarding existing DI costs
 * nothing.
 */
export function seedExpandedHints(
  moddle: any,
  definitions: any,
  process: any,
  expandedBos: any[],
): void {
  if (expandedBos.length === 0) return;

  const plane = moddle.create('bpmndi:BPMNPlane', { bpmnElement: process, planeElement: [] });
  const diagram = moddle.create('bpmndi:BPMNDiagram', { plane });
  plane.$parent = diagram;
  diagram.$parent = definitions;
  definitions.diagrams = [diagram];

  for (const bo of expandedBos) {
    const bounds = moddle.create('dc:Bounds', { x: 0, y: 0, width: 100, height: 80 });
    // bpmn-auto-layout's own re-parse of this XML only picks up the
    // isExpanded hint via elementsById (see setExpandedPropertyToModdleElements
    // in its source) — that map is keyed by the `id` attribute, so a stub
    // shape without one is silently invisible to it despite being otherwise
    // well-formed. Matches Camunda Modeler's own "<id>_di" DI-id convention.
    const shape = moddle.create('bpmndi:BPMNShape', { id: `${bo.id}_di`, bpmnElement: bo, isExpanded: true, bounds });
    bounds.$parent = shape;
    shape.$parent = plane;
    plane.planeElement.push(shape);
  }
}
