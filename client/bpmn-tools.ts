/**
 * bpmn-js module that handles MCP commands against the bpmn-js modeling API.
 *
 * Instead of Electron IPC (which requires ipcRenderer access that may be
 * blocked by contextIsolation), this module exposes a global function
 * `window.__mcpDispatch` that the main process calls via
 * `webContents.executeJavaScript()`.
 */

interface BpmnServices {
  modeling: any;
  elementRegistry: any;
  canvas: any;
  moddle: any;
  bpmnFactory: any;
  injector: any;
  commandStack: any;
}

declare global {
  interface Window {
    __mcpDispatch?: (tool: string, params: Record<string, unknown>) => Promise<any>;
  }
}

function McpCommandHandler(
  eventBus: any,
  modeling: any,
  elementRegistry: any,
  canvas: any,
  moddle: any,
  bpmnFactory: any,
  injector: any,
  commandStack: any
) {
  console.log('[camunda-mcp] McpCommandHandler initialized');

  // Register compound command handler for grouping operations into a single undo step
  commandStack.registerHandler('mcp.compound', McpCompoundHandler);

  const services: BpmnServices = { modeling, elementRegistry, canvas, moddle, bpmnFactory, injector, commandStack };

  window.__mcpDispatch = async (tool: string, params: Record<string, unknown>) => {
    console.log(`[camunda-mcp] Dispatch: ${tool}`, params);
    try {
      const rawResult = await dispatchRendererTool(tool, params, services);
      return {
        content: [{ type: 'text', text: JSON.stringify(rawResult) }],
      };
    } catch (err: any) {
      const message = err.message || String(err);
      console.error(`[camunda-mcp] Command ${tool} failed:`, message);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };

  console.log('[camunda-mcp] window.__mcpDispatch registered');
}

(McpCommandHandler as any).$inject = ['eventBus', 'modeling', 'elementRegistry', 'canvas', 'moddle', 'bpmnFactory', 'injector', 'commandStack'];

/**
 * Command handler that groups nested modeling commands into a single undo step.
 * Usage: commandStack.execute('mcp.compound', { fn: () => { ...modeling calls... } })
 * All modeling.* calls inside fn() become nested commands that undo together.
 */
function McpCompoundHandler() {}
McpCompoundHandler.prototype.preExecute = function(context: any) {
  if (typeof context.fn === 'function') {
    context.fn();
  }
};
McpCompoundHandler.prototype.execute = function(context: any) {
  return context;
};
McpCompoundHandler.prototype.revert = function() {};

/**
 * Resolves the parent element for shape creation.
 * If parentId is provided, looks it up in the element registry (must be an expanded subprocess).
 * Otherwise falls back to the canvas root element.
 */
function resolveParent(
  parentId: string | undefined,
  { elementRegistry, canvas }: Pick<BpmnServices, 'elementRegistry' | 'canvas'>
) {
  if (parentId) {
    const parent = elementRegistry.get(parentId);
    if (!parent) throw new Error(`Parent element "${parentId}" not found`);
    const bo = parent.businessObject;
    if (bo.$type !== 'bpmn:SubProcess') {
      throw new Error(`Parent "${parentId}" is a ${bo.$type}, not a bpmn:SubProcess`);
    }
    const isExpanded = parent.isExpanded ?? parent.di?.isExpanded ?? false;
    if (!isExpanded) {
      throw new Error(`Parent subprocess "${parentId}" is collapsed — expand it first`);
    }
    return parent;
  }
  const root = canvas.getRootElement();
  if (!root) throw new Error('No diagram is currently open — cannot add elements');
  return root;
}

/**
 * Calculates the target position for a boundary event on the host element's perimeter.
 */
function getBoundaryPosition(
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

async function dispatchRendererTool(
  tool: string,
  params: Record<string, unknown>,
  services: BpmnServices
): Promise<any> {
  switch (tool) {
    case 'add_start_event':
      return addStartEvent(params, services);
    case 'add_task':
      return addTask(params, services);
    case 'add_end_event':
      return addEndEvent(params, services);
    case 'connect_elements':
      return connectElements(params, services);
    case 'link_form_to_task':
      return linkFormToTask(params, services);
    case 'add_gateway':
      return addGateway(params, services);
    case 'add_event':
      return addEvent(params, services);
    case 'add_subprocess':
      return addSubprocess(params, services);
    case 'set_properties':
      return setProperties(params, services);
    case 'set_io_mapping':
      return setIoMapping(params, services);
    case 'set_task_headers':
      return setTaskHeaders(params, services);
    case 'list_elements':
      return listElements(params, services);
    case 'get_element':
      return getElement(params, services);
    case 'delete_element':
      return deleteElement(params, services);
    case 'get_diagram_xml':
      return getDiagramXml(params, services);
    case 'import_xml':
      return importXml(params, services);
    case 'move_element':
      return moveElement(params, services);
    case 'save_diagram':
      return saveDiagram(params, services);
    case 'add_participant':
      return addParticipant(params, services);
    case 'add_lane':
      return addLane(params, services);
    case 'add_end_event_typed':
      return addEndEventTyped(params, services);
    case 'add_message_flow':
      return addMessageFlow(params, services);
    case 'add_annotation':
      return addAnnotation(params, services);
    case 'resize_element':
      return resizeElement(params, services);
    case 'set_flow_waypoints':
      return setFlowWaypoints(params, services);
    case 'get_element_bounds':
      return getElementBounds(params, services);
    case 'clone_element':
      return cloneElement(params, services);
    case 'batch_operations':
      return batchOperations(params, services);
    case 'add_group':
      return addGroup(params, services);
    case 'patch_element':
      return patchElement(params, services);
    case 'build_process':
      return buildProcess(params, services);
    case 'validate_layout':
      return validateLayout(params, services);
    case 'auto_layout':
      return smartAutoLayout(params, services);
    case 'export_image':
      return exportImage(params, services);
    case 'set_execution_platform_version':
      return setExecutionPlatformVersion(params, services);
    case '__debug_moddle':
      return debugModdle(services);
    default:
      throw new Error(`Unknown renderer tool: "${tool}"`);
  }
}

function addStartEvent(
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
    const eventDefProps: any = eventDefRefProps(bpmnFactory, definitions, eventDefType, params);
    if (eventDefType === 'bpmn:TimerEventDefinition' && params.timerValue) {
      const timerType = (params.timerType as string) || 'timeDuration';
      const formalExpression = moddle.create('bpmn:FormalExpression', { body: params.timerValue as string });
      eventDefProps[timerType] = formalExpression;
    }
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

function addTask(
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
  if (messageRef && (type === 'bpmn:ReceiveTask' || type === 'bpmn:SendTask')) {
    const bo = shape.businessObject;
    const definitions = getDefinitions(bo, canvas);
    if (definitions) {
      const message = findOrCreateRootElement(bpmnFactory, definitions, 'bpmn:Message', messageRef);
      modeling.updateProperties(shape, { messageRef: message });
    }
  }

  // ReceiveTask requires a subscription correlationKey alongside messageRef
  // for Camunda validation — Zeebe needs it to correlate the incoming
  // message against a running process instance.
  const correlationKey = params.correlationKey as string | undefined;
  if (correlationKey && type === 'bpmn:ReceiveTask') {
    setZeebeSubscription(moddle, modeling, shape, correlationKey);
  }

  return { elementId: shape.id, type, name, x: shape.x, y: shape.y };
}

function addEndEvent(
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

function connectElements(
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

/**
 * Links a Camunda Form to a UserTask.
 *
 * Detects whether the Zeebe moddle extension is available (Camunda 8 / Cloud)
 * or falls back to the Camunda Platform 7 approach. If neither is available,
 * embeds the form JSON directly as a custom property.
 */
function linkFormToTask(
  params: Record<string, unknown>,
  { modeling, elementRegistry, moddle, canvas }: BpmnServices
) {
  const taskId = params.taskId as string;
  const formJson = params.formJson as string;

  const taskElement = elementRegistry.get(taskId);
  if (!taskElement) {
    throw new Error(`Task element "${taskId}" not found`);
  }

  const bo = taskElement.businessObject;
  if (bo.$type !== 'bpmn:UserTask') {
    throw new Error(`Element "${taskId}" is a ${bo.$type}, not a bpmn:UserTask`);
  }

  const formData = JSON.parse(formJson);
  const formId = formData.id || 'Form_1';

  // Detect which moddle packages are available
  const hasZeebe = !!moddle.getPackage('zeebe');
  const hasCamunda = !!moddle.getPackage('camunda');

  console.log(`[camunda-mcp] Moddle packages — zeebe: ${hasZeebe}, camunda: ${hasCamunda}`);

  if (hasZeebe) {
    return linkFormZeebe(taskElement, bo, formJson, formId, { modeling, moddle, canvas });
  } else if (hasCamunda) {
    return linkFormCamunda(taskElement, bo, formId, { modeling, moddle });
  } else {
    // Fallback: list available packages for debugging
    const packages = moddle.packages?.map((p: any) => p.prefix || p.name) || [];
    throw new Error(
      `No zeebe or camunda moddle extension found. Available: [${packages.join(', ')}]. ` +
      'Ensure the diagram is opened in the correct Modeler mode (Platform or Cloud).'
    );
  }
}

/** Camunda 8 (Cloud / Zeebe) — set formId or embed form via formKey */
function linkFormZeebe(
  taskElement: any,
  bo: any,
  formJson: string,
  formId: string,
  { modeling, moddle, canvas }: { modeling: any; moddle: any; canvas: any }
) {
  // Try embedding the form JSON at process level first (requires zeebe:UserTaskForm)
  let embedded = false;
  let formKey = '';

  try {
    const userTaskFormId = `userTaskForm_${bo.id}`;
    const rootElement = canvas.getRootElement();
    const process = rootElement.businessObject;

    let processExt = process.extensionElements;
    if (!processExt) {
      processExt = moddle.create('bpmn:ExtensionElements', { values: [] });
      process.extensionElements = processExt;
    }
    if (!processExt.values) processExt.values = [];

    const userTaskForm = moddle.create('zeebe:UserTaskForm', {
      id: userTaskFormId,
      body: formJson,
    });
    processExt.values.push(userTaskForm);

    formKey = `camunda-forms:bpmn:${userTaskFormId}`;
    embedded = true;
    console.log('[camunda-mcp] Embedded form JSON via zeebe:UserTaskForm');
  } catch (err: any) {
    console.warn(`[camunda-mcp] zeebe:UserTaskForm not available (${err.message}), using formId reference`);
  }

  // Set formDefinition on the task
  let taskExt = bo.extensionElements;
  if (!taskExt) {
    taskExt = moddle.create('bpmn:ExtensionElements', { values: [] });
  }
  if (!taskExt.values) taskExt.values = [];

  // Remove existing form definitions
  taskExt.values = taskExt.values.filter((v: any) => v.$type !== 'zeebe:FormDefinition');

  const formDefProps: any = {};
  if (embedded) {
    formDefProps.formKey = formKey;
  } else {
    // Reference by formId — the form would be deployed separately
    formDefProps.formId = formId;
  }

  const formDef = moddle.create('zeebe:FormDefinition', formDefProps);
  taskExt.values.push(formDef);

  modeling.updateProperties(taskElement, { extensionElements: taskExt });

  return {
    taskId: bo.id, formId, mode: 'zeebe',
    embedded,
    ...(embedded ? { formKey } : {}),
    message: embedded
      ? `Embedded and linked form "${formId}" to task "${bo.id}" (Camunda 8)`
      : `Linked form "${formId}" to task "${bo.id}" by reference (Camunda 8)`,
  };
}

/** Camunda 7 (Platform) — reference form via camunda:formRef */
function linkFormCamunda(
  taskElement: any,
  bo: any,
  formId: string,
  { modeling, moddle }: { modeling: any; moddle: any }
) {
  let taskExt = bo.extensionElements;
  if (!taskExt) {
    taskExt = moddle.create('bpmn:ExtensionElements', { values: [] });
  }
  if (!taskExt.values) taskExt.values = [];

  // Try camunda:formRef approach
  try {
    const formRef = moddle.create('camunda:FormData', {});
    taskExt.values.push(formRef);
  } catch {
    // Ignore — not all versions support this
  }

  // Set formRef as a property
  modeling.updateProperties(taskElement, {
    'camunda:formRef': formId,
    'camunda:formRefBinding': 'latest',
    extensionElements: taskExt,
  });

  return {
    taskId: bo.id, formId, mode: 'camunda',
    message: `Linked form "${formId}" to task "${bo.id}" (Camunda 7 / Platform)`,
  };
}

/* ------------------------------------------------------------------ */
/*  Phase 1 — Gateways, Events, Sub-processes                         */
/* ------------------------------------------------------------------ */

function addGateway(
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

/**
 * Finds an existing root-level bpmn:Error/Message/Signal/Escalation element by
 * name (or id), or creates one under `definitions.rootElements` if none exists.
 * Used to wire up event/task reference properties (errorRef, messageRef, ...)
 * that Camunda validation requires alongside the event definition itself.
 */
function findOrCreateRootElement(
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
function eventDefRefProps(
  bpmnFactory: any,
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
  }
  return props;
}

/** Resolves the bpmn:definitions root from a freshly-created shape's business object. */
function getDefinitions(bo: any, canvas: any): any {
  return bo?.$parent?.$parent || canvas.getRootElement()?.businessObject?.$parent;
}

function addEvent(
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
    const eventDefProps: any = eventDefRefProps(bpmnFactory, definitions, eventDefType, params);
    if (eventDefType === 'bpmn:TimerEventDefinition' && params.timerValue) {
      const timerType = (params.timerType as string) || 'timeDuration';
      const formalExpression = moddle.create('bpmn:FormalExpression', { body: params.timerValue as string });
      eventDefProps[timerType] = formalExpression;
    }
    const eventDef = moddle.create(eventDefType, eventDefProps);
    bo.eventDefinitions = bo.eventDefinitions || [];
    bo.eventDefinitions.push(eventDef);
    eventDef.$parent = bo;
    modeling.updateProperties(shape, { eventDefinitions: bo.eventDefinitions });

    // Message Catch/Boundary events require a subscription correlationKey
    // alongside messageRef — not applicable to Throw events (nothing caught).
    if (
      eventDefType === 'bpmn:MessageEventDefinition' &&
      params.correlationKey &&
      (type === 'bpmn:IntermediateCatchEvent' || type === 'bpmn:BoundaryEvent')
    ) {
      setZeebeSubscription(moddle, modeling, shape, params.correlationKey as string);
    }
  }

  if (name) modeling.updateLabel(shape, name);

  return { elementId: shape.id, type, eventDefinitionType: eventDefType, name, x: shape.x, y: shape.y };
}

function addSubprocess(
  params: Record<string, unknown>,
  { modeling, canvas, elementRegistry }: BpmnServices
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
    modeling.updateProperties(shape, { calledElement });
  }
  if (name) modeling.updateLabel(shape, name);

  return { elementId: shape.id, type, name, x: shape.x, y: shape.y, width: shape.width, height: shape.height };
}

/**
 * Attaches (or replaces) a zeebe:TaskDefinition extension element on a task,
 * making it a valid Zeebe job worker. Required by Camunda validation for
 * ServiceTask, SendTask, BusinessRuleTask, and ScriptTask — not just ServiceTask.
 */
function setZeebeTaskDefinition(
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
 * Attaches (or replaces) a zeebe:Subscription extension element with a
 * correlationKey on anything that *catches* a message (Receive Tasks,
 * Message Catch/Boundary Events). Required by Camunda validation alongside
 * messageRef — without it, Zeebe has no process-instance variable to
 * correlate the incoming message against. Not applicable to Send Tasks,
 * Message Throw Events, or Message Start Events (nothing to correlate yet).
 */
function setZeebeSubscription(
  moddle: any,
  modeling: any,
  element: any,
  correlationKey: string,
): void {
  const bo = element.businessObject;
  let extElements = bo.extensionElements;
  if (!extElements) extElements = moddle.create('bpmn:ExtensionElements', { values: [] });
  if (!extElements.values) extElements.values = [];
  extElements.values = extElements.values.filter((v: any) => v.$type !== 'zeebe:Subscription');
  const subscription = moddle.create('zeebe:Subscription', { correlationKey });
  extElements.values.push(subscription);
  modeling.updateProperties(element, { extensionElements: extElements });
}

/* ------------------------------------------------------------------ */
/*  Phase 2 — Element Configuration                                    */
/* ------------------------------------------------------------------ */

function setProperties(params: Record<string, unknown>, { modeling, elementRegistry, moddle }: BpmnServices) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);

  const basicProps: any = {};
  if (params.name !== undefined) basicProps.name = params.name;
  if (params.documentation !== undefined) {
    const doc = moddle.create('bpmn:Documentation', { text: params.documentation as string });
    basicProps.documentation = [doc];
  }
  if (params.isExecutable !== undefined) basicProps.isExecutable = params.isExecutable;
  if (params.conditionExpression !== undefined) {
    const expr = moddle.create('bpmn:FormalExpression', { body: params.conditionExpression as string });
    basicProps.conditionExpression = expr;
  }
  if (Object.keys(basicProps).length > 0) {
    modeling.updateProperties(element, basicProps);
  }

  const hasZeebe = !!moddle.getPackage('zeebe');
  const hasCamunda = !!moddle.getPackage('camunda');

  if (params.implementationType && hasCamunda) {
    const implType = params.implementationType as string;
    const implValue = (params.implementationValue as string) || '';
    const camundaProps: any = {
      'camunda:class': undefined, 'camunda:delegateExpression': undefined,
      'camunda:expression': undefined, 'camunda:type': undefined, 'camunda:topic': undefined,
    };
    switch (implType) {
      case 'class': camundaProps['camunda:class'] = implValue; break;
      case 'delegateExpression': camundaProps['camunda:delegateExpression'] = implValue; break;
      case 'expression': camundaProps['camunda:expression'] = implValue; break;
      case 'external':
        camundaProps['camunda:type'] = 'external';
        camundaProps['camunda:topic'] = (params.taskTopic as string) || implValue;
        break;
    }
    if (params.taskPriority) camundaProps['camunda:taskPriority'] = params.taskPriority;
    modeling.updateProperties(element, camundaProps);
  }

  if (params.taskType && hasZeebe) {
    setZeebeTaskDefinition(moddle, modeling, element, params.taskType as string, params.taskRetries as string | undefined);
  }

  if (params.correlationKey && hasZeebe) {
    setZeebeSubscription(moddle, modeling, element, params.correlationKey as string);
  }

  return { elementId, updated: true };
}

function setIoMapping(params: Record<string, unknown>, { modeling, elementRegistry, moddle }: BpmnServices) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);
  const bo = element.businessObject;
  const inputs = (params.inputs as any[]) || [];
  const outputs = (params.outputs as any[]) || [];

  const hasZeebe = !!moddle.getPackage('zeebe');
  const hasCamunda = !!moddle.getPackage('camunda');

  let extElements = bo.extensionElements;
  if (!extElements) extElements = moddle.create('bpmn:ExtensionElements', { values: [] });
  if (!extElements.values) extElements.values = [];

  if (hasZeebe) {
    extElements.values = extElements.values.filter((v: any) => v.$type !== 'zeebe:IoMapping');
    const inputParams = inputs.map((i: any) => moddle.create('zeebe:Input', { source: i.source, target: i.target }));
    const outputParams = outputs.map((o: any) => moddle.create('zeebe:Output', { source: o.source, target: o.target }));
    extElements.values.push(moddle.create('zeebe:IoMapping', { inputParameters: inputParams, outputParameters: outputParams }));
  } else if (hasCamunda) {
    extElements.values = extElements.values.filter((v: any) => v.$type !== 'camunda:InputOutput');
    const inputParams = inputs.map((i: any) => moddle.create('camunda:InputParameter', { name: i.target, value: i.source }));
    const outputParams = outputs.map((o: any) => moddle.create('camunda:OutputParameter', { name: o.target, value: o.source }));
    extElements.values.push(moddle.create('camunda:InputOutput', { inputParameters: inputParams, outputParameters: outputParams }));
  } else {
    throw new Error('No zeebe or camunda moddle extension found');
  }

  modeling.updateProperties(element, { extensionElements: extElements });
  return { elementId, inputCount: inputs.length, outputCount: outputs.length };
}

function setTaskHeaders(params: Record<string, unknown>, { modeling, elementRegistry, moddle }: BpmnServices) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);
  const bo = element.businessObject;
  const headers = (params.headers as any[]) || [];

  const hasZeebe = !!moddle.getPackage('zeebe');
  const hasCamunda = !!moddle.getPackage('camunda');

  let extElements = bo.extensionElements;
  if (!extElements) extElements = moddle.create('bpmn:ExtensionElements', { values: [] });
  if (!extElements.values) extElements.values = [];

  if (hasZeebe) {
    extElements.values = extElements.values.filter((v: any) => v.$type !== 'zeebe:TaskHeaders');
    const headerEntries = headers.map((h: any) => moddle.create('zeebe:Header', { key: h.key, value: h.value }));
    extElements.values.push(moddle.create('zeebe:TaskHeaders', { values: headerEntries }));
  } else if (hasCamunda) {
    extElements.values = extElements.values.filter((v: any) => v.$type !== 'camunda:Properties');
    const props = headers.map((h: any) => moddle.create('camunda:Property', { name: h.key, value: h.value }));
    extElements.values.push(moddle.create('camunda:Properties', { values: props }));
  } else {
    throw new Error('No zeebe or camunda moddle extension found');
  }

  modeling.updateProperties(element, { extensionElements: extElements });
  return { elementId, headerCount: headers.length };
}

