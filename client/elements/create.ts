/**
 * Element-creation primitive tools: add* functions that create new BPMN
 * shapes/connections on the canvas. Shares low-level BPMN-building helpers
 * with build_process's old incremental path (client/layout/build-process.ts)
 * via ../element-shared.
 */

import {
  type BpmnServices,
  resolveParent, getBoundaryPosition, findOrCreateRootElement, eventDefRefProps, getDefinitions,
  setZeebeTaskDefinition, setZeebeCalledElement, setMessageSubscription,
} from '../element-shared';

export function addStartEvent(
  params: Record<string, unknown>,
  { modeling, canvas, elementRegistry, moddle, bpmnFactory }: BpmnServices
) {
  const name = (params.name as string) || 'Start';
  const x = (params.x as number) || 200;
  const y = (params.y as number) || 200;
  const parentId = params.parentId as string | undefined;
  const eventDefType = (params.eventDefinitionType as string) || 'none';

  const parent = resolveParent(parentId, { elementRegistry, canvas });

  const shape = modeling.createShape(
    { type: 'bpmn:StartEvent' },
    { x, y },
    parent
  );

  // A process may only have one *blank* (no event definition) start event —
  // typing this one (e.g. as a Message Start Event) lets it coexist with
  // other distinct triggers modeled the same way.
  if (eventDefType !== 'none') {
    const bo = shape.businessObject;
    const definitions = getDefinitions(bo, canvas);
    const eventDefProps: any = eventDefRefProps(bpmnFactory, moddle, definitions, eventDefType, params);
    const eventDef = moddle.create(eventDefType, eventDefProps);
    bo.eventDefinitions = bo.eventDefinitions || [];
    bo.eventDefinitions.push(eventDef);
    eventDef.$parent = bo;
    modeling.updateProperties(shape, { eventDefinitions: bo.eventDefinitions });
  }

  if (name) {
    modeling.updateLabel(shape, name);
  }

  return { elementId: shape.id, eventDefinitionType: eventDefType, name, x: shape.x, y: shape.y };
}

export function addTask(
  params: Record<string, unknown>,
  { modeling, canvas, elementRegistry, moddle, bpmnFactory }: BpmnServices
) {
  const type = (params.type as string) || 'bpmn:Task';
  const name = (params.name as string) || '';
  const x = (params.x as number) || 400;
  const y = (params.y as number) || 200;
  const parentId = params.parentId as string | undefined;
  const messageRef = params.messageRef as string | undefined;
  const taskType = params.taskType as string | undefined;

  const parent = resolveParent(parentId, { elementRegistry, canvas });

  const shape = modeling.createShape(
    { type },
    { x, y, width: 100, height: 80 },
    parent
  );

  if (name) {
    modeling.updateLabel(shape, name);
  }

  // Job-worker task types (Service/Send/BusinessRule/Script) require a Zeebe
  // task definition for Camunda validation — settable here at creation time
  // instead of a required follow-up set_properties/patch_element call.
  if (taskType && moddle.getPackage('zeebe')) {
    setZeebeTaskDefinition(moddle, modeling, shape, taskType, params.taskRetries as string | undefined);
  }

  // ReceiveTask requires a Message Reference for Camunda validation; SendTask
  // may optionally carry one too (both have a messageRef attribute in BPMN).
  let message: any;
  if (messageRef && (type === 'bpmn:ReceiveTask' || type === 'bpmn:SendTask')) {
    const bo = shape.businessObject;
    const definitions = getDefinitions(bo, canvas);
    if (definitions) {
      message = findOrCreateRootElement(bpmnFactory, definitions, 'bpmn:Message', messageRef);
      modeling.updateProperties(shape, { messageRef: message });
    }
  }

  // ReceiveTask requires a subscription correlationKey on the Message itself
  // (not the task) — Zeebe needs it to correlate the incoming message
  // against a running process instance.
  const correlationKey = params.correlationKey as string | undefined;
  if (correlationKey && type === 'bpmn:ReceiveTask' && message) {
    setMessageSubscription(moddle, message, correlationKey);
  }

  return { elementId: shape.id, type, name, x: shape.x, y: shape.y };
}

export function addEndEvent(
  params: Record<string, unknown>,
  { modeling, canvas, elementRegistry }: BpmnServices
) {
  const name = (params.name as string) || '';
  const x = (params.x as number) || 600;
  const y = (params.y as number) || 200;
  const parentId = params.parentId as string | undefined;

  const parent = resolveParent(parentId, { elementRegistry, canvas });

  const shape = modeling.createShape(
    { type: 'bpmn:EndEvent' },
    { x, y },
    parent
  );

  if (name) {
    modeling.updateLabel(shape, name);
  }

  return { elementId: shape.id, name, x: shape.x, y: shape.y };
}

