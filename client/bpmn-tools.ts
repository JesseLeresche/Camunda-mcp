/**
 * bpmn-js module that handles MCP commands against the bpmn-js modeling API.
 *
 * Instead of Electron IPC (which requires ipcRenderer access that may be
 * blocked by contextIsolation), this module exposes a global function
 * `window.__mcpDispatch` that the main process calls via
 * `webContents.executeJavaScript()`.
 */

import {
  type BpmnServices,
  resolveParent, getBoundaryPosition, findOrCreateRootElement, eventDefRefProps, getDefinitions,
  setZeebeTaskDefinition, setZeebeCalledElement, setMessageSubscription,
} from './element-shared';
import { buildProcess } from './layout/build-process';
import { layoutDiagramViaAutoLayout } from './layout/auto-layout';
import { validateLayout } from './validate-layout';

type DispatchFn = (tool: string, params: Record<string, unknown>) => Promise<any>;

interface DispatchRegistryEntry {
  container: HTMLElement;
  dispatch: DispatchFn;
}

declare global {
  interface Window {
    __mcpDispatch?: DispatchFn;
    __mcpDispatchRegistry?: DispatchRegistryEntry[];
  }
}

/**
 * Camunda Modeler keeps every previously-opened tab's bpmn-js instance
 * mounted (hidden, not destroyed) so undo history/scroll position survive
 * tab switches. That means registerBpmnJSPlugin's additional module runs
 * once per tab, ever — not once per tab focus — so a naive
 * `window.__mcpDispatch = ...` assignment gets permanently claimed by
 * whichever tab happened to be opened last, regardless of which tab the
 * user (or a diagramId param) actually intends to target. offsetParent is
 * null exactly when an element (or an ancestor) is display:none, which is
 * how Modeler hides inactive cached tabs — a cheap, reliable "is this tab
 * the one currently on screen" check with no cross-component wiring needed.
 */
function isContainerVisible(el: HTMLElement | null): boolean {
  return !!el && el.offsetParent !== null;
}

/**
 * Ensures the tab actually requested via diagramId is the one that ends up
 * visible before dispatch runs. Visibility alone (below) has no idea which
 * tab a caller *wants* — it only ever knows which one happens to be on
 * screen right now, which silently drifts whenever the user (or Modeler
 * itself) changes focus between an MCP client's calls. window.__mcpActiveTabId
 * (tab-manager.ts) is the one place that knows the real, current tab id, so
 * use it to detect a mismatch and switchTab() before falling through to the
 * visibility-based lookup. switchTab() can't activate an unsaved tab by
 * reference (no such Modeler action exists) — that case fails loudly here
 * instead of silently dispatching to whatever's on screen.
 */
async function ensureActiveTab(requestedId: string | undefined): Promise<{ error: string } | null> {
  if (!requestedId || requestedId === window.__mcpActiveTabId) return null;

  const tabManager = window.__mcpTabManager;
  if (!tabManager) {
    return { error: `Cannot verify diagramId "${requestedId}" is active — tab manager not initialized.` };
  }

  try {
    await tabManager.switchTab({ diagramId: requestedId });
  } catch (err: any) {
    return {
      error: `diagramId "${requestedId}" is not the active tab and could not be activated automatically `
        + `(${err.message || err}). This commonly happens for unsaved diagrams — Modeler has no action to `
        + 'activate an already-open tab by reference unless it has a saved file path. Switch to it manually '
        + 'in the Modeler UI, or save it first, then retry.',
    };
  }

  // switchTab's triggerAction resolves before the DOM/activeTabChanged
  // necessarily settles — poll briefly rather than assume it's immediate.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && window.__mcpActiveTabId !== requestedId) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

async function routeDispatch(tool: string, params: Record<string, unknown>): Promise<any> {
  const switchError = await ensureActiveTab(params.diagramId as string | undefined);
  if (switchError) {
    return {
      content: [{ type: 'text', text: JSON.stringify(switchError) }],
      isError: true,
    };
  }

  const registry = window.__mcpDispatchRegistry || [];
  const visible = registry.filter((entry) => isContainerVisible(entry.container));

  if (visible.length === 0) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'No visible/active BPMN diagram tab found in Modeler — open or focus a diagram tab.' }) }],
      isError: true,
    };
  }
  if (visible.length > 1) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `${visible.length} BPMN tabs appear visible simultaneously — cannot determine which is active.` }) }],
      isError: true,
    };
  }
  return visible[0].dispatch(tool, params);
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

  const entry: DispatchRegistryEntry = {
    container: canvas.getContainer(),
    dispatch: async (tool: string, params: Record<string, unknown>) => {
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
    },
  };

  window.__mcpDispatchRegistry = window.__mcpDispatchRegistry || [];
  window.__mcpDispatchRegistry.push(entry);
  window.__mcpDispatch = routeDispatch;

  // Tab close destroys this instance's bpmn-js Diagram — deregister so the
  // registry doesn't accumulate zombie entries for closed tabs.
  eventBus.on('diagram.destroy', () => {
    window.__mcpDispatchRegistry = (window.__mcpDispatchRegistry || []).filter((e) => e !== entry);
  });

  console.log('[camunda-mcp] Registered in dispatch registry, size:', window.__mcpDispatchRegistry.length);
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