/* ------------------------------------------------------------------ */
/*  Phase 3 — Introspection & Diagram Operations                      */
/* ------------------------------------------------------------------ */

function listElements(params: Record<string, unknown>, { elementRegistry }: BpmnServices) {
  const typeFilter = params.typeFilter as string | undefined;
  const parentId = params.parentId as string | undefined;
  const fields = params.fields as string[] | undefined;
  const allElements = elementRegistry.getAll();

  if (parentId && !elementRegistry.get(parentId)) {
    throw new Error(`Parent element "${parentId}" not found`);
  }

  const filtered = allElements.filter((el: any) => {
    if (el.type && (el.type.startsWith('bpmndi:') || el.type === 'label')) return false;
    if (typeFilter && !el.type?.startsWith(typeFilter)) return false;
    if (parentId && el.parent?.id !== parentId) return false;
    return true;
  });

  const elements = filtered.map((el: any) => {
    const full: Record<string, any> = {
      id: el.id,
      type: el.type,
      name: el.businessObject?.name || null,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      parentId: el.parent?.id || null,
      incoming: (el.incoming || []).map((c: any) => c.id),
      outgoing: (el.outgoing || []).map((c: any) => c.id),
    };
    if (!fields) return full;
    const picked: Record<string, any> = { id: el.id }; // id always included
    for (const f of fields) {
      if (f in full) picked[f] = full[f];
    }
    return picked;
  });

  return { elements, count: elements.length };
}