export function connectElements(
  params: Record<string, unknown>,
  { modeling, elementRegistry, moddle }: BpmnServices
) {
  const sourceId = params.sourceId as string;
  const targetId = params.targetId as string;
  const waypoints = params.waypoints as Array<{ x: number; y: number }> | undefined;
  const conditionExpression = params.conditionExpression as string | undefined;
  const isDefault = params.isDefault as boolean | undefined;

  const source = elementRegistry.get(sourceId);
  if (!source) {
    throw new Error(`Source element "${sourceId}" not found`);
  }

  const target = elementRegistry.get(targetId);
  if (!target) {
    throw new Error(`Target element "${targetId}" not found`);
  }

  let connection;
  if (waypoints && waypoints.length > 0) {
    connection = modeling.createConnection(source, target, {
      type: 'bpmn:SequenceFlow',
      waypoints: waypoints.map(wp => ({ x: wp.x, y: wp.y })),
    }, source.parent);
  } else {
    connection = modeling.connect(source, target);
  }

  if (conditionExpression) {
    const expr = moddle.create('bpmn:FormalExpression', { body: conditionExpression });
    modeling.updateProperties(connection, { conditionExpression: expr });
  }

  if (isDefault) {
    modeling.updateProperties(source, { default: connection.businessObject });
  }

  return { connectionId: connection.id, sourceId, targetId };
}

export function addGateway(
  params: Record<string, unknown>,
  { modeling, canvas, elementRegistry }: BpmnServices
) {
  const type = (params.type as string) || 'bpmn:ExclusiveGateway';
  const name = (params.name as string) || '';
  const x = (params.x as number) || 400;
  const y = (params.y as number) || 200;
  const parentId = params.parentId as string | undefined;

  const parent = resolveParent(parentId, { elementRegistry, canvas });

  const shape = modeling.createShape({ type }, { x, y }, parent);
  if (name) modeling.updateLabel(shape, name);

  return { elementId: shape.id, type, name, x: shape.x, y: shape.y };
}

export function addEvent(
  params: Record<string, unknown>,
  { modeling, canvas, moddle, elementRegistry, bpmnFactory }: BpmnServices
) {
  const type = params.type as string;
  const eventDefType = (params.eventDefinitionType as string) || 'none';
  const name = (params.name as string) || '';
  const x = (params.x as number) || 400;
  const y = (params.y as number) || 200;
  const attachedToId = params.attachedToId as string | undefined;
  const cancelActivity = params.cancelActivity !== false;
  const parentId = params.parentId as string | undefined;

  let parent;
  if (type === 'bpmn:BoundaryEvent') {
    if (!attachedToId) throw new Error('attachedToId is required for BoundaryEvent');
    parent = elementRegistry.get(attachedToId);
    if (!parent) throw new Error(`Host element "${attachedToId}" not found`);
  } else {
    parent = resolveParent(parentId, { elementRegistry, canvas });
  }

  const shapeAttrs: any = { type };
  if (type === 'bpmn:BoundaryEvent') shapeAttrs.cancelActivity = cancelActivity;

  // For boundary events, compute the position on the host's perimeter
  let createPos = { x, y };
  if (type === 'bpmn:BoundaryEvent' && parent) {
    const boundaryPos = (params.boundaryPosition as string) || 'bottom';
    createPos = getBoundaryPosition(parent, boundaryPos);
  }

  const shape = modeling.createShape(
    shapeAttrs, createPos, parent,
    { attach: type === 'bpmn:BoundaryEvent' }
  );

  if (eventDefType !== 'none') {
    const bo = shape.businessObject;
    const definitions = getDefinitions(bo, canvas);
    const eventDefProps: any = eventDefRefProps(bpmnFactory, moddle, definitions, eventDefType, params);
    const eventDef = moddle.create(eventDefType, eventDefProps);
    bo.eventDefinitions = bo.eventDefinitions || [];
    bo.eventDefinitions.push(eventDef);
    eventDef.$parent = bo;
    modeling.updateProperties(shape, { eventDefinitions: bo.eventDefinitions });

    // Message Catch/Boundary events require a subscription correlationKey on
    // the Message itself (not the event) — not applicable to Throw events.
    if (
      eventDefType === 'bpmn:MessageEventDefinition' &&
      params.correlationKey &&
      (type === 'bpmn:IntermediateCatchEvent' || type === 'bpmn:BoundaryEvent') &&
      eventDefProps.messageRef
    ) {
      setMessageSubscription(moddle, eventDefProps.messageRef, params.correlationKey as string);
    }
  }

  if (name) modeling.updateLabel(shape, name);

  return { elementId: shape.id, type, eventDefinitionType: eventDefType, name, x: shape.x, y: shape.y };
}