export async function dispatchRendererTool(
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
      return layoutDiagramViaAutoLayout(params, services);
    case 'export_image':
      return exportImage(params, services);
    case 'set_execution_platform_version':
      return setExecutionPlatformVersion(params, services);
    case 'validate_diagram':
      return validateDiagram(params, services);
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
  let userTaskFormId = '';

  try {
    userTaskFormId = `userTaskForm_${bo.id}`;
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

  // formId must reference the embedded zeebe:UserTaskForm's own id (or the
  // deployed form's id, in the non-embedded case) — the compat linter
  // rejects `formKey` alone (`Element of type <zeebe:FormDefinition> must
  // have property <externalReference> or <formId>`), even though the moddle
  // schema still accepts it as a legacy attribute.
  const formDef = moddle.create('zeebe:FormDefinition', {
    formId: embedded ? userTaskFormId : formId,
  });
  taskExt.values.push(formDef);

  modeling.updateProperties(taskElement, { extensionElements: taskExt });

  return {
    taskId: bo.id, formId, mode: 'zeebe',
    embedded,
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

function addSubprocess(
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
    const messageBo = element.businessObject.messageRef;
    if (messageBo) {
      setMessageSubscription(moddle, messageBo, params.correlationKey as string);
    }
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

/**
 * Reads Camunda Modeler's own live linting service — the exact same data
 * backing the Problems panel — instead of reimplementing Camunda's
 * validation rules ourselves. `injector.get('linting')._reports` is an
 * internal, undocumented field (confirmed by direct inspection, not public
 * API), so this degrades gracefully if a future Modeler version renames or
 * restructures it.
 */
export async function validateDiagram(params: Record<string, unknown>, { injector }: BpmnServices) {
  const severityFilter = (params.severity as string) || 'all';

  let lintingSvc: any;
  try {
    lintingSvc = injector.get('linting', false);
  } catch {
    lintingSvc = null;
  }
  if (!lintingSvc) {
    return { issues: [], count: 0, warning: 'Linting service not available in this Modeler version — cannot report validation issues.' };
  }

  // _reports is a cache that only refreshes reactively off a
  // 'commandStack.changed' event — a bulk import_xml doesn't fire one (it
  // bypasses the command stack entirely, unlike incremental modeling.*
  // calls), so without a nudge _update() alone left stale reports (e.g. a
  // false "missing start event") sitting indefinitely, until something else
  // fired that event — clicking an element in the actual Modeler UI does it
  // (proven live). We fire the event ourselves, but linting's own reaction to
  // it isn't done by the time _update()'s first promise resolves — proven
  // live that even 30ms gaps between retries weren't enough, so this backs
  // off up to ~500ms total across a few retries before giving up and
  // returning whatever _reports currently holds.
  try {
    const eventBus = injector.get('eventBus', false);
    eventBus?.fire('commandStack.changed');
  } catch {
    // best-effort nudge — fall through to _update() regardless
  }
  const retryDelaysMs = [40, 80, 160, 220];
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      const maybePromise = lintingSvc._update?.();
      if (maybePromise && typeof maybePromise.then === 'function') {
        await maybePromise;
      }
    } catch {
      // fall back to whatever _reports currently holds
    }
    if (attempt < retryDelaysMs.length) {
      await new Promise<void>((r) => setTimeout(r, retryDelaysMs[attempt]));
    }
  }

  const reports: any[] = Array.isArray(lintingSvc._reports) ? lintingSvc._reports : [];
  const issues = reports
    .filter((r: any) => severityFilter === 'all' || r.category === severityFilter)
    .map((r: any) => ({
      elementId: r.id,
      elementName: r.name,
      message: r.message,
      severity: r.category,
      rule: r.rule,
      docsUrl: r.meta?.documentation?.url,
    }));

  return { issues, count: issues.length };
}

/* ------------------------------------------------------------------ */
/*  Phase 4 (v0.3) — Collaboration, Layout & Advanced Elements        */
/* ------------------------------------------------------------------ */

export function resizeElement(
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

export function moveElement(
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

/* ------------------------------------------------------------------ */
/*  v0.9 — Flow Waypoints, Bounds, Clone, Batch, Group               */
/* ------------------------------------------------------------------ */

export function setFlowWaypoints(
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

  let validation: Record<string, unknown>;
  try {
    validation = await validateDiagram({}, services);
  } catch (err: any) {
    validation = { issues: [], count: 0, warning: `Validation check failed: ${err.message}` };
  }

  return { results, validation };
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

/**
 * Sets or corrects the target Camunda 8 execution platform version on the
 * currently open diagram's bpmn:definitions. Needed because not every
 * diagram is created via create_model — one authored directly in Modeler and
 * only populated via MCP tools afterward carries no version stamp from this
 * plugin at all, and would otherwise silently keep whichever version
 * Modeler's own "New Diagram" default assigned it.
 */
// KNOWN LIMITATION: this mutates the bpmn:definitions moddle object directly
// (executionPlatform/executionPlatformVersion), and the mutation demonstrably
// lands on the exact object bpmnjs.getDefinitions() returns — confirmed via
// live readback — yet Modeler's exported/saved XML still shows the old
// version. The modeler: namespace attributes appear to be owned by Camunda
// Modeler's own app-level layer (outside bpmn-js/moddle's normal
// property-driven XML writer), similar to how tab-switching required
// Modeler's triggerAction API rather than direct DOM/state manipulation.
// No Modeler-level API for this has been found yet. See issue #3 for the
// full investigation writeup.
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

  return {
    executionPlatform: platform,
    executionPlatformVersion: version,
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
    'taskRetries', 'correlationKey', 'isExecutable',
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

const McpCommandModule = {
  __init__: ['mcpCommandHandler'],
  mcpCommandHandler: ['type', McpCommandHandler]
};

export default McpCommandModule;