function getElement(params: Record<string, unknown>, { elementRegistry }: BpmnServices) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);

  const bo = element.businessObject;

  // Extract extension elements
  const extensions: any[] = [];
  if (bo.extensionElements?.values) {
    for (const ext of bo.extensionElements.values) {
      const extInfo: any = { $type: ext.$type };
      // Copy simple properties
      for (const key of Object.keys(ext)) {
        if (key.startsWith('$') || key === 'values') continue;
        extInfo[key] = ext[key];
      }
      // Handle nested values (e.g. headers, mappings)
      if (ext.values) {
        extInfo.values = ext.values.map((v: any) => {
          const val: any = { $type: v.$type };
          for (const k of Object.keys(v)) {
            if (!k.startsWith('$')) val[k] = v[k];
          }
          return val;
        });
      }
      extensions.push(extInfo);
    }
  }

  // Incoming/outgoing connections
  const incoming = (element.incoming || []).map((c: any) => ({
    id: c.id, sourceId: c.source?.id
  }));
  const outgoing = (element.outgoing || []).map((c: any) => ({
    id: c.id, targetId: c.target?.id
  }));

  return {
    id: element.id,
    type: element.type,
    name: bo.name || null,
    documentation: bo.documentation?.[0]?.text || null,
    properties: {
      isExecutable: bo.isExecutable,
      conditionExpression: bo.conditionExpression?.body || null,
      // Camunda props
      'camunda:class': bo.get('camunda:class') || null,
      'camunda:delegateExpression': bo.get('camunda:delegateExpression') || null,
      'camunda:type': bo.get('camunda:type') || null,
      'camunda:topic': bo.get('camunda:topic') || null,
      'camunda:formRef': bo.get('camunda:formRef') || null,
    },
    extensionElements: extensions,
    incoming,
    outgoing,
    x: element.x, y: element.y,
    width: element.width, height: element.height,
  };
}

function deleteElement(params: Record<string, unknown>, { modeling, elementRegistry }: BpmnServices) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);
  modeling.removeElements([element]);
  return { deleted: true, elementId };
}

async function getDiagramXml(_params: Record<string, unknown>, { injector }: BpmnServices) {
  // Access the modeler instance through the injector
  let modeler: any;
  try {
    modeler = injector.get('modeler');
  } catch {
    // Fallback: try to get the bpmnjs instance directly
    try {
      modeler = injector.get('bpmnjs');
    } catch {
      throw new Error('Cannot access modeler instance — saveXML not available');
    }
  }
  const { xml } = await modeler.saveXML({ format: true });
  return { xml };
}

async function importXml(params: Record<string, unknown>, { injector }: BpmnServices) {
  const xml = params.xml as string;
  if (!xml) throw new Error('xml parameter is required');

  let modeler: any;
  try {
    modeler = injector.get('modeler');
  } catch {
    try {
      modeler = injector.get('bpmnjs');
    } catch {
      throw new Error('Cannot access modeler instance — importXML not available');
    }
  }
  await modeler.importXML(xml);
  return { imported: true };
}

/** Debug helper — lists available moddle packages and zeebe types */
function debugModdle({ moddle }: BpmnServices) {
  const packages = (moddle.packages || []).map((p: any) => ({
    name: p.name,
    prefix: p.prefix,
    types: (p.types || []).map((t: any) => t.name),
  }));
  return { packages };
}

/* ------------------------------------------------------------------ */
/*  Phase 4 (v0.3) — Collaboration, Layout & Advanced Elements        */
/* ------------------------------------------------------------------ */

function resizeElement(
  params: Record<string, unknown>,
  { modeling, elementRegistry }: BpmnServices
) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);

  const newWidth = params.width as number;
  const newHeight = params.height as number;

  // Keep the element centered: compute new bounds from center point
  const centerX = element.x + (element.width || 0) / 2;
  const centerY = element.y + (element.height || 0) / 2;
  const newBounds = {
    x: centerX - newWidth / 2,
    y: centerY - newHeight / 2,
    width: newWidth,
    height: newHeight,
  };

  modeling.resizeShape(element, newBounds);

  return {
    elementId,
    width: element.width,
    height: element.height,
    x: element.x,
    y: element.y,
    centerX: element.x + element.width / 2,
    centerY: element.y + element.height / 2,
  };
}

function moveElement(
  params: Record<string, unknown>,
  { modeling, elementRegistry }: BpmnServices
) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);

  const newX = params.x as number;
  const newY = params.y as number;

  // Calculate delta from current position
  // For shapes, element.x/y is top-left. We need to calculate based on center.
  const currentCenterX = element.x + (element.width || 0) / 2;
  const currentCenterY = element.y + (element.height || 0) / 2;
  const deltaX = newX - currentCenterX;
  const deltaY = newY - currentCenterY;

  modeling.moveElements([element], { x: deltaX, y: deltaY });

  return {
    elementId,
    x: element.x,
    y: element.y,
    centerX: element.x + (element.width || 0) / 2,
    centerY: element.y + (element.height || 0) / 2,
  };
}

async function saveDiagram(
  params: Record<string, unknown>,
  { injector }: BpmnServices
) {
  // Renderer side: export the XML. File writing happens on the Node.js side.
  let modeler: any;
  try {
    modeler = injector.get('modeler');
  } catch {
    try {
      modeler = injector.get('bpmnjs');
    } catch {
      throw new Error('Cannot access modeler instance');
    }
  }
  const { xml } = await modeler.saveXML({ format: true });
  return { xml, filePath: params.filePath };
}

/**
 * Exports the current diagram as SVG or PNG.
 * Returns the image data + metadata; the Node.js handler writes the file.
 */
async function exportImage(
  params: Record<string, unknown>,
  { injector, canvas }: BpmnServices
) {
  const filePath = params.filePath as string;
  const format = (params.format as string) || 'png';
  const scale = (params.scale as number) || 2;

  let modeler: any;
  try {
    modeler = injector.get('modeler');
  } catch {
    try {
      modeler = injector.get('bpmnjs');
    } catch {
      throw new Error('Cannot access modeler instance — saveSVG not available');
    }
  }

  // Get SVG from bpmn-js
  const { svg } = await modeler.saveSVG();

  // Parse dimensions from the SVG viewBox
  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
  let svgWidth = 800, svgHeight = 600;
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].split(/\s+/).map(Number);
    if (parts.length === 4) {
      svgWidth = parts[2];
      svgHeight = parts[3];
    }
  }

  if (format === 'svg') {
    return { data: svg, filePath, format: 'svg', width: svgWidth, height: svgHeight };
  }

  // PNG: rasterize SVG using an offscreen canvas in the Chromium renderer
  const pngWidth = Math.round(svgWidth * scale);
  const pngHeight = Math.round(svgHeight * scale);

  const pngBase64: string = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const offscreen = document.createElement('canvas');
      offscreen.width = pngWidth;
      offscreen.height = pngHeight;
      const ctx = offscreen.getContext('2d');
      if (!ctx) { reject(new Error('Could not create canvas 2d context')); return; }
      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pngWidth, pngHeight);
      ctx.drawImage(img, 0, 0, pngWidth, pngHeight);
      // Extract base64 PNG (strip the data:image/png;base64, prefix)
      const dataUrl = offscreen.toDataURL('image/png');
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = () => reject(new Error('Failed to load SVG into Image for PNG rasterization'));
    // Load SVG as a data URL
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    img.src = URL.createObjectURL(svgBlob);
  });

  return { data: pngBase64, filePath, format: 'png', width: pngWidth, height: pngHeight };
}

function addParticipant(
  params: Record<string, unknown>,
  { modeling, canvas }: BpmnServices
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

function addLane(
  params: Record<string, unknown>,
  { modeling, elementRegistry }: BpmnServices
) {
  const participantId = params.participantId as string;
  const name = (params.name as string) || '';

  const participant = elementRegistry.get(participantId);
  if (!participant) throw new Error(`Participant "${participantId}" not found`);

  // Add lane inside the participant
  const lane = modeling.addLane(participant, 'bottom');

  if (name && lane) modeling.updateLabel(lane, name);

  return { elementId: lane?.id || 'unknown', name, participantId };
}

function addEndEventTyped(
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
    const eventDefProps = eventDefRefProps(bpmnFactory, definitions, eventDefType, params);
    const eventDef = moddle.create(eventDefType, eventDefProps);
    bo.eventDefinitions = bo.eventDefinitions || [];
    bo.eventDefinitions.push(eventDef);
    eventDef.$parent = bo;
    modeling.updateProperties(shape, { eventDefinitions: bo.eventDefinitions });
  }

  if (name) modeling.updateLabel(shape, name);

  return { elementId: shape.id, eventDefinitionType: eventDefType, name, x: shape.x, y: shape.y };
}