export function addSubprocess(
  params: Record<string, unknown>,
  { modeling, canvas, elementRegistry, moddle }: BpmnServices
) {
  const type = (params.type as string) || 'bpmn:SubProcess';
  const name = (params.name as string) || '';
  const x = (params.x as number) || 350;
  const y = (params.y as number) || 150;
  const width = (params.width as number) || 350;
  const height = (params.height as number) || 200;
  const collapsed = (params.collapsed as boolean) || false;
  const calledElement = params.calledElement as string | undefined;
  const parentId = params.parentId as string | undefined;

  const parent = resolveParent(parentId, { elementRegistry, canvas });

  const shapeAttrs: any = { type };
  if (type === 'bpmn:SubProcess') shapeAttrs.isExpanded = !collapsed;

  const shape = modeling.createShape(shapeAttrs, { x, y, width, height }, parent);

  if (calledElement && type === 'bpmn:CallActivity') {
    setZeebeCalledElement(moddle, modeling, shape, calledElement);
  }
  if (name) modeling.updateLabel(shape, name);

  return { elementId: shape.id, type, name, x: shape.x, y: shape.y, width: shape.width, height: shape.height };
}

export function addParticipant(
  params: Record<string, unknown>,
  { modeling, canvas, bpmnFactory }: BpmnServices
) {
  const name = (params.name as string) || '';
  const x = (params.x as number) || 400;
  const y = (params.y as number) || 200;
  const width = (params.width as number) || 600;
  const height = (params.height as number) || 250;

  const rootElement = canvas.getRootElement();
  if (!rootElement) throw new Error('No diagram is currently open');

  const shape = modeling.createShape(
    { type: 'bpmn:Participant' },
    { x, y, width, height },
    rootElement
  );

  // bpmn-js's own CreateParticipantBehavior only auto-wires a bpmn:Process
  // onto a new participant when it's created directly into a bpmn:Process
  // root — the "convert this diagram's lone flat process into a
  // collaboration" case for the *first* pool. Once a Collaboration root
  // already exists (2nd+ pool), that behavior's guard never fires, so the
  // participant is created with no processRef at all — confirmed live: the
  // pool renders, but has no underlying process to hold any flow elements,
  // silently. Wire it ourselves here, matching what the behavior does for
  // pool 1, so every pool this tool creates is actually usable.
  if (!shape.businessObject.processRef) {
    const definitions = getDefinitions(shape.businessObject, canvas);
    const process = bpmnFactory.create('bpmn:Process', { isExecutable: true });
    process.$parent = definitions;
    if (definitions && !definitions.rootElements) definitions.rootElements = [];
    definitions?.rootElements.push(process);
    modeling.updateProperties(shape, { processRef: process });
  }

  if (name) modeling.updateLabel(shape, name);

  return {
    elementId: shape.id,
    name,
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
  };
}

export function addLane(
  params: Record<string, unknown>,
  { modeling, elementRegistry }: BpmnServices
) {
  const participantId = params.participantId as string;
  const name = (params.name as string) || '';

  const participant = elementRegistry.get(participantId);
  if (!participant) throw new Error(`Participant "${participantId}" not found`);

  // A participant with no linked process (processRef) crashes deep inside
  // bpmn-js's own BpmnUpdater — its lane/flowNodeRef bookkeeping
  // (getLaneSet/updateSemanticParent) reads processRef unconditionally,
  // throwing "Cannot read properties of undefined (reading 'get')" after
  // the lane shape has already been partially created (confirmed live via
  // the real stack trace). addParticipant always wires processRef now, so
  // this can no longer happen for pools created through this plugin — but
  // guard against it anyway for pools that arrived via import_xml or an
  // older version of this plugin, with a clear error instead of a
  // confusing internal crash plus orphaned shape.
  if (!participant.businessObject.processRef) {
    throw new Error(`Participant "${participantId}" has no linked process (processRef) — cannot add a lane to it`);
  }

  // Add lane inside the participant
  const lane = modeling.addLane(participant, 'bottom');

  if (name && lane) modeling.updateLabel(lane, name);

  return { elementId: lane?.id || 'unknown', name, participantId };
}

