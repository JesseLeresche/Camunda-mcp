/**
 * Shared BPMN-element-building helpers used by both the individual add*
 * element-creation tools (client/elements/create.ts) and build_process's
 * old incremental path (client/layout/build-process.ts) — build_process is
 * doing the same kind of element creation, just via a declarative loop
 * instead of individual tool calls, so it reuses the same low-level pieces.
 */

export interface BpmnServices {
  modeling: any;
  elementRegistry: any;
  canvas: any;
  moddle: any;
  bpmnFactory: any;
  injector: any;
  commandStack: any;
}

export interface Rect { x: number; y: number; width: number; height: number }

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
      && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Check if a line segment intersects a rectangle (simplified AABB test) */
export function segmentIntersectsRect(
  p1: { x: number; y: number }, p2: { x: number; y: number }, rect: Rect, margin = 5
): boolean {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);
  const r = { x: rect.x + margin, y: rect.y + margin, width: rect.width - margin * 2, height: rect.height - margin * 2 };
  if (r.width <= 0 || r.height <= 0) return false;
  // Bounding box overlap check
  return minX < r.x + r.width && maxX > r.x && minY < r.y + r.height && maxY > r.y;
}

/**
 * Resolves the parent element for shape creation.
 * If parentId is provided, looks it up in the element registry — either an
 * expanded subprocess, or a participant/pool (bpmn-js's own
 * UpdateFlowNodeRefsBehavior auto-assigns the correct lane by geometric
 * overlap when a shape is created inside a laned pool, the same mechanism
 * the Modeler UI relies on for drag-and-drop, so no lane-assignment code is
 * needed here).
 * Otherwise falls back to the canvas root element — except when that root
 * is a bpmn:Collaboration (i.e. the diagram has at least one pool), where a
 * silent fallback would hand back a Collaboration business object that has
 * no flowElements array to create into, crashing deep inside bpmn-js after
 * already mutating diagram state. With exactly one participant that's an
 * unambiguous default; with 2+ participants there's no correct guess, so
 * this throws and asks the caller to pass parentId explicitly instead.
 */
export function resolveParent(
  parentId: string | undefined,
  { elementRegistry, canvas }: Pick<BpmnServices, 'elementRegistry' | 'canvas'>
) {
  if (parentId) {
    const parent = elementRegistry.get(parentId);
    if (!parent) throw new Error(`Parent element "${parentId}" not found`);
    const bo = parent.businessObject;
    if (bo.$type === 'bpmn:Participant') {
      return parent;
    }
    if (bo.$type !== 'bpmn:SubProcess') {
      throw new Error(`Parent "${parentId}" is a ${bo.$type}, not a bpmn:SubProcess or bpmn:Participant`);
    }
    const isExpanded = parent.isExpanded ?? parent.di?.isExpanded ?? false;
    if (!isExpanded) {
      throw new Error(`Parent subprocess "${parentId}" is collapsed — expand it first`);
    }
    return parent;
  }
  const root = canvas.getRootElement();
  if (!root) throw new Error('No diagram is currently open — cannot add elements');
  if (root.businessObject?.$type === 'bpmn:Collaboration') {
    const participants = (root.children || []).filter(
      (c: any) => c.businessObject?.$type === 'bpmn:Participant'
    );
    if (participants.length === 1) return participants[0];
    throw new Error(
      'Diagram has multiple pools — pass parentId set to the target participant\'s ID to specify which pool the element belongs in'
    );
  }
  return root;
}

/**
 * Calculates the target position for a boundary event on the host element's perimeter.
 */
export function getBoundaryPosition(
  host: any,
  position: string = 'bottom'
): { x: number; y: number } {
  const hx = host.x;
  const hy = host.y;
  const hw = host.width || 100;
  const hh = host.height || 80;
  switch (position) {
    case 'bottom':       return { x: hx + hw / 2,    y: hy + hh };
    case 'bottom-left':  return { x: hx + hw * 0.25, y: hy + hh };
    case 'bottom-right': return { x: hx + hw * 0.75, y: hy + hh };
    case 'top':          return { x: hx + hw / 2,    y: hy };
    case 'top-left':     return { x: hx + hw * 0.25, y: hy };
    case 'top-right':    return { x: hx + hw * 0.75, y: hy };
    case 'left':         return { x: hx,             y: hy + hh / 2 };
    case 'right':        return { x: hx + hw,        y: hy + hh / 2 };
    default:             return { x: hx + hw / 2,    y: hy + hh };
  }
}