function addMessageFlow(
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

function addAnnotation(
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

/* ------------------------------------------------------------------ */
/*  v0.9 — Flow Waypoints, Bounds, Clone, Batch, Group               */
/* ------------------------------------------------------------------ */

function setFlowWaypoints(
  params: Record<string, unknown>,
  { modeling, elementRegistry }: BpmnServices
) {
  const flowId = params.flowId as string;
  const waypoints = params.waypoints as Array<{ x: number; y: number }>;

  const connection = elementRegistry.get(flowId);
  if (!connection) throw new Error(`Flow "${flowId}" not found`);

  const bo = connection.businessObject;
  if (bo.$type !== 'bpmn:SequenceFlow' && bo.$type !== 'bpmn:MessageFlow') {
    throw new Error(`Element "${flowId}" is a ${bo.$type}, not a sequence/message flow`);
  }

  const newWaypoints = waypoints.map(wp => ({ x: wp.x, y: wp.y }));

  if (typeof modeling.updateWaypoints === 'function') {
    modeling.updateWaypoints(connection, newWaypoints);
  } else {
    // Fall back to layoutConnection which goes through the command stack
    modeling.layoutConnection(connection, {
      connectionStart: newWaypoints[0],
      connectionEnd: newWaypoints[newWaypoints.length - 1],
    });
  }

  return {
    flowId,
    waypoints: connection.waypoints.map((wp: any) => ({ x: wp.x, y: wp.y })),
  };
}

function getElementBounds(
  params: Record<string, unknown>,
  { elementRegistry }: BpmnServices
) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);

  const result: any = {
    elementId: element.id,
    type: element.type,
  };

  // For connections (flows), return waypoints
  if (element.waypoints) {
    result.waypoints = element.waypoints.map((wp: any) => ({ x: wp.x, y: wp.y }));
    return result;
  }

  // For shapes, return bounds, center, and connection points
  const x = element.x;
  const y = element.y;
  const width = element.width || 0;
  const height = element.height || 0;

  result.bounds = { x, y, width, height };
  result.center = {
    x: x + width / 2,
    y: y + height / 2,
  };
  result.connectionPoints = {
    top: { x: x + width / 2, y },
    bottom: { x: x + width / 2, y: y + height },
    left: { x, y: y + height / 2 },
    right: { x: x + width, y: y + height / 2 },
  };

  return result;
}

function cloneElement(
  params: Record<string, unknown>,
  { modeling, elementRegistry, canvas, moddle, bpmnFactory }: BpmnServices
) {
  const sourceId = params.sourceId as string;
  const overrideName = params.name as string | undefined;
  const x = params.x as number;
  const y = params.y as number;
  const deep = (params.deep as boolean) || false;

  const source = elementRegistry.get(sourceId);
  if (!source) throw new Error(`Source element "${sourceId}" not found`);

  const bo = source.businessObject;

  // Create shape with same type and dimensions
  const shapeAttrs: any = { type: source.type };
  if (bo.$type === 'bpmn:SubProcess') {
    shapeAttrs.isExpanded = source.isExpanded ?? source.di?.isExpanded ?? false;
  }

  const parent = source.parent || canvas.getRootElement();
  const clone = modeling.createShape(
    shapeAttrs,
    { x, y, width: source.width, height: source.height },
    parent,
  );

  // Copy simple business object properties
  const propsToClone: any = {};
  for (const key of Object.keys(bo)) {
    if (key.startsWith('$') || ['id', 'di', 'flowElements', 'artifacts', 'laneSets'].includes(key)) continue;
    if (['incoming', 'outgoing', 'sourceRef', 'targetRef'].includes(key)) continue;
    if (key === 'extensionElements') continue; // handled separately
    const val = bo[key];
    if (val !== undefined && val !== null && typeof val !== 'object') {
      propsToClone[key] = val;
    }
  }

  // Override name if provided
  if (overrideName !== undefined) {
    propsToClone.name = overrideName;
  }

  if (Object.keys(propsToClone).length > 0) {
    modeling.updateProperties(clone, propsToClone);
  }
  if (propsToClone.name || overrideName) {
    modeling.updateLabel(clone, propsToClone.name || overrideName);
  }

  // Copy extension elements
  if (bo.extensionElements?.values?.length > 0) {
    const cloneBo = clone.businessObject;
    if (!cloneBo.extensionElements) {
      cloneBo.extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
      cloneBo.extensionElements.$parent = cloneBo;
    }
    for (const ext of bo.extensionElements.values) {
      try {
        const clonedExt = JSON.parse(JSON.stringify(ext, (k, v) => k.startsWith('$') && k !== '$type' ? undefined : v));
        const newExt = moddle.create(ext.$type, clonedExt);
        newExt.$parent = cloneBo.extensionElements;
        cloneBo.extensionElements.values.push(newExt);
      } catch {
        // Skip extensions that can't be cloned
      }
    }
  }

  // Copy condition expression for sequence flows
  if (bo.conditionExpression) {
    const expr = moddle.create('bpmn:FormalExpression', { body: bo.conditionExpression.body });
    modeling.updateProperties(clone, { conditionExpression: expr });
  }

  const result: any = {
    elementId: clone.id,
    sourceId,
    type: clone.type,
    x: clone.x,
    y: clone.y,
  };

  // Deep clone: copy children of expanded subprocess
  if (deep && bo.$type === 'bpmn:SubProcess' && shapeAttrs.isExpanded) {
    const childIds: string[] = [];
    const idMap: Record<string, string> = {};
    const children = (source.children || []).filter(
      (child: any) => child.type !== 'label'
    );

    // Clone child shapes
    for (const child of children) {
      if (child.waypoints) continue; // skip connections, handle after
      const childClone = modeling.createShape(
        { type: child.type },
        { x: child.x + (x - source.x), y: child.y + (y - source.y), width: child.width, height: child.height },
        clone,
      );
      idMap[child.id] = childClone.id;
      childIds.push(childClone.id);

      // Copy child name
      const childBo = child.businessObject;
      if (childBo.name) {
        modeling.updateLabel(childClone, childBo.name);
      }
    }

    // Clone internal connections
    for (const child of children) {
      if (!child.waypoints) continue;
      const srcId = idMap[child.source?.id];
      const tgtId = idMap[child.target?.id];
      if (srcId && tgtId) {
        const src = elementRegistry.get(srcId);
        const tgt = elementRegistry.get(tgtId);
        if (src && tgt) {
          const conn = modeling.connect(src, tgt);
          childIds.push(conn.id);
        }
      }
    }

    result.childIds = childIds;
  }

  return result;
}

// Tools that are async and cannot be dispatched synchronously inside a compound
const ASYNC_TOOLS = new Set([
  'get_diagram_xml', 'import_xml', 'save_diagram', 'export_image',
  'build_process', 'auto_layout', 'batch_operations',
]);

/**
 * Synchronous dispatch for tools that don't need async execution.
 * Used inside commandStack compound commands where async would break nesting.
 */
function dispatchRendererToolSync(
  tool: string,
  params: Record<string, unknown>,
  services: BpmnServices
): any {
  switch (tool) {
    case 'add_start_event':      return addStartEvent(params, services);
    case 'add_task':             return addTask(params, services);
    case 'add_end_event':        return addEndEvent(params, services);
    case 'connect_elements':     return connectElements(params, services);
    case 'link_form_to_task':    return linkFormToTask(params, services);
    case 'add_gateway':          return addGateway(params, services);
    case 'add_event':            return addEvent(params, services);
    case 'add_subprocess':       return addSubprocess(params, services);
    case 'set_properties':       return setProperties(params, services);
    case 'set_io_mapping':       return setIoMapping(params, services);
    case 'set_task_headers':     return setTaskHeaders(params, services);
    case 'list_elements':        return listElements(params, services);
    case 'get_element':          return getElement(params, services);
    case 'delete_element':       return deleteElement(params, services);
    case 'move_element':         return moveElement(params, services);
    case 'add_participant':      return addParticipant(params, services);
    case 'add_lane':             return addLane(params, services);
    case 'add_end_event_typed':  return addEndEventTyped(params, services);
    case 'add_message_flow':     return addMessageFlow(params, services);
    case 'add_annotation':       return addAnnotation(params, services);
    case 'resize_element':       return resizeElement(params, services);
    case 'set_flow_waypoints':   return setFlowWaypoints(params, services);
    case 'get_element_bounds':   return getElementBounds(params, services);
    case 'clone_element':        return cloneElement(params, services);
    case 'add_group':            return addGroup(params, services);
    case 'patch_element':        return patchElement(params, services);
    case 'validate_layout':      return validateLayout(params, services);
    default:
      throw new Error(`Tool "${tool}" cannot be dispatched synchronously`);
  }
}

async function batchOperations(
  params: Record<string, unknown>,
  services: BpmnServices
) {
  const { commandStack } = services;
  const operations = params.operations as Array<{ tool: string; params: Record<string, unknown> }>;
  const results: any[] = [];

  // If all operations are sync-safe, run them in a single undoable compound
  const allSync = operations.every(op => !ASYNC_TOOLS.has(op.tool));

  if (allSync) {
    let batchError: any = null;
    commandStack.execute('mcp.compound', { fn: () => {
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        const resolvedParams = resolveRefs(op.params, results);
        try {
          const result = dispatchRendererToolSync(op.tool, resolvedParams, services);
          results.push(result);
        } catch (err: any) {
          batchError = { error: `Operation ${i} (${op.tool}) failed: ${err.message}`, failedIndex: i, results };
          throw err; // abort the compound
        }
      }
    }});
    if (batchError) return batchError;
  } else {
    // Fallback: mixed sync/async — each operation is a separate undo step
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const resolvedParams = resolveRefs(op.params, results);
      try {
        const result = await dispatchRendererTool(op.tool, resolvedParams, services);
        results.push(result);
      } catch (err: any) {
        return {
          error: `Operation ${i} (${op.tool}) failed: ${err.message}`,
          failedIndex: i,
          results,
        };
      }
    }
  }

  return { results };
}

/**
 * Resolves "$ref:N" placeholders in params by replacing them with the
 * elementId or connectionId from the result at index N.
 */
