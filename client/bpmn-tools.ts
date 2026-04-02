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
    const isExpanded = parent.isExpanded ?? bo.di?.isExpanded ?? false;
    if (!isExpanded) {
      throw new Error(`Parent subprocess "${parentId}" is collapsed — expand it first`);
    }
    return parent;
  }
  const root = canvas.getRootElement();
  if (!root) throw new Error('No diagram is currently open — cannot add elements');
  return root;
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
    case '__debug_moddle':
      return debugModdle(services);
    default:
      throw new Error(`Unknown renderer tool: "${tool}"`);
  }
}

function addStartEvent(
  params: Record<string, unknown>,
  { modeling, canvas, elementRegistry }: BpmnServices
) {
  const name = (params.name as string) || 'Start';
  const x = (params.x as number) || 200;
  const y = (params.y as number) || 200;
  const parentId = params.parentId as string | undefined;

  const parent = resolveParent(parentId, { elementRegistry, canvas });

  const shape = modeling.createShape(
    { type: 'bpmn:StartEvent' },
    { x, y },
    parent
  );

  if (name) {
    modeling.updateLabel(shape, name);
  }

  return { elementId: shape.id, name, x: shape.x, y: shape.y };
}

function addTask(
  params: Record<string, unknown>,
  { modeling, canvas, elementRegistry }: BpmnServices
) {
  const type = (params.type as string) || 'bpmn:Task';
  const name = (params.name as string) || '';
  const x = (params.x as number) || 400;
  const y = (params.y as number) || 200;
  const parentId = params.parentId as string | undefined;

  const parent = resolveParent(parentId, { elementRegistry, canvas });

  const shape = modeling.createShape(
    { type },
    { x, y, width: 100, height: 80 },
    parent
  );

  if (name) {
    modeling.updateLabel(shape, name);
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
  { modeling, elementRegistry }: BpmnServices
) {
  const sourceId = params.sourceId as string;
  const targetId = params.targetId as string;
  const waypoints = params.waypoints as Array<{ x: number; y: number }> | undefined;

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
  { modeling, canvas, moddle, elementRegistry }: BpmnServices
) {
  const eventDefType = (params.eventDefinitionType as string) || 'none';
  const name = (params.name as string) || '';
  const x = (params.x as number) || 600;
  const y = (params.y as number) || 200;
  const parentId = params.parentId as string | undefined;

  const parent = resolveParent(parentId, { elementRegistry, canvas });

  const shape = modeling.createShape({ type: 'bpmn:EndEvent' }, { x, y }, parent);

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

  // Use modeling.updateWaypoints if available, otherwise fall back to layoutConnection
  if (typeof modeling.updateWaypoints === 'function') {
    modeling.updateWaypoints(connection, newWaypoints);
  } else {
    // Direct update: set waypoints and notify diagram-js
    connection.waypoints = newWaypoints;
    // Update DI waypoints to persist in XML
    if (bo.di && bo.di.waypoint) {
      bo.di.waypoint = newWaypoints.map((wp: { x: number; y: number }) => {
        const point = bo.di.waypoint[0].$model.create('dc:Point', { x: wp.x, y: wp.y });
        return point;
      });
    }
    // Fire change event so the canvas re-renders
    const eventBus = (modeling as any)._eventBus || (modeling as any).eventBus;
    if (eventBus) {
      eventBus.fire('element.changed', { element: connection });
    }
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
    shapeAttrs.isExpanded = source.isExpanded ?? bo.di?.isExpanded ?? false;
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

async function batchOperations(
  params: Record<string, unknown>,
  services: BpmnServices
) {
  const operations = params.operations as Array<{ tool: string; params: Record<string, unknown> }>;
  const results: any[] = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];

    // Resolve $ref:N placeholders in params
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
  const { modeling, canvas, elementRegistry, moddle, bpmnFactory } = services;
  const elements = params.elements as any[];
  const flows = (params.flows as any[]) || [];
  const autoLayoutFlag = (params.autoLayout as boolean) || false;

  const root = canvas.getRootElement();
  if (!root) throw new Error('No diagram is currently open');

  const idMap: Record<string, string> = {};
  let nextX = DEFAULT_START_X;

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
      const eventDef = bpmnFactory.create(defType);
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
      shape = modeling.createShape(
        { type: 'bpmn:BoundaryEvent', host },
        { x, y },
        host.parent,
      );
      if (el.cancelActivity === false) {
        modeling.updateProperties(shape, { cancelActivity: false });
      }
      if (el.eventDefinitionType) {
        const bo = shape.businessObject;
        const eventDef = bpmnFactory.create(el.eventDefinitionType);
        eventDef.$parent = bo;
        bo.eventDefinitions = [eventDef];
      }

    // Handle intermediate events
    } else if (typeName === 'intermediateCatchEvent' || typeName === 'intermediateThrowEvent') {
      shape = modeling.createShape({ type: TYPE_MAP[typeName] }, { x, y }, parent);
      if (el.eventDefinitionType && el.eventDefinitionType !== 'none') {
        const bo = shape.businessObject;
        const eventDef = bpmnFactory.create(el.eventDefinitionType);
        eventDef.$parent = bo;
        bo.eventDefinitions = [eventDef];
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
      if (el.properties.taskType) {
        // Zeebe job type
        const hasZeebe = !!moddle.getPackage('zeebe');
        if (hasZeebe) {
          const bo = shape.businessObject;
          if (!bo.extensionElements) {
            bo.extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
            bo.extensionElements.$parent = bo;
          }
          const taskDef = moddle.create('zeebe:TaskDefinition', { type: el.properties.taskType, retries: el.properties.taskRetries || '3' });
          taskDef.$parent = bo.extensionElements;
          bo.extensionElements.values.push(taskDef);
        }
      }
      if (Object.keys(props).length > 0) {
        modeling.updateProperties(shape, props);
      }
    }

    idMap[logicalId] = shape.id;
    nextX = x + DEFAULT_SPACING_X;
  }

  // Phase 2: Create all flows
  const flowIds: string[] = [];
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

    flowIds.push(connection.id);
  }

  // Phase 3: Auto-layout if requested
  if (autoLayoutFlag && window.__mcpTabManager?.autoLayout) {
    try {
      await window.__mcpTabManager.autoLayout();
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

const McpCommandModule = {
  __init__: ['mcpCommandHandler'],
  mcpCommandHandler: ['type', McpCommandHandler]
};

export default McpCommandModule;