/**
 * Finds an existing root-level bpmn:Error/Message/Signal/Escalation element by
 * name (or id), or creates one under `definitions.rootElements` if none exists.
 * Used to wire up event/task reference properties (errorRef, messageRef, ...)
 * that Camunda validation requires alongside the event definition itself.
 */
export function findOrCreateRootElement(
  bpmnFactory: any,
  definitions: any,
  refType: 'bpmn:Error' | 'bpmn:Message' | 'bpmn:Signal' | 'bpmn:Escalation',
  name: string,
  code?: string,
): any {
  if (!definitions.rootElements) definitions.rootElements = [];
  const existing = definitions.rootElements.find(
    (el: any) => el.$type === refType && (el.name === name || el.id === name)
  );
  if (existing) return existing;

  // Camunda validation requires a non-empty error/escalation code whenever
  // errorRef/escalationRef is set — default it to the name if none was given
  // so this can never be silently left blank.
  const props: Record<string, unknown> = { name };
  if (refType === 'bpmn:Error') props.errorCode = code || name;
  if (refType === 'bpmn:Escalation') props.escalationCode = code || name;

  // Use bpmnFactory (not moddle.create) so the element gets an auto-assigned
  // id via the Ids service — without an id, bpmn-moddle can't serialize a
  // valid xxxRef attribute pointing back at this element (it writes the
  // literal string "undefined" instead).
  const element = bpmnFactory.create(refType, props);
  element.$parent = definitions;
  definitions.rootElements.push(element);
  return element;
}

/**
 * Resolves the errorRef/messageRef/signalRef/escalationRef property (if
 * applicable to eventDefType and present in params) into event-definition
 * constructor props, find-or-creating the referenced root element.
 */
export function eventDefRefProps(
  bpmnFactory: any,
  moddle: any,
  definitions: any,
  eventDefType: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (!definitions) return {};
  const props: Record<string, unknown> = {};
  if (eventDefType === 'bpmn:ErrorEventDefinition' && params.errorRef) {
    props.errorRef = findOrCreateRootElement(bpmnFactory, definitions, 'bpmn:Error', params.errorRef as string, params.errorCode as string | undefined);
  } else if (eventDefType === 'bpmn:MessageEventDefinition' && params.messageRef) {
    props.messageRef = findOrCreateRootElement(bpmnFactory, definitions, 'bpmn:Message', params.messageRef as string);
  } else if (eventDefType === 'bpmn:SignalEventDefinition' && params.signalRef) {
    props.signalRef = findOrCreateRootElement(bpmnFactory, definitions, 'bpmn:Signal', params.signalRef as string);
  } else if (eventDefType === 'bpmn:EscalationEventDefinition' && params.escalationRef) {
    props.escalationRef = findOrCreateRootElement(bpmnFactory, definitions, 'bpmn:Escalation', params.escalationRef as string, params.escalationCode as string | undefined);
  } else if (eventDefType === 'bpmn:TimerEventDefinition' && params.timerValue) {
    const timerType = (params.timerType as string) || 'timeDuration';
    props[timerType] = moddle.create('bpmn:FormalExpression', { body: params.timerValue as string });
  }
  return props;
}

/** Resolves the bpmn:definitions root from a freshly-created shape's business object. */
export function getDefinitions(bo: any, canvas: any): any {
  return bo?.$parent?.$parent || canvas.getRootElement()?.businessObject?.$parent;
}

/**
 * Attaches (or replaces) a zeebe:TaskDefinition extension element on a task,
 * making it a valid Zeebe job worker. Required by Camunda validation for
 * ServiceTask, SendTask, BusinessRuleTask, and ScriptTask — not just ServiceTask.
 */
export function setZeebeTaskDefinition(
  moddle: any,
  modeling: any,
  element: any,
  taskType: string,
  taskRetries?: string,
): void {
  const bo = element.businessObject;
  let extElements = bo.extensionElements;
  if (!extElements) extElements = moddle.create('bpmn:ExtensionElements', { values: [] });
  if (!extElements.values) extElements.values = [];
  extElements.values = extElements.values.filter((v: any) => v.$type !== 'zeebe:TaskDefinition');
  const taskDef = moddle.create('zeebe:TaskDefinition', { type: taskType, retries: taskRetries || '3' });
  extElements.values.push(taskDef);
  modeling.updateProperties(element, { extensionElements: extElements });
}

/**
 * Attaches (or replaces) a zeebe:CalledElement extension element on a
 * CallActivity. `modeling.updateProperties(shape, { calledElement })` sets
 * the native bpmn:CallActivity/@calledElement attribute, which Camunda 8
 * ignores — Zeebe resolves the target process from zeebe:CalledElement's
 * processId instead, so that attribute alone leaves the call activity
 * pointing nowhere despite looking configured.
 */