export function addEndEventTyped(
  params: Record<string, unknown>,
  { modeling, canvas, moddle, elementRegistry, bpmnFactory }: BpmnServices
) {
  const eventDefType = (params.eventDefinitionType as string) || 'none';
  const name = (params.name as string) || '';
  const x = (params.x as number) || 600;
  const y = (params.y as number) || 200;
  const parentId = params.parentId as string | undefined;

  const parent = resolveParent(parentId, { elementRegistry, canvas });

  const shape = modeling.createShape({ type: 'bpmn:EndEvent' }, { x, y }, parent);

  if (eventDefType !== 'none') {
    const bo = shape.businessObject;
    const definitions = getDefinitions(bo, canvas);
    const eventDefProps = eventDefRefProps(bpmnFactory, moddle, definitions, eventDefType, params);
    const eventDef = moddle.create(eventDefType, eventDefProps);
    bo.eventDefinitions = bo.eventDefinitions || [];
    bo.eventDefinitions.push(eventDef);
    eventDef.$parent = bo;
    modeling.updateProperties(shape, { eventDefinitions: bo.eventDefinitions });
    if (eventDefType === 'bpmn:MessageEventDefinition' && params.correlationKey && eventDefProps.messageRef) {
      setMessageSubscription(moddle, eventDefProps.messageRef, params.correlationKey as string);
    }
  }

  if (name) modeling.updateLabel(shape, name);

  return { elementId: shape.id, eventDefinitionType: eventDefType, name, x: shape.x, y: shape.y };
}

export function addMessageFlow(
  params: Record<string, unknown>,
  { modeling, elementRegistry }: BpmnServices
) {
  const sourceId = params.sourceId as string;
  const targetId = params.targetId as string;
  const name = params.name as string | undefined;

  const source = elementRegistry.get(sourceId);
  if (!source) throw new Error(`Source element "${sourceId}" not found`);
  const target = elementRegistry.get(targetId);
  if (!target) throw new Error(`Target element "${targetId}" not found`);

  // Create message flow (cross-pool connection)
  const connection = modeling.connect(source, target, { type: 'bpmn:MessageFlow' });

  if (name) modeling.updateLabel(connection, name);

  return { connectionId: connection.id, sourceId, targetId, name };
}

export function addAnnotation(
  params: Record<string, unknown>,
  { modeling, canvas, elementRegistry }: BpmnServices
) {
  const text = params.text as string;
  const x = (params.x as number) || 400;
  const y = (params.y as number) || 100;
  const attachToId = params.attachToId as string | undefined;

  const rootElement = canvas.getRootElement();
  if (!rootElement) throw new Error('No diagram is currently open');

  const shape = modeling.createShape(
    { type: 'bpmn:TextAnnotation' },
    { x, y },
    rootElement
  );

  // Set the annotation text
  modeling.updateProperties(shape, { text });

  // If attachToId is specified, create an association
  if (attachToId) {
    const target = elementRegistry.get(attachToId);
    if (target) {
      modeling.connect(shape, target, { type: 'bpmn:Association' });
    }
  }

  return { elementId: shape.id, text, x: shape.x, y: shape.y };
}

export function addGroup(
  params: Record<string, unknown>,
  { modeling, canvas, moddle }: BpmnServices
) {
  const name = params.name as string | undefined;
  const x = (params.x as number) || 200;
  const y = (params.y as number) || 200;
  const width = (params.width as number) || 400;
  const height = (params.height as number) || 200;
  const categoryValue = params.categoryValue as string | undefined;

  const rootElement = canvas.getRootElement();
  if (!rootElement) throw new Error('No diagram is currently open');

  const shape = modeling.createShape(
    { type: 'bpmn:Group' },
    { x: x + width / 2, y: y + height / 2, width, height },
    rootElement,
  );

  // Set the category value (which serves as the group label)
  if (name || categoryValue) {
    const bo = shape.businessObject;
    // Create CategoryValue and Category on the definitions
    const definitions = bo.$parent?.$parent || canvas.getRootElement()?.businessObject?.$parent;
    if (definitions) {
      const catVal = moddle.create('bpmn:CategoryValue', { value: name || categoryValue });
      const category = moddle.create('bpmn:Category', {
        id: `Category_${shape.id}`,
        categoryValue: [catVal],
      });
      catVal.$parent = category;
      category.$parent = definitions;

      if (!definitions.rootElements) definitions.rootElements = [];
      definitions.rootElements.push(category);

      bo.categoryValueRef = catVal;
    }
  }

  return {
    elementId: shape.id,
    name: name || null,
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
  };
}