function resolveRefs(
  params: Record<string, unknown>,
  results: any[],
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.startsWith('$ref:')) {
      const idx = parseInt(value.slice(5), 10);
      if (idx >= 0 && idx < results.length) {
        const ref = results[idx];
        resolved[key] = ref.elementId || ref.connectionId || ref.flowId || ref.id;
      } else {
        resolved[key] = value;
      }
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

function addGroup(
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

/**
 * Sets or corrects the target Camunda 8 execution platform version on the
 * currently open diagram's bpmn:definitions. Needed because not every
 * diagram is created via create_model — one authored directly in Modeler and
 * only populated via MCP tools afterward carries no version stamp from this
 * plugin at all, and would otherwise silently keep whichever version
 * Modeler's own "New Diagram" default assigned it.
 */
function setExecutionPlatformVersion(
  params: Record<string, unknown>,
  { canvas }: BpmnServices
) {
  const version = params.version as string;
  const platform = (params.platform as string) || 'Camunda Cloud';

  const rootElement = canvas.getRootElement();
  if (!rootElement) throw new Error('No diagram is currently open');

  const definitions = rootElement.businessObject?.$parent;
  if (!definitions) throw new Error('Could not resolve bpmn:definitions for the open diagram');

  definitions.executionPlatform = platform;
  definitions.executionPlatformVersion = version;

  return { executionPlatform: platform, executionPlatformVersion: version };
}

/* ------------------------------------------------------------------ */
/*  v0.10 — patch_element + build_process                             */
/* ------------------------------------------------------------------ */

function patchElement(
  params: Record<string, unknown>,
  services: BpmnServices
) {
  const elementId = params.elementId as string;
  const element = services.elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);

  const patched: string[] = [];

  // Properties (reuse setProperties logic)
  const propKeys = [
    'name', 'documentation', 'conditionExpression', 'implementationType',
    'implementationValue', 'taskTopic', 'taskPriority', 'taskType',
    'taskRetries', 'isExecutable',
  ];
  const hasProps = propKeys.some(k => params[k] !== undefined);
  if (hasProps) {
    setProperties({ ...params, elementId }, services);
    patched.push(...propKeys.filter(k => params[k] !== undefined));
  }

  // Update visual label when name changes (setProperties only sets the BO property)
  if (params.name !== undefined) {
    services.modeling.updateLabel(element, params.name as string);
  }

  // Waypoints
  if (params.waypoints) {
    setFlowWaypoints({ flowId: elementId, waypoints: params.waypoints }, services);
    patched.push('waypoints');
  }

  // Position
  if (params.x !== undefined || params.y !== undefined) {
    const cx = element.x + (element.width || 0) / 2;
    const cy = element.y + (element.height || 0) / 2;
    const newX = (params.x as number) ?? cx;
    const newY = (params.y as number) ?? cy;
    moveElement({ elementId, x: newX, y: newY }, services);
    patched.push('position');
  }

  return { elementId, patched };
}

/* ------------------------------------------------------------------ */
/*  build_process — declarative process builder                       */
/* ------------------------------------------------------------------ */

const TYPE_MAP: Record<string, string> = {
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

const END_EVENT_DEFS: Record<string, string> = {
  endEventError: 'bpmn:ErrorEventDefinition',
  endEventTerminate: 'bpmn:TerminateEventDefinition',
  endEventSignal: 'bpmn:SignalEventDefinition',
  endEventMessage: 'bpmn:MessageEventDefinition',
  endEventEscalation: 'bpmn:EscalationEventDefinition',
};

// Default x spacing for auto-positioned elements
const DEFAULT_SPACING_X = 180;
const DEFAULT_START_X = 200;
const DEFAULT_Y = 200;

async function buildProcess(
  params: Record<string, unknown>,
  services: BpmnServices
) {
  const { modeling, canvas, elementRegistry, moddle, bpmnFactory, commandStack } = services;
  const elements = params.elements as any[];
  const flows = (params.flows as any[]) || [];
  const autoLayoutFlag = (params.autoLayout as boolean) || false;

  const root = canvas.getRootElement();
  if (!root) throw new Error('No diagram is currently open');

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

    // Resolve parent (logical ID → real ID)
    let parent = root;
    if (el.parentId) {
      const realParentId = idMap[el.parentId];
      if (realParentId) {
        parent = elementRegistry.get(realParentId) || root;
      }
    }

    let shape: any;

    // Handle typed end events (endEventError, endEventTerminate, etc.)
    if (END_EVENT_DEFS[typeName]) {
      shape = modeling.createShape({ type: 'bpmn:EndEvent' }, { x, y }, parent);
      const bo = shape.businessObject;
      const defType = END_EVENT_DEFS[typeName];
      const refProps = eventDefRefProps(bpmnFactory, getDefinitions(bo, canvas), defType, el.properties || {});
      const eventDef = bpmnFactory.create(defType, refProps);
      eventDef.$parent = bo;
      bo.eventDefinitions = [eventDef];

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
        modeling.updateProperties(shape, { calledElement: el.calledElement });
      }

    // Handle boundary events
    } else if (typeName === 'boundaryEvent') {
      const hostId = el.attachedToId ? (idMap[el.attachedToId] || el.attachedToId) : undefined;
      if (!hostId) throw new Error(`BoundaryEvent "${logicalId}" requires attachedToId`);
      const host = elementRegistry.get(hostId);
      if (!host) throw new Error(`Host element "${hostId}" not found for BoundaryEvent`);
      const boundaryPos = getBoundaryPosition(host, el.boundaryPosition || 'bottom');
      shape = modeling.createShape(
        { type: 'bpmn:BoundaryEvent', host },
        boundaryPos,
        host.parent,
      );
      if (el.cancelActivity === false) {
        modeling.updateProperties(shape, { cancelActivity: false });
      }
      if (el.eventDefinitionType) {
        const bo = shape.businessObject;
        const refProps = eventDefRefProps(bpmnFactory, getDefinitions(bo, canvas), el.eventDefinitionType, el.properties || {});
        const eventDef = bpmnFactory.create(el.eventDefinitionType, refProps);
        eventDef.$parent = bo;
        bo.eventDefinitions = [eventDef];
        // Boundary events always "catch" — require correlationKey alongside a message ref.
        if (el.eventDefinitionType === 'bpmn:MessageEventDefinition' && el.properties?.correlationKey) {
          setZeebeSubscription(moddle, modeling, shape, el.properties.correlationKey);
        }
      }

    // Handle start events (typed, e.g. Message Start Event) and intermediate events
    } else if (typeName === 'startEvent' || typeName === 'intermediateCatchEvent' || typeName === 'intermediateThrowEvent') {
      shape = modeling.createShape({ type: TYPE_MAP[typeName] }, { x, y }, parent);
      if (el.eventDefinitionType && el.eventDefinitionType !== 'none') {
        const bo = shape.businessObject;
        const refProps = eventDefRefProps(bpmnFactory, getDefinitions(bo, canvas), el.eventDefinitionType, el.properties || {});
        const eventDef = bpmnFactory.create(el.eventDefinitionType, refProps);
        eventDef.$parent = bo;
        bo.eventDefinitions = [eventDef];
        // Only intermediateCatchEvent "catches" — startEvent/intermediateThrowEvent don't correlate.
        if (
          el.eventDefinitionType === 'bpmn:MessageEventDefinition' &&
          typeName === 'intermediateCatchEvent' &&
          el.properties?.correlationKey
        ) {
          setZeebeSubscription(moddle, modeling, shape, el.properties.correlationKey);
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
      if (el.properties.correlationKey && shape.type === 'bpmn:ReceiveTask' && moddle.getPackage('zeebe')) {
        setZeebeSubscription(moddle, modeling, shape, el.properties.correlationKey);
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

  // Phase 3: Auto-layout if requested (separate undo step — async)
  if (autoLayoutFlag) {
    try {
      await smartAutoLayout({ diagramId: '' }, services);
    } catch {
      // Auto-layout is best-effort — don't fail the whole build
    }
  }

  return {
    idMap,
    elementCount: elements.length,
    flowCount: flowIds.length,
  };
}

/* ------------------------------------------------------------------ */
/*  auto_layout — smart branch-aware layout engine                    */
/* ------------------------------------------------------------------ */

interface LayoutOpts {
  branchSpacing: number;
  horizontalSpacing: number;
  flowRouting: 'orthogonal' | 'direct';
  mergeAlignment: 'center' | 'top-branch';
  boundaryEventPosition: 'bottom' | 'bottom-right';
}

const DEFAULT_LAYOUT_OPTS: LayoutOpts = {
  branchSpacing: 140,
  horizontalSpacing: 80,
  flowRouting: 'orthogonal',
  mergeAlignment: 'center',
  boundaryEventPosition: 'bottom',
};

async function smartAutoLayout(
  params: Record<string, unknown>,
  services: BpmnServices
) {
  const { modeling, elementRegistry, canvas, commandStack } = services;
  const scopeId = params.elementId as string | undefined;
  const userOpts = (params.options as Partial<LayoutOpts>) || {};
  const opts: LayoutOpts = { ...DEFAULT_LAYOUT_OPTS, ...userOpts };

  // Wait for rendering to complete so all element positions are up to date
  await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

  // Resolve scope: either a specific subprocess or the root
  const scope = scopeId ? elementRegistry.get(scopeId) : canvas.getRootElement();
  if (!scope) throw new Error(scopeId ? `Element "${scopeId}" not found` : 'No diagram open');

  // Gather shapes and connections within scope
  const allElements: any[] = elementRegistry.getAll();
  const shapes = allElements.filter((el: any) => {
    if (!el.type || el.type.startsWith('bpmndi:') || el.type === 'label') return false;
    if (el.waypoints) return false;
    if (el.type === 'bpmn:BoundaryEvent') return false; // handled separately
    return el.parent === scope;
  });
  const connections = allElements.filter((el: any) => {
    if (!el.waypoints) return false;
    return el.source?.parent === scope || el.target?.parent === scope;
  });

  if (shapes.length === 0) return { positioned: 0, routed: 0 };

  // Build adjacency: outgoing map and incoming count
  const outgoing = new Map<string, { target: any; conn: any; name?: string }[]>();
  const incomingCount = new Map<string, number>();
  for (const s of shapes) {
    outgoing.set(s.id, []);
    incomingCount.set(s.id, 0);
  }
  for (const c of connections) {
    const sid = c.source?.id, tid = c.target?.id;
    if (!sid || !tid) continue;
    if (!outgoing.has(sid) || !incomingCount.has(tid)) continue;
    outgoing.get(sid)!.push({ target: c.target, conn: c, name: c.businessObject?.name });
    incomingCount.set(tid, (incomingCount.get(tid) || 0) + 1);
  }

  // Find start nodes (no incoming within scope)
  const startNodes = shapes.filter((s: any) =>
    (incomingCount.get(s.id) || 0) === 0 || s.type === 'bpmn:StartEvent'
  );
  if (startNodes.length === 0) {
    // Fallback: pick the first element
    startNodes.push(shapes[0]);
  }

  // BFS to assign column (x) and row (y) per element
  // Track: column index, row offset, and branch assignments
  const colMap = new Map<string, number>(); // element id → column index
  const rowMap = new Map<string, number>(); // element id → row offset
  const visited = new Set<string>();
  const queue: { el: any; col: number; row: number }[] = [];

  for (const start of startNodes) {
    if (visited.has(start.id)) continue;
    queue.push({ el: start, col: 0, row: 0 });
    visited.add(start.id);
  }

  let maxCol = 0;
  while (queue.length > 0) {
    const { el, col, row } = queue.shift()!;

    // For convergence points (merge gateways), always take the latest column
    // but allow row updates from the fan-out assignments
    const existingCol = colMap.get(el.id);
    if (existingCol !== undefined) {
      // Keep the highest column (convergence: merge gateway needs to be after all branches)
      if (col > existingCol) {
        colMap.set(el.id, col);
      }
      continue; // Don't re-traverse outgoing — already processed
    }

    colMap.set(el.id, col);
    rowMap.set(el.id, row);
    if (col > maxCol) maxCol = col;

    const targets = outgoing.get(el.id) || [];
    const isGateway = el.type?.includes('Gateway');
    const isBranching = isGateway && targets.length > 1;

    if (isBranching) {
      // Fan out branches vertically, centered on current row
      // All targets get fanned — even if visited (they'll update col but not row)
      const forwardTargets = targets.filter(t => !visited.has(t.target.id));

      const branchCount = forwardTargets.length;
      if (branchCount > 0) {
        const startRow = row - ((branchCount - 1) * opts.branchSpacing) / 2;
        forwardTargets.forEach((t, idx) => {
          const branchRow = startRow + idx * opts.branchSpacing;
          visited.add(t.target.id);
          rowMap.set(t.target.id, branchRow); // Pre-assign row for fan-out
          queue.push({ el: t.target, col: col + 1, row: branchRow });
        });
      }

      // Loop-back targets: just update their column if needed
      for (const t of targets) {
        if (visited.has(t.target.id) && !forwardTargets.includes(t)) {
          queue.push({ el: t.target, col: col + 1, row });
        }
      }
    } else {
      // Sequential: advance column, keep same row
      for (const t of targets) {
        if (!visited.has(t.target.id)) {
          visited.add(t.target.id);
          queue.push({ el: t.target, col: col + 1, row });
        } else {
          // Convergence: push to update column
          queue.push({ el: t.target, col: col + 1, row });
        }
      }
    }
  }

  // Handle merge gateways: align to center of incoming branches
  for (const s of shapes) {
    if (!s.type?.includes('Gateway')) continue;
    const inc = (s.incoming || []).filter((c: any) => c.source?.parent === scope);
    if (inc.length < 2) continue;
    // This is a merge gateway — compute average row of sources
    const sourceRows = inc
      .map((c: any) => rowMap.get(c.source?.id))
      .filter((r: any): r is number => r !== undefined);
    if (sourceRows.length >= 2) {
      if (opts.mergeAlignment === 'center') {
        rowMap.set(s.id, sourceRows.reduce((a: number, b: number) => a + b, 0) / sourceRows.length);
      } else {
        rowMap.set(s.id, Math.min(...sourceRows));
      }
    }
  }

  // Convert column/row to pixel coordinates
  const baseX = (scope.x || 0) + 60;
  const baseY = (scope.y || 0) + (scope.height ? scope.height / 2 : 200);

  // Wrap all positioning + routing in a single undoable compound command
  let positioned = 0;
  let routed = 0;

  commandStack.execute('mcp.compound', { fn: () => {

  for (const s of shapes) {
    const col = colMap.get(s.id);
    const row = rowMap.get(s.id);
    if (col === undefined || row === undefined) continue;

    const elW = s.width || 36;
    const elH = s.height || 36;
    const targetX = baseX + col * (100 + opts.horizontalSpacing);
    const targetY = baseY + row;

    const cx = s.x + elW / 2;
    const cy = s.y + elH / 2;
    const dx = targetX - cx;
    const dy = targetY - cy;

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      try {
        modeling.moveElements([s], { x: dx, y: dy });
        positioned++;
      } catch {
        // Skip elements that fail to move
      }
    }
  }

  // Position boundary events on their host's edge
  const boundaryEvents = allElements.filter((el: any) =>
    el.type === 'bpmn:BoundaryEvent' && el.parent?.parent === scope
  );
  for (const be of boundaryEvents) {
    const host = be.host || be.parent;
    if (!host || !host.width) continue;
    const pos = getBoundaryPosition(host, opts.boundaryEventPosition);
    const beCx = be.x + (be.width || 36) / 2;
    const beCy = be.y + (be.height || 36) / 2;
    const dx = pos.x - beCx;
    const dy = pos.y - beCy;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      try {
        modeling.moveElements([be], { x: dx, y: dy });
        positioned++;
      } catch { /* skip */ }
    }
  }

  // Position boundary event TARGET tasks below their boundary event.
  // Also find targets via the connections array (boundary event flows may
  // not be in `connections` since they're filtered by parent scope).
  const beFlows = allElements.filter((el: any) =>
    el.waypoints && el.source?.type === 'bpmn:BoundaryEvent'
  );
  for (const conn of beFlows) {
    const be = elementRegistry.get(conn.source.id);
    const target = elementRegistry.get(conn.target?.id);
    if (!be || !target || !target.width) continue;
    const beCx = be.x + (be.width || 36) / 2;
    const beBottom = be.y + (be.height || 36);
    const targetW = target.width || 100;
    const targetH = target.height || 80;
    const targetCx = target.x + targetW / 2;
    const targetCy = target.y + targetH / 2;
    const desiredX = beCx;
    const desiredY = beBottom + 60 + targetH / 2;
    const dx = desiredX - targetCx;
    const dy = desiredY - targetCy;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      try {
        modeling.moveElements([target], { x: dx, y: dy });
        positioned++;
      } catch { /* skip — no direct mutation fallback */ }
    }
  }

  // Route connections orthogonally
  if (opts.flowRouting === 'orthogonal') {
    for (const conn of connections) {
      const src = conn.source, tgt = conn.target;
      if (!src || !tgt) continue;

      const srcCx = src.x + (src.width || 36) / 2;
      const srcCy = src.y + (src.height || 36) / 2;
      const tgtCx = tgt.x + (tgt.width || 36) / 2;
      const tgtCy = tgt.y + (tgt.height || 36) / 2;
      const srcRight = src.x + (src.width || 36);
      const tgtLeft = tgt.x;

      // Check if flow is a loop-back (target is to the left)
      const isLoopBack = tgtCx <= srcCx;

      let newWaypoints: { x: number; y: number }[];
      if (isLoopBack) {
        // Route below: source bottom → down → left → up → target bottom
        const loopY = Math.max(srcCy, tgtCy) + (src.height || 80) / 2 + 60;
        newWaypoints = [
          { x: srcCx, y: srcCy + (src.height || 36) / 2 },
          { x: srcCx, y: loopY },
          { x: tgtCx, y: loopY },
          { x: tgtCx, y: tgtCy + (tgt.height || 36) / 2 },
        ];
      } else if (Math.abs(srcCy - tgtCy) < 3) {
        // Same y — straight horizontal
        newWaypoints = [
          { x: srcRight, y: srcCy },
          { x: tgtLeft, y: tgtCy },
        ];
      } else {
        // L-shaped routing
        const midX = (srcRight + tgtLeft) / 2;
        newWaypoints = [
          { x: srcRight, y: srcCy },
          { x: midX, y: srcCy },
          { x: midX, y: tgtCy },
          { x: tgtLeft, y: tgtCy },
        ];
      }

      try {
        if (typeof modeling.updateWaypoints === 'function') {
          modeling.updateWaypoints(conn, newWaypoints);
        } else {
          modeling.layoutConnection(conn, {
            connectionStart: newWaypoints[0],
            connectionEnd: newWaypoints[newWaypoints.length - 1],
          });
        }
        routed++;
      } catch {
        // Skip connections that fail to route
      }
    }
  }

  }}); // end mcp.compound — all position + route changes are a single undo step

  return { positioned, routed, elementCount: shapes.length };
}

/* ------------------------------------------------------------------ */
/*  validate_layout — layout advisory and auto-fix                    */
/* ------------------------------------------------------------------ */

interface LayoutIssue {
  severity: 'error' | 'warning' | 'suggestion';
  type: string;
  elementIds: string[];
  message: string;
  fix?: { tool: string; params: Record<string, unknown> } | null;
}

interface Rect { x: number; y: number; width: number; height: number }

function elRect(el: any): Rect {
  return { x: el.x, y: el.y, width: el.width || 0, height: el.height || 0 };
}

function elCenter(el: any): { x: number; y: number } {
  return { x: el.x + (el.width || 0) / 2, y: el.y + (el.height || 0) / 2 };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
      && a.y < b.y + b.height && a.y + a.height > b.y;
}

function isInsideRect(child: Rect, parent: Rect, pad = 0): boolean {
  return child.x >= parent.x + pad
      && child.y >= parent.y + pad
      && child.x + child.width <= parent.x + parent.width - pad
      && child.y + child.height <= parent.y + parent.height - pad;
}

function segmentIsOrthogonal(p1: { x: number; y: number }, p2: { x: number; y: number }, tolerance = 3): boolean {
  return Math.abs(p1.x - p2.x) <= tolerance || Math.abs(p1.y - p2.y) <= tolerance;
}

/** Check if a line segment intersects a rectangle (simplified AABB test) */
function segmentIntersectsRect(
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

function elName(el: any): string {
  return el.businessObject?.name || el.id;
}

async function validateLayout(
  params: Record<string, unknown>,
  services: BpmnServices
) {
  const { elementRegistry, modeling, canvas } = services;
  const scopeId = params.elementId as string | undefined;
  const autoFix = (params.autoFix as boolean) || false;
  const minSeverity = (params.severity as string) || 'warning';

  // Wait for the rendering engine to finish positioning all elements.
  // Boundary events in particular get default coordinates (e.g. 96, 58) on
  // creation and are only moved to the host's perimeter during the next
  // render cycle. Without this wait, we'd read stale default positions.
  await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

  /**
   * Resolve an element to its rendered diagram shape with correct absolute
   * coordinates. For boundary events, compute absolute position from the
   * host element since the shape's own x/y may still hold stale defaults
   * from creation (before the renderer repositioned it on the host perimeter).
   */
  const resolve = (el: any): any => {
    if (!el?.id) return el;
    const fresh = elementRegistry.get(el.id);
    if (!fresh) return el;
    // Boundary events: if position looks like defaults (small x/y far from host),
    // compute from the host element's actual position instead.
    if (fresh.type === 'bpmn:BoundaryEvent') {
      // Always compute boundary event position from host element.
      // The shape's own x/y may hold stale defaults from creation time.
      const hostRef = fresh.host
        || (fresh.businessObject?.attachedToRef && elementRegistry.get(fresh.businessObject.attachedToRef.id))
        || fresh.parent;
      const host = hostRef?.id ? (elementRegistry.get(hostRef.id) || hostRef) : hostRef;
      if (host && host.width && host.height) {
        const corrected = { ...fresh };
        corrected.x = host.x + host.width / 2 - (fresh.width || 36) / 2;
        corrected.y = host.y + host.height - (fresh.height || 36) / 2;
        return corrected;
      }
    }
    return fresh;
  };

  const severityOrder: Record<string, number> = { error: 0, warning: 1, suggestion: 2 };
  const minLevel = severityOrder[minSeverity] ?? 1;

  // Gather shapes and connections within scope.
  // Resolve every element through elementRegistry.get() to get the latest
  // rendered coordinates (especially important for boundary events).
  const allElements: any[] = elementRegistry.getAll();
  const shapes = allElements
    .filter((el: any) => {
      if (!el.type || el.type.startsWith('bpmndi:') || el.type === 'label') return false;
      if (el.waypoints) return false;
      if (scopeId && el.parent?.id !== scopeId && el.id !== scopeId) return false;
      return true;
    })
    .map((el: any) => resolve(el));
  const connections = allElements
    .filter((el: any) => {
      if (!el.waypoints) return false;
      if (scopeId) {
        const src = resolve(el.source), tgt = resolve(el.target);
        const srcInScope = src?.parent?.id === scopeId || src?.id === scopeId;
        const tgtInScope = tgt?.parent?.id === scopeId || tgt?.id === scopeId;
        if (!srcInScope && !tgtInScope) return false;
      }
      return true;
    })
    .map((el: any) => resolve(el));

  const issues: LayoutIssue[] = [];

  // ── ERRORS ─────────────────────────────────────────────────────────

  // 1. outside_parent — element outside its parent subprocess/pool bounds
  //    Skip root process / collaboration — they have no meaningful visual bounds
  for (const el of shapes) {
    const parent = resolve(el.parent);
    if (!parent || !parent.width) continue;
    // Root process and collaboration elements aren't visual containers
    const parentType = parent.type || parent.businessObject?.$type;
    if (parentType === 'bpmn:Process' || parentType === 'bpmn:Collaboration') continue;
    if (el.type === 'bpmn:BoundaryEvent') continue;
    const cr = elRect(el);
    const pr = elRect(parent);
    if (!isInsideRect(cr, pr)) {
      const cc = elCenter(el);
      const fixX = Math.max(pr.x + 40, Math.min(cc.x, pr.x + pr.width - 40));
      const fixY = Math.max(pr.y + 40, Math.min(cc.y, pr.y + pr.height - 40));
      issues.push({
        severity: 'error', type: 'outside_parent',
        elementIds: [el.id],
        message: `'${elName(el)}' is outside parent '${elName(parent)}'`,
        fix: { tool: 'move_element', params: { elementId: el.id, x: Math.round(fixX), y: Math.round(fixY) } },
      });
    }
  }

  // 2. overlap — two shapes occupy the same space
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i], b = shapes[j];
      if (!a.width || !b.width) continue;
      // Skip parent-child pairs (children are inside parent by design)
      if (a.parent === b || b.parent === a) continue;
      if (a.type === 'bpmn:BoundaryEvent' || b.type === 'bpmn:BoundaryEvent') continue;
      const ar = elRect(a), br = elRect(b);
      if (rectsOverlap(ar, br)) {
        const bc = elCenter(b);
        issues.push({
          severity: 'error', type: 'overlap',
          elementIds: [a.id, b.id],
          message: `'${elName(a)}' overlaps with '${elName(b)}'`,
          fix: { tool: 'move_element', params: { elementId: b.id, x: bc.x + 150, y: bc.y } },
        });
      }
    }
  }

  // 3. disconnected_flow — waypoints don't connect to source/target edges
  //    Always resolve source/target via elementRegistry to get absolute canvas
  //    coordinates (conn.source can hold stale/relative coords for boundary events).
  for (const conn of connections) {
    const wps = conn.waypoints;
    if (!wps || wps.length < 2) continue;
    const src = resolve(conn.source);
    const tgt = resolve(conn.target);
    if (!src || !tgt) continue;
    const srcRect = elRect(src);
    const tgtRect = elRect(tgt);
    const firstWp = wps[0];
    const lastWp = wps[wps.length - 1];
    const srcDist = distToRect(firstWp, srcRect);
    const tgtDist = distToRect(lastWp, tgtRect);
    if (srcDist > 20 || tgtDist > 20) {
      const srcC = elCenter(src);
      const tgtC = elCenter(tgt);
      issues.push({
        severity: 'error', type: 'disconnected_flow',
        elementIds: [conn.id],
        message: `Flow '${elName(conn)}' waypoints don't connect to source/target edges`,
        fix: { tool: 'set_flow_waypoints', params: {
          flowId: conn.id,
          waypoints: [{ x: Math.round(srcC.x + (srcRect.width || 0) / 2), y: Math.round(srcC.y) }, { x: Math.round(tgtC.x - (tgtRect.width || 0) / 2), y: Math.round(tgtC.y) }]
        }},
      });
    }
  }

  // ── WARNINGS ───────────────────────────────────────────────────────

  // 4. diagonal_flow — non-orthogonal segments
  for (const conn of connections) {
    const wps = conn.waypoints;
    if (!wps || wps.length < 2) continue;
    let hasDiagonal = false;
    for (let k = 0; k < wps.length - 1; k++) {
      if (!segmentIsOrthogonal(wps[k], wps[k + 1])) { hasDiagonal = true; break; }
    }
    if (hasDiagonal) {
      // Generate orthogonal routing — resolve via registry for correct coords
      const src = resolve(conn.source);
      const tgt = resolve(conn.target);
      if (!src || !tgt) continue;
      const srcC = elCenter(src), tgtC = elCenter(tgt);
      const srcRight = src.x + (src.width || 0);
      const tgtLeft = tgt.x;
      const midX = (srcRight + tgtLeft) / 2;
      issues.push({
        severity: 'warning', type: 'diagonal_flow',
        elementIds: [conn.id],
        message: `Flow from '${elName(src)}' to '${elName(tgt)}' has diagonal routing`,
        fix: { tool: 'set_flow_waypoints', params: {
          flowId: conn.id,
          waypoints: srcC.y === tgtC.y
            ? [{ x: srcRight, y: srcC.y }, { x: tgtLeft, y: tgtC.y }]
            : [{ x: srcRight, y: srcC.y }, { x: midX, y: srcC.y }, { x: midX, y: tgtC.y }, { x: tgtLeft, y: tgtC.y }],
        }},
      });
    }
  }

  // 5. subprocess_too_small — expanded subprocess doesn't contain children
  for (const el of shapes) {
    const bo = el.businessObject;
    if (bo?.$type !== 'bpmn:SubProcess') continue;
    const isExpanded = el.isExpanded ?? el.di?.isExpanded ?? false;
    if (!isExpanded) continue;
    const children = (el.children || []).map((c: any) => resolve(c)).filter((c: any) => c.type !== 'label' && !c.waypoints);
    if (children.length === 0) continue;
    const pr = elRect(el);
    let allInside = true;
    for (const child of children) {
      if (!isInsideRect(elRect(child), pr)) { allInside = false; break; }
    }
    if (!allInside) {
      // Calculate required bounds
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const child of children) {
        minX = Math.min(minX, child.x);
        minY = Math.min(minY, child.y);
        maxX = Math.max(maxX, child.x + (child.width || 36));
        maxY = Math.max(maxY, child.y + (child.height || 36));
      }
      const padding = 50;
      const newW = Math.max(pr.width, (maxX - minX) + padding * 2);
      const newH = Math.max(pr.height, (maxY - minY) + padding * 2);
      issues.push({
        severity: 'warning', type: 'subprocess_too_small',
        elementIds: [el.id],
        message: `Subprocess '${elName(el)}' does not fully contain its children`,
        fix: { tool: 'resize_element', params: { elementId: el.id, width: Math.ceil(newW), height: Math.ceil(newH) } },
      });
    }
  }

  // 5b. stale_boundary_flow — boundary event flows with stale waypoints
  //     After build_process, boundary events are positioned correctly but
  //     their outgoing flows retain the default creation-time waypoints.
  //     Detect and fix these before the general flow_crosses_element check.
  const staleBoundaryFlowIds = new Set<string>();
  for (const conn of connections) {
    const src = conn.source ? elementRegistry.get(conn.source.id) : null;
    if (!src || src.type !== 'bpmn:BoundaryEvent') continue;
    const wps = conn.waypoints;
    if (!wps || wps.length < 2) continue;
    // Check if first waypoint is far from the boundary event's actual position
    const firstWp = wps[0];
    const srcRect = elRect(resolve(conn.source));
    if (distToRect(firstWp, srcRect) > 50) {
      // Stale waypoints — generate fix from host-computed position
      const resolvedSrc = resolve(conn.source);
      const resolvedTgt = resolve(conn.target);
      if (resolvedSrc && resolvedTgt) {
        const beCenterX = resolvedSrc.x + (resolvedSrc.width || 36) / 2;
        const beBottom = resolvedSrc.y + (resolvedSrc.height || 36);
        const tgtCenterY = resolvedTgt.y + (resolvedTgt.height || 80) / 2;
        const tgtLeft = resolvedTgt.x;
        staleBoundaryFlowIds.add(conn.id);
        issues.push({
          severity: 'error', type: 'stale_boundary_flow',
          elementIds: [conn.id],
          message: `Flow from boundary event '${elName(resolvedSrc)}' has stale waypoints`,
          fix: { tool: 'set_flow_waypoints', params: {
            flowId: conn.id,
            waypoints: [
              { x: Math.round(beCenterX), y: Math.round(beBottom) },
              { x: Math.round(beCenterX), y: Math.round(tgtCenterY) },
              { x: Math.round(tgtLeft), y: Math.round(tgtCenterY) },
            ],
          }},
        });
      }
    }
  }

  // 6. flow_crosses_element — a flow routes through an unrelated element
  for (const conn of connections) {
    if (staleBoundaryFlowIds.has(conn.id)) continue; // Already handled above
    const wps = conn.waypoints;
    if (!wps || wps.length < 2) continue;
    const src = resolve(conn.source);
    const tgt = resolve(conn.target);
    const srcId = src?.id, tgtId = tgt?.id;
    for (const shape of shapes) {
      if (!shape.width || shape.id === srcId || shape.id === tgtId) continue;
      if (shape.parent === src || shape.parent === tgt) continue;
      if (shape.businessObject?.$type === 'bpmn:SubProcess' || shape.type === 'bpmn:Participant') continue;
      const rect = elRect(shape);
      let crosses = false;
      for (let k = 0; k < wps.length - 1; k++) {
        if (segmentIntersectsRect(wps[k], wps[k + 1], rect)) { crosses = true; break; }
      }
      if (crosses && src && tgt) {
        // Compute orthogonal waypoints that route around the obstruction
        const srcC = elCenter(src);
        const tgtC = elCenter(tgt);
        const srcRight = src.x + (src.width || 36);
        const tgtLeft = tgt.x;
        const pad = 20;
        const obstTop = rect.y - pad;
        const obstBottom = rect.y + rect.height + pad;

        // Decide: route above or below based on which side has more space
        const spaceAbove = Math.abs(srcC.y - obstTop);
        const spaceBelow = Math.abs(obstBottom - srcC.y);
        const routeY = spaceAbove <= spaceBelow ? obstTop : obstBottom;
        const midX = (srcRight + tgtLeft) / 2;

        const fixWaypoints = [
          { x: srcRight, y: srcC.y },
          { x: midX, y: srcC.y },
          { x: midX, y: routeY },
          { x: midX + (tgtLeft - srcRight) / 4, y: routeY },
          { x: midX + (tgtLeft - srcRight) / 4, y: tgtC.y },
          { x: tgtLeft, y: tgtC.y },
        ];

        issues.push({
          severity: 'warning', type: 'flow_crosses_element',
          elementIds: [conn.id, shape.id],
          message: `Flow '${elName(conn)}' routes through '${elName(shape)}'`,
          fix: { tool: 'set_flow_waypoints', params: { flowId: conn.id, waypoints: fixWaypoints.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })) } },
        });
        break;
      }
    }
  }

  // 7. label_overlap — flow label overlaps with a shape
  for (const conn of connections) {
    const label = conn.label;
    if (!label || !label.width) continue;
    const lr = elRect(label);
    for (const shape of shapes) {
      if (!shape.width) continue;
      if (rectsOverlap(lr, elRect(shape))) {
        issues.push({
          severity: 'warning', type: 'label_overlap',
          elementIds: [conn.id, shape.id],
          message: `Label on flow '${elName(conn)}' overlaps with '${elName(shape)}'`,
          fix: null,
        });
        break;
      }
    }
  }

  // ── SUGGESTIONS ────────────────────────────────────────────────────

  // 8. misaligned — connected elements with nearly-matching y (or x) coordinates
  const ALIGN_TOLERANCE = 8;
  for (const conn of connections) {
    const src = resolve(conn.source);
    const tgt = resolve(conn.target);
    if (!src || !tgt || !src.width || !tgt.width) continue;
    const srcC = elCenter(src), tgtC = elCenter(tgt);
    const dy = Math.abs(srcC.y - tgtC.y);
    if (dy > 0 && dy <= ALIGN_TOLERANCE) {
      const alignY = Math.round((srcC.y + tgtC.y) / 2);
      issues.push({
        severity: 'suggestion', type: 'misaligned',
        elementIds: [src.id, tgt.id],
        message: `'${elName(src)}' (y=${Math.round(srcC.y)}) and '${elName(tgt)}' (y=${Math.round(tgtC.y)}) should align at y=${alignY}`,
        fix: { tool: 'batch_operations', params: { diagramId: '', operations: [
          { tool: 'move_element', params: { elementId: src.id, x: srcC.x, y: alignY } },
          { tool: 'move_element', params: { elementId: tgt.id, x: tgtC.x, y: alignY } },
        ]}},
      });
    }
  }

  // 9. cramped — elements less than 30px apart
  const CRAMPED_THRESHOLD = 30;
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i], b = shapes[j];
      if (!a.width || !b.width) continue;
      if (a.parent === b || b.parent === a) continue;
      if (a.parent !== b.parent) continue; // only compare siblings
      const gap = gapBetween(elRect(a), elRect(b));
      if (gap >= 0 && gap < CRAMPED_THRESHOLD) {
        const bc = elCenter(b);
        const shift = CRAMPED_THRESHOLD - gap + 10;
        const moveX = bc.x + (b.x >= a.x + (a.width || 0) ? shift : 0);
        const moveY = bc.y + (b.y >= a.y + (a.height || 0) ? shift : 0);
        issues.push({
          severity: 'suggestion', type: 'cramped',
          elementIds: [a.id, b.id],
          message: `'${elName(a)}' and '${elName(b)}' are only ${Math.round(gap)}px apart`,
          fix: { tool: 'move_element', params: { elementId: b.id, x: Math.round(moveX), y: Math.round(moveY) } },
        });
      }
    }
  }

  // 10. uneven_spacing — sequential elements with inconsistent gaps
  const SPACING_TOLERANCE = 15;
  for (const el of shapes) {
    const outgoing = (el.outgoing || [])
      .map((c: any) => resolve(c.target))
      .filter((t: any) => t && t.width);
    if (outgoing.length < 2) continue;
    // Sort targets by x position
    outgoing.sort((a: any, b: any) => a.x - b.x);
    // Check vertical spacing between branches
    for (let k = 0; k < outgoing.length - 1; k++) {
      const t1 = outgoing[k], t2 = outgoing[k + 1];
      const gap1 = t2.y - (t1.y + (t1.height || 0));
      // Just report if branches exist but don't have consistent spacing
      if (outgoing.length >= 2 && k === 0) {
        const gaps: number[] = [];
        for (let m = 0; m < outgoing.length - 1; m++) {
          gaps.push(Math.abs(elCenter(outgoing[m + 1]).y - elCenter(outgoing[m]).y));
        }
        const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
        const uneven = gaps.some(g => Math.abs(g - avgGap) > SPACING_TOLERANCE);
        if (uneven && gaps.length >= 2) {
          issues.push({
            severity: 'suggestion', type: 'uneven_spacing',
            elementIds: outgoing.map((t: any) => t.id),
            message: `Targets of '${elName(el)}' have uneven vertical spacing`,
            fix: null,
          });
        }
        break; // Only check once per source element
      }
    }
  }

  // 11. branch_not_fanned — gateway branches all at same y
  //     Skip loop-back flows (target x <= gateway x)
  for (const el of shapes) {
    if (!el.type?.includes('Gateway')) continue;
    const gwC = elCenter(el);
    const targets = (el.outgoing || [])
      .map((c: any) => resolve(c.target))
      .filter((t: any) => t && t.width)
      .filter((t: any) => elCenter(t).x > gwC.x); // exclude loop-backs
    if (targets.length < 2) continue;
    const ys = targets.map((t: any) => elCenter(t).y);
    const allSameY = ys.every((y: number) => Math.abs(y - ys[0]) < 5);
    if (allSameY) {
      const fanSpacing = 120;
      const startY = gwC.y - ((targets.length - 1) * fanSpacing) / 2;
      const ops = targets.map((t: any, idx: number) => ({
        tool: 'move_element',
        params: { elementId: t.id, x: elCenter(t).x, y: Math.round(startY + idx * fanSpacing) },
      }));
      issues.push({
        severity: 'suggestion', type: 'branch_not_fanned',
        elementIds: [el.id, ...targets.map((t: any) => t.id)],
        message: `Gateway '${elName(el)}' branches all at y=${Math.round(ys[0])} — should fan out vertically`,
        fix: { tool: 'batch_operations', params: { diagramId: '', operations: ops } },
      });
    }
  }

  // 12. orphaned_annotation — annotation far from its associated element
  for (const conn of connections) {
    if (conn.type !== 'bpmn:Association') continue;
    const rSrc = resolve(conn.source), rTgt = resolve(conn.target);
    const annotation = rSrc?.type === 'bpmn:TextAnnotation' ? rSrc : rTgt;
    const assocEl = rSrc?.type === 'bpmn:TextAnnotation' ? rTgt : rSrc;
    if (!annotation || !assocEl || !annotation.width || !assocEl.width) continue;
    const dist = Math.hypot(
      elCenter(annotation).x - elCenter(assocEl).x,
      elCenter(annotation).y - elCenter(assocEl).y,
    );
    if (dist > 300) {
      const ac = elCenter(assocEl);
      issues.push({
        severity: 'suggestion', type: 'orphaned_annotation',
        elementIds: [annotation.id, assocEl.id],
        message: `Annotation '${elName(annotation)}' is ${Math.round(dist)}px from '${elName(assocEl)}'`,
        fix: { tool: 'move_element', params: { elementId: annotation.id, x: Math.round(ac.x), y: Math.round(ac.y - 80) } },
      });
    }
  }

  // ── FILTER BY SEVERITY ─────────────────────────────────────────────

  const filtered = issues.filter(i => severityOrder[i.severity] <= minLevel);

  // ── AUTO-FIX ───────────────────────────────────────────────────────

  let fixesApplied = 0;
  if (autoFix) {
    for (const issue of filtered) {
      if (!issue.fix) continue;
      try {
        const { tool, params: fixParams } = issue.fix;
        // Validate fix params — skip if any coordinate is null/undefined/NaN
        if (tool === 'move_element') {
          if (fixParams.x == null || fixParams.y == null || isNaN(fixParams.x as number) || isNaN(fixParams.y as number)) continue;
        }
        if (tool === 'resize_element') {
          if (fixParams.width == null || fixParams.height == null) continue;
        }
        if (tool === 'set_flow_waypoints') {
          const wps = fixParams.waypoints as any[];
          if (!wps || wps.some((wp: any) => wp.x == null || wp.y == null)) continue;
        }
        if (tool === 'move_element') {
          moveElement(fixParams, services);
          fixesApplied++;
        } else if (tool === 'set_flow_waypoints') {
          setFlowWaypoints(fixParams, services);
          fixesApplied++;
        } else if (tool === 'resize_element') {
          resizeElement(fixParams, services);
          fixesApplied++;
        } else if (tool === 'batch_operations') {
          const ops = (fixParams.operations as any[]) || [];
          for (const op of ops) {
            await dispatchRendererTool(op.tool, op.params, services);
          }
          fixesApplied++;
        }
      } catch {
        // Best-effort: skip individual fix failures
      }
    }
  }

  const result: any = {
    issueCount: filtered.length,
    issues: filtered,
  };
  if (autoFix) {
    result.fixesApplied = fixesApplied;
  }
  return result;
}

/** Minimum distance from a point to the perimeter of a rectangle */
function distToRect(p: { x: number; y: number }, rect: Rect): number {
  const cx = Math.max(rect.x, Math.min(p.x, rect.x + rect.width));
  const cy = Math.max(rect.y, Math.min(p.y, rect.y + rect.height));
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Minimum gap between two non-overlapping rects (0 if touching, negative if overlapping) */
function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  if (dx === 0 && dy === 0) return -1; // overlapping
  return Math.hypot(dx, dy);
}

const McpCommandModule = {
  __init__: ['mcpCommandHandler'],
  mcpCommandHandler: ['type', McpCommandHandler]
};

export default McpCommandModule;