export function setZeebeCalledElement(
  moddle: any,
  modeling: any,
  element: any,
  processId: string,
): void {
  const bo = element.businessObject;
  let extElements = bo.extensionElements;
  if (!extElements) extElements = moddle.create('bpmn:ExtensionElements', { values: [] });
  if (!extElements.values) extElements.values = [];
  extElements.values = extElements.values.filter((v: any) => v.$type !== 'zeebe:CalledElement');
  const calledElementDef = moddle.create('zeebe:CalledElement', { processId, propagateAllChildVariables: false });
  extElements.values.push(calledElementDef);
  modeling.updateProperties(element, { extensionElements: extElements });
}

/**
 * Attaches (or replaces) a zeebe:Subscription extension element with a
 * correlationKey on the bpmn:Message root element itself — NOT on the
 * consuming Receive Task / Message Catch/Boundary Event. Confirmed via
 * Camunda Modeler's own live linting service (injector.get('linting')):
 * the reported node for this rule is the bpmn:Message, since the
 * correlation key is a property of the message (reusable across every
 * receiver), not of any one consuming element. The Message has no diagram
 * shape, so this mutates its business object directly (same pattern as
 * findOrCreateRootElement) rather than going through modeling.updateProperties.
 */
export function setMessageSubscription(
  moddle: any,
  messageBo: any,
  correlationKey: string,
): void {
  let extElements = messageBo.extensionElements;
  if (!extElements) {
    extElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    extElements.$parent = messageBo;
  }
  if (!extElements.values) extElements.values = [];
  extElements.values = extElements.values.filter((v: any) => v.$type !== 'zeebe:Subscription');
  const subscription = moddle.create('zeebe:Subscription', { correlationKey });
  subscription.$parent = extElements;
  extElements.values.push(subscription);
  messageBo.extensionElements = extElements;
}

// Shared by both client/elements/create.ts and client/layout/{bo-builders,build-process}.ts.
export const TYPE_MAP: Record<string, string> = {
  startEvent: 'bpmn:StartEvent',
  endEvent: 'bpmn:EndEvent',
  task: 'bpmn:Task',
  userTask: 'bpmn:UserTask',
  serviceTask: 'bpmn:ServiceTask',
  sendTask: 'bpmn:SendTask',
  receiveTask: 'bpmn:ReceiveTask',
  scriptTask: 'bpmn:ScriptTask',
  businessRuleTask: 'bpmn:BusinessRuleTask',
  manualTask: 'bpmn:ManualTask',
  exclusiveGateway: 'bpmn:ExclusiveGateway',
  parallelGateway: 'bpmn:ParallelGateway',
  inclusiveGateway: 'bpmn:InclusiveGateway',
  eventBasedGateway: 'bpmn:EventBasedGateway',
  subprocess: 'bpmn:SubProcess',
  callActivity: 'bpmn:CallActivity',
  intermediateCatchEvent: 'bpmn:IntermediateCatchEvent',
  intermediateThrowEvent: 'bpmn:IntermediateThrowEvent',
  boundaryEvent: 'bpmn:BoundaryEvent',
  textAnnotation: 'bpmn:TextAnnotation',
  group: 'bpmn:Group',
};

export const END_EVENT_DEFS: Record<string, string> = {
  endEventError: 'bpmn:ErrorEventDefinition',
  endEventTerminate: 'bpmn:TerminateEventDefinition',
  endEventSignal: 'bpmn:SignalEventDefinition',
  endEventMessage: 'bpmn:MessageEventDefinition',
  endEventEscalation: 'bpmn:EscalationEventDefinition',
};

// Default x spacing for auto-positioned elements
export const DEFAULT_SPACING_X = 180;
export const DEFAULT_START_X = 200;
export const DEFAULT_Y = 200;

// Shared by client/layout/{composition,pool-boundary}.ts.
export const POOL_PADDING = 30;

/**
 * Bounding box across shapes AND their labels (when present) — confirmed
 * live that using shape bounds alone let a centered label on an edge
 * element (e.g. a start event right at a lane's left boundary) overhang
 * past the lane/pool padding computed from that too-tight box, squashing
 * the label against the lane border. Every caller (lane member bboxes, pool
 * content bboxes) wants the true visual extent, not just the shape geometry.
 */
export function bboxOfShapes(shapes: any[]): Rect {
  const rects: Rect[] = [];
  for (const s of shapes) {
    rects.push(s.bounds);
    if (s.label?.bounds) rects.push(s.label.bounds);
  }
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.width));
  const y2 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}
