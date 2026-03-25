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
  injector: any
) {
  console.log('[camunda-mcp] McpCommandHandler initialized');

  window.__mcpDispatch = async (tool: string, params: Record<string, unknown>) => {
    console.log(`[camunda-mcp] Dispatch: ${tool}`, params);
    try {
      const rawResult = await dispatchRendererTool(tool, params, { modeling, elementRegistry, canvas, moddle, bpmnFactory, injector });
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

(McpCommandHandler as any).$inject = ['eventBus', 'modeling', 'elementRegistry', 'canvas', 'moddle', 'bpmnFactory', 'injector'];

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
    case '__debug_moddle':
      return debugModdle(services);
    default:
      throw new Error(`Unknown renderer tool: "${tool}"`);
  }
}

function addStartEvent(
  params: Record<string, unknown>,
  { modeling, canvas }: BpmnServices
) {
  const name = (params.name as string) || 'Start';
  const x = (params.x as number) || 200;
  const y = (params.y as number) || 200;

  const rootElement = canvas.getRootElement();
  if (!rootElement) {
    throw new Error('No diagram is currently open — cannot add elements');
  }

  const shape = modeling.createShape(
    { type: 'bpmn:StartEvent' },
    { x, y },
    rootElement
  );

  if (name) {
    modeling.updateLabel(shape, name);
  }

  return { elementId: shape.id, name, x: shape.x, y: shape.y };
}

function addTask(
  params: Record<string, unknown>,
  { modeling, canvas }: BpmnServices
) {
  const type = (params.type as string) || 'bpmn:Task';
  const name = (params.name as string) || '';
  const x = (params.x as number) || 400;
  const y = (params.y as number) || 200;

  const rootElement = canvas.getRootElement();
  if (!rootElement) {
    throw new Error('No diagram is currently open — cannot add elements');
  }

  const shape = modeling.createShape(
    { type },
    { x, y, width: 100, height: 80 },
    rootElement
  );

  if (name) {
    modeling.updateLabel(shape, name);
  }

  return { elementId: shape.id, type, name, x: shape.x, y: shape.y };
}

function addEndEvent(
  params: Record<string, unknown>,
  { modeling, canvas }: BpmnServices
) {
  const name = (params.name as string) || '';
  const x = (params.x as number) || 600;
  const y = (params.y as number) || 200;

  const rootElement = canvas.getRootElement();
  if (!rootElement) {
    throw new Error('No diagram is currently open — cannot add elements');
  }

  const shape = modeling.createShape(
    { type: 'bpmn:EndEvent' },
    { x, y },
    rootElement
  );

  if (name) {
    modeling.updateLabel(shape, name);
  }

  return { elementId: shape.id, name, x: shape.x, y: shape.y };
}

function connectElements(
  params: Record<string, unknown>,
  { modeling, elementRegistry }: BpmnServices
) {
  const sourceId = params.sourceId as string;
  const targetId = params.targetId as string;

  const source = elementRegistry.get(sourceId);
  if (!source) {
    throw new Error(`Source element "${sourceId}" not found`);
  }

  const target = elementRegistry.get(targetId);
  if (!target) {
    throw new Error(`Target element "${targetId}" not found`);
  }

  const connection = modeling.connect(source, target);

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
  { modeling, canvas }: BpmnServices
) {
  const type = (params.type as string) || 'bpmn:ExclusiveGateway';
  const name = (params.name as string) || '';
  const x = (params.x as number) || 400;
  const y = (params.y as number) || 200;

  const rootElement = canvas.getRootElement();
  if (!rootElement) throw new Error('No diagram is currently open — cannot add elements');

  const shape = modeling.createShape({ type }, { x, y }, rootElement);
  if (name) modeling.updateLabel(shape, name);

  return { elementId: shape.id, type, name, x: shape.x, y: shape.y };
}

function addEvent(
  params: Record<string, unknown>,
  { modeling, canvas, moddle, elementRegistry }: BpmnServices
) {
  const type = params.type as string;
  const eventDefType = (params.eventDefinitionType as string) || 'none';
  const name = (params.name as string) || '';
  const x = (params.x as number) || 400;
  const y = (params.y as number) || 200;
  const attachedToId = params.attachedToId as string | undefined;
  const cancelActivity = params.cancelActivity !== false;

  let parent;
  if (type === 'bpmn:BoundaryEvent') {
    if (!attachedToId) throw new Error('attachedToId is required for BoundaryEvent');
    parent = elementRegistry.get(attachedToId);
    if (!parent) throw new Error(`Host element "${attachedToId}" not found`);
  } else {
    parent = canvas.getRootElement();
    if (!parent) throw new Error('No diagram is currently open — cannot add elements');
  }

  const shapeAttrs: any = { type };
  if (type === 'bpmn:BoundaryEvent') shapeAttrs.cancelActivity = cancelActivity;

  const shape = modeling.createShape(
    shapeAttrs, { x, y }, parent,
    { attach: type === 'bpmn:BoundaryEvent' }
  );

  if (eventDefType !== 'none') {
    const eventDefProps: any = {};
    if (eventDefType === 'bpmn:TimerEventDefinition' && params.timerValue) {
      const timerType = (params.timerType as string) || 'timeDuration';
      const formalExpression = moddle.create('bpmn:FormalExpression', { body: params.timerValue as string });
      eventDefProps[timerType] = formalExpression;
    }
    const eventDef = moddle.create(eventDefType, eventDefProps);
    const bo = shape.businessObject;
    bo.eventDefinitions = bo.eventDefinitions || [];
    bo.eventDefinitions.push(eventDef);
    eventDef.$parent = bo;
    modeling.updateProperties(shape, { eventDefinitions: bo.eventDefinitions });
  }

  if (name) modeling.updateLabel(shape, name);

  return { elementId: shape.id, type, eventDefinitionType: eventDefType, name, x: shape.x, y: shape.y };
}

function addSubprocess(
  params: Record<string, unknown>,
  { modeling, canvas }: BpmnServices
) {
  const type = (params.type as string) || 'bpmn:SubProcess';
  const name = (params.name as string) || '';
  const x = (params.x as number) || 350;
  const y = (params.y as number) || 150;
  const width = (params.width as number) || 350;
  const height = (params.height as number) || 200;
  const collapsed = (params.collapsed as boolean) || false;
  const calledElement = params.calledElement as string | undefined;

  const rootElement = canvas.getRootElement();
  if (!rootElement) throw new Error('No diagram is currently open — cannot add elements');

  const shapeAttrs: any = { type };
  if (type === 'bpmn:SubProcess') shapeAttrs.isExpanded = !collapsed;

  const shape = modeling.createShape(shapeAttrs, { x, y, width, height }, rootElement);

  if (calledElement && type === 'bpmn:CallActivity') {
    modeling.updateProperties(shape, { calledElement });
  }
  if (name) modeling.updateLabel(shape, name);

  return { elementId: shape.id, type, name, x: shape.x, y: shape.y, width: shape.width, height: shape.height };
}

/* ------------------------------------------------------------------ */
/*  Phase 2 — Element Configuration                                    */
/* ------------------------------------------------------------------ */

function setProperties(params: Record<string, unknown>, { modeling, elementRegistry, moddle }: BpmnServices) {
  const elementId = params.elementId as string;
  const element = elementRegistry.get(elementId);
  if (!element) throw new Error(`Element "${elementId}" not found`);
  const bo = element.businessObject;

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
    let extElements = bo.extensionElements;
    if (!extElements) extElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    if (!extElements.values) extElements.values = [];
    extElements.values = extElements.values.filter((v: any) => v.$type !== 'zeebe:TaskDefinition');
    const taskDef = moddle.create('zeebe:TaskDefinition', {
      type: params.taskType as string, retries: (params.taskRetries as string) || '3',
    });
    extElements.values.push(taskDef);
    modeling.updateProperties(element, { extensionElements: extElements });
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
  const allElements = elementRegistry.getAll();

  const elements = allElements
    .filter((el: any) => {
      // Skip DI elements (diagram interchange — visual metadata only)
      if (el.type && (el.type.startsWith('bpmndi:') || el.type === 'label')) return false;
      // Apply type filter if specified
      if (typeFilter && !el.type?.startsWith(typeFilter)) return false;
      return true;
    })
    .map((el: any) => ({
      id: el.id,
      type: el.type,
      name: el.businessObject?.name || null,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
    }));

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
  { modeling, canvas, moddle }: BpmnServices
) {
  const eventDefType = (params.eventDefinitionType as string) || 'none';
  const name = (params.name as string) || '';
  const x = (params.x as number) || 600;
  const y = (params.y as number) || 200;

  const rootElement = canvas.getRootElement();
  if (!rootElement) throw new Error('No diagram is currently open');

  const shape = modeling.createShape({ type: 'bpmn:EndEvent' }, { x, y }, rootElement);

  if (eventDefType !== 'none') {
    const eventDef = moddle.create(eventDefType, {});
    const bo = shape.businessObject;
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

const McpCommandModule = {
  __init__: ['mcpCommandHandler'],
  mcpCommandHandler: ['type', McpCommandHandler]
};

export default McpCommandModule;
