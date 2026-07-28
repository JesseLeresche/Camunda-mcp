/**
 * bpmn-js module that handles MCP commands against the bpmn-js modeling API.
 *
 * Instead of Electron IPC (which requires ipcRenderer access that may be
 * blocked by contextIsolation), this module exposes a global function
 * `window.__mcpDispatch` that the main process calls via
 * `webContents.executeJavaScript()`.
 */

import { layoutProcess } from 'bpmn-auto-layout';

interface BpmnServices {
  modeling: any;
  elementRegistry: any;
  canvas: any;
  moddle: any;
  bpmnFactory: any;
  injector: any;
  commandStack: any;
}

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
 * Attaches (or replaces) a zeebe:CalledElement extension element on a
 * CallActivity. `modeling.updateProperties(shape, { calledElement })` sets
 * the native bpmn:CallActivity/@calledElement attribute, which Camunda 8
 * ignores — Zeebe resolves the target process from zeebe:CalledElement's
 * processId instead, so that attribute alone leaves the call activity
 * pointing nowhere despite looking configured.
 */
function setZeebeCalledElement(
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
function setMessageSubscription(
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
async function validateDiagram(params: Record<string, unknown>, { injector }: BpmnServices) {
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

/* ------------------------------------------------------------------ */
/*  build_process (bpmn-auto-layout pipeline)                         */
/* ------------------------------------------------------------------ */
//
// Builds a bare semantic moddle tree (no positions), merges it into the
// current diagram's existing content, runs bpmn-auto-layout, then imports
// the fully-laid-out result. Used when build_process is called with
// autoLayout:true. textAnnotation/group elements are split out before this
// runs (bpmn-auto-layout only understands flow nodes) and reapplied live
// afterward — see the split in buildProcess itself. Pools/lanes aren't
// creatable via this schema at all, so the only remaining fallback to the
// original incremental-createShape path is an existing collaboration
// (CollaborationUnsupportedError, thrown below).

/** Moddle-only zeebe:TaskDefinition setter — no live shape/modeling.updateProperties needed. */
function setZeebeTaskDefinitionOnBo(
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
function setZeebeCalledElementOnBo(
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
function buildElementBo(
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
function buildFlowBo(
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
function seedExpandedHints(
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

/* ------------------------------------------------------------------ */
/*  Phase 2 — post-processing pass (dedup, crossing router, labels)   */
/* ------------------------------------------------------------------ */
//
// bpmn-auto-layout's raw output has two known rough edges: (1) it can place
// several edges' segments exactly on top of each other for part of their
// route (e.g. two flows leaving the same gateway anchor and running
// parallel before diverging — confirmed live on the 29-element fixture:
// f3/f4 both ran the full length (225,95)->(225,280) collinear), and (2) it
// emits zero <bpmndi:BPMNLabel> elements at all, so bpmn-js falls back to
// its own default label placement at render time — which is what produced
// the confirmed mid-word wraps and label/line overlaps seen in live
// testing. These three passes run in this fixed order on the parsed DI,
// before import: dedup first (the router's segment math needs non-degenerate
// segments), router before labels (label collision-avoidance needs the
// final waypoints, not the pre-router ones).

const WAYPOINT_DEDUP_EPSILON = 0.5;
const CROSSING_LANE_SPACING = 20;
const LABEL_FONT_SIZE = 12;
const LABEL_LINE_HEIGHT = 14;
const LABEL_MAX_WIDTH = 100;
// New convention (BPMN-BEST-PRACTICES.md doesn't yet document a label/line
// clearance value — this establishes one rather than inventing an ad-hoc
// number silently).
const LABEL_CLEARANCE = 6;

/** Drops near-duplicate consecutive waypoints (within ~0.5px) — a duplicate point renders as a corner-rounding glitch/spike, and is degenerate input to the router below. */
export function dedupEdgeWaypoints(edges: any[]): void {
  for (const edge of edges) {
    const pts: any[] = edge.waypoint;
    if (!pts || pts.length <= 2) continue;
    const deduped = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = deduped[deduped.length - 1];
      if (Math.abs(pts[i].x - prev.x) < WAYPOINT_DEDUP_EPSILON && Math.abs(pts[i].y - prev.y) < WAYPOINT_DEDUP_EPSILON) {
        continue;
      }
      deduped.push(pts[i]);
    }
    if (deduped.length >= 2) edge.waypoint = deduped;
  }
}

interface SegRef { edge: any; index: number; }
interface ConflictGroup { axis: 'x' | 'y'; segs: SegRef[]; }

function range1d(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function anyPairOverlaps(segs: SegRef[], rangeAxis: 'x' | 'y'): boolean {
  const ranges = segs.map((s) => {
    const pts = s.edge.waypoint;
    return range1d(pts[s.index][rangeAxis], pts[s.index + 1][rangeAxis]);
  });
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (Math.max(ranges[i][0], ranges[j][0]) < Math.min(ranges[i][1], ranges[j][1])) return true;
    }
  }
  return false;
}

/** Finds groups of same-axis, same-coordinate, range-overlapping segments belonging to 2+ different edges. */
export function findConflictGroups(edges: any[]): ConflictGroup[] {
  const vGroups = new Map<number, SegRef[]>();
  const hGroups = new Map<number, SegRef[]>();

  for (const edge of edges) {
    const pts: any[] = edge.waypoint;
    if (!pts) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      if (dx < WAYPOINT_DEDUP_EPSILON && dy >= WAYPOINT_DEDUP_EPSILON) {
        const key = Math.round(a.x);
        if (!vGroups.has(key)) vGroups.set(key, []);
        vGroups.get(key)!.push({ edge, index: i });
      } else if (dy < WAYPOINT_DEDUP_EPSILON && dx >= WAYPOINT_DEDUP_EPSILON) {
        const key = Math.round(a.y);
        if (!hGroups.has(key)) hGroups.set(key, []);
        hGroups.get(key)!.push({ edge, index: i });
      }
    }
  }

  const result: ConflictGroup[] = [];
  for (const segs of vGroups.values()) {
    if (new Set(segs.map((s) => s.edge)).size < 2) continue;
    if (!anyPairOverlaps(segs, 'y')) continue;
    result.push({ axis: 'x', segs });
  }
  for (const segs of hGroups.values()) {
    if (new Set(segs.map((s) => s.edge)).size < 2) continue;
    if (!anyPairOverlaps(segs, 'x')) continue;
    result.push({ axis: 'y', segs });
  }
  return result;
}

/**
 * Shifts one conflicting segment by `offset` on its perpendicular axis
 * (`perp`). If the segment touches the edge's real source/target dock point
 * (waypoint[0] or the last waypoint — the actual connection to the shape),
 * that point is never moved; instead a short jog is inserted next to it so
 * the path detours into its new lane and back, keeping every segment
 * orthogonal and every dock connection exactly where it was.
 */
/**
 * Shifts one conflicting segment by `offset` on its perpendicular axis
 * (`perp`) — but only when BOTH endpoints are interior elbow points. A
 * segment touching the edge's real source/target dock point is left
 * untouched: resolving that case requires inserting a jog right next to the
 * dock, which live user testing confirmed reads as a rendering glitch (an
 * odd little hook right at the shape) rather than intentional routing, even
 * after widening the jog distance — worse than the overlap it was meant to
 * fix. Two flows briefly overlapping right at a shared gateway exit before
 * diverging is normal, broadly-accepted BPMN notation; left alone here by
 * deliberate choice, not an oversight.
 */
function shiftSegment(edge: any, i: number, perp: 'x' | 'y', offset: number): void {
  if (Math.abs(offset) < 0.01) return;
  const pts: any[] = edge.waypoint;
  const j = i + 1;
  if (i === 0 || j === pts.length - 1) return;
  pts[i][perp] += offset;
  pts[j][perp] += offset;
}

function applyGroupOffsets(group: ConflictGroup): void {
  const uniqueEdges = Array.from(new Set(group.segs.map((s) => s.edge)))
    .sort((a, b) => String(a.bpmnElement.id).localeCompare(String(b.bpmnElement.id)));
  const n = uniqueEdges.length;
  const offsetByEdge = new Map<any, number>();
  uniqueEdges.forEach((edge, k) => offsetByEdge.set(edge, (k - (n - 1) / 2) * CROSSING_LANE_SPACING));

  for (const seg of group.segs) {
    const offset = offsetByEdge.get(seg.edge)!;
    shiftSegment(seg.edge, seg.index, group.axis, offset);
  }
}

/**
 * Best-effort resolution of same-axis overlapping/coincident INTERIOR
 * segments (both endpoints are elbow points, neither is a real dock
 * connection) belonging to different edges — a clean, artifact-free parallel
 * offset, no new corners needed.
 *
 * Deliberately does NOT touch dock-anchored conflicts (a segment touching an
 * edge's actual source/target connection point) — live user testing
 * confirmed that inserting a jog next to a shared dock point reads as a
 * rendering glitch (an odd little hook right at the shape), even after
 * widening it, worse than the overlap it was meant to fix. Two flows briefly
 * overlapping right at a shared gateway exit before diverging is normal,
 * broadly-accepted BPMN notation — left alone by deliberate choice.
 *
 * Also does not attempt to resolve true perpendicular crossings — a much
 * harder routing problem, and not what was actually observed.
 */
export function routeAwayOverlaps(edges: any[]): void {
  const groups = findConflictGroups(edges);
  const mutated = new Set<any>();
  for (const group of groups) {
    const segs = group.segs.filter((s) => !mutated.has(s.edge));
    if (new Set(segs.map((s) => s.edge)).size < 2) continue;
    applyGroupOffsets({ axis: group.axis, segs });
    for (const s of segs) mutated.add(s.edge);
  }
}

/** Real Canvas text measurement in the renderer; a deterministic per-character estimate when no `document` exists (vitest's default Node environment) — same font-size assumption either way, just not pixel-exact in tests. */
function measureTextWidth(text: string, fontSize: number): number {
  if (typeof document === 'undefined') return text.length * fontSize * 0.55;
  const w = measureTextWidth as any;
  if (!w._canvas) w._canvas = document.createElement('canvas');
  const ctx = w._canvas.getContext('2d');
  ctx.font = `${fontSize}px Arial, sans-serif`;
  return ctx.measureText(text).width;
}

/** Wraps text to maxWidth using real measured widths, breaking only at word boundaries — the previous character-count heuristic was the confirmed root cause of mid-word wraps. */
export function wrapLabelText(text: string, maxWidth: number, fontSize: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (measureTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function labelRectFor(lines: string[], centerX: number, top: number): Rect {
  const width = Math.min(LABEL_MAX_WIDTH, Math.max(...lines.map((l) => measureTextWidth(l, LABEL_FONT_SIZE))) + 4);
  const height = lines.length * LABEL_LINE_HEIGHT;
  return { x: centerX - width / 2, y: top, width, height };
}

/** Picks the first candidate rect that doesn't intersect any edge segment; falls back to the first (default) candidate if none are clear — best-effort, not exhaustive search. */
function pickClearRect(candidates: Rect[], edges: any[], extraObstacles: Rect[] = []): Rect {
  for (const rect of candidates) {
    let hits = extraObstacles.some((o) => rectsOverlap(rect, o));
    for (const edge of edges) {
      if (hits) break;
      const pts: any[] = edge.waypoint;
      for (let i = 0; i < pts.length - 1 && !hits; i++) {
        if (segmentIntersectsRect(pts[i], pts[i + 1], rect, 0)) hits = true;
      }
    }
    if (!hits) return rect;
  }
  return candidates[0];
}

const EXTERNAL_LABEL_TYPES = /Event$|Gateway$/;

type Side = 'top' | 'bottom' | 'left' | 'right';
const SIDE_PREFERENCE: Side[] = ['bottom', 'top', 'right', 'left'];

function sideFromDelta(dx: number, dy: number): Side {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

/** Which cardinal sides of a shape already have a connected edge touching them. */
function getTakenSides(shapeId: string, edges: any[]): Set<Side> {
  const taken = new Set<Side>();
  for (const edge of edges) {
    const bo = edge.bpmnElement;
    const pts: any[] = edge.waypoint;
    if (!pts || pts.length < 2) continue;
    if (bo.sourceRef?.id === shapeId) {
      taken.add(sideFromDelta(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
    }
    if (bo.targetRef?.id === shapeId) {
      const n = pts.length;
      taken.add(sideFromDelta(pts[n - 2].x - pts[n - 1].x, pts[n - 2].y - pts[n - 1].y));
    }
  }
  return taken;
}

/** For a boundary event, the side facing its host shape — that side isn't "taken" by a connector, but placing a label there lands it inside/overlapping the host box, which is just as wrong. */
function hostFacingSide(shape: any, shapes: any[]): Side | undefined {
  const hostRef = shape.bpmnElement.attachedToRef;
  if (!hostRef) return undefined;
  const host = shapes.find((s: any) => s.bpmnElement.id === hostRef.id);
  if (!host) return undefined;
  const b = shape.bounds, h = host.bounds;
  const shapeMidX = b.x + b.width / 2, shapeMidY = b.y + b.height / 2;
  const hostMidX = h.x + h.width / 2, hostMidY = h.y + h.height / 2;
  return sideFromDelta(hostMidX - shapeMidX, hostMidY - shapeMidY);
}

/** First side (in preference order) with no connected edge and no host shape in the way; falls back to the preferred default if every side is unusable — best-effort, not silently broken. */
function pickLabelSide(shapeId: string, edges: any[], excludeSide?: Side): Side {
  const taken = getTakenSides(shapeId, edges);
  if (excludeSide) taken.add(excludeSide);
  for (const side of SIDE_PREFERENCE) {
    if (!taken.has(side)) return side;
  }
  return SIDE_PREFERENCE[0];
}

function labelRectForSide(side: Side, b: Rect, lines: string[]): Rect {
  const width = Math.min(LABEL_MAX_WIDTH, Math.max(...lines.map((l) => measureTextWidth(l, LABEL_FONT_SIZE))) + 4);
  const height = lines.length * LABEL_LINE_HEIGHT;
  switch (side) {
    case 'bottom': return { x: b.x + b.width / 2 - width / 2, y: b.y + b.height + LABEL_CLEARANCE, width, height };
    case 'top': return { x: b.x + b.width / 2 - width / 2, y: b.y - LABEL_CLEARANCE - height, width, height };
    case 'right': return { x: b.x + b.width + LABEL_CLEARANCE, y: b.y + b.height / 2 - height / 2, width, height };
    case 'left': return { x: b.x - LABEL_CLEARANCE - width, y: b.y + b.height / 2 - height / 2, width, height };
  }
}

/** Secondary nudge candidates along the chosen side, for a final micro-adjustment if the primary position still collides with something. */
function nudgeCandidates(base: Rect, side: Side): Rect[] {
  if (side === 'bottom' || side === 'top') {
    return [base, { ...base, x: base.x - base.width - LABEL_CLEARANCE }, { ...base, x: base.x + base.width + LABEL_CLEARANCE }];
  }
  return [base, { ...base, y: base.y - base.height - LABEL_CLEARANCE }, { ...base, y: base.y + base.height + LABEL_CLEARANCE }];
}

/** Index of the longest segment in an edge's waypoints — used as the representative segment for label placement so a tiny stub/jog segment is never picked over a genuinely long, visually central one. */
function longestSegmentIndex(pts: any[]): number {
  let bestIdx = 0, bestLen = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.abs(pts[i].x - pts[i + 1].x) + Math.abs(pts[i].y - pts[i + 1].y);
    if (len > bestLen) { bestLen = len; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * Authors `bpmndi:BPMNLabel` elements from scratch — bpmn-auto-layout emits
 * none at all, so without this bpmn-js falls back to its own default
 * placement, which produced the confirmed mid-word wraps and label/line
 * overlaps. Task-family shapes render their name inline within the shape
 * bounds by default and are deliberately left alone here.
 */
export function authorLabels(shapes: any[], edges: any[], moddle: any): void {
  for (const shape of shapes) {
    const bo = shape.bpmnElement;
    if (!bo?.name || !EXTERNAL_LABEL_TYPES.test(bo.$type)) continue;
    const b = shape.bounds;
    const lines = wrapLabelText(bo.name, LABEL_MAX_WIDTH, LABEL_FONT_SIZE);
    const host = bo.attachedToRef ? shapes.find((s: any) => s.bpmnElement.id === bo.attachedToRef.id) : undefined;
    const side = pickLabelSide(bo.id, edges, hostFacingSide(shape, shapes));
    const base = labelRectForSide(side, b, lines);
    const rect = pickClearRect(nudgeCandidates(base, side), edges, host ? [{ x: host.bounds.x, y: host.bounds.y, width: host.bounds.width, height: host.bounds.height }] : []);

    const bounds = moddle.create('dc:Bounds', rect);
    const label = moddle.create('bpmndi:BPMNLabel', { bounds });
    bounds.$parent = label;
    label.$parent = shape;
    shape.label = label;
  }

  for (const edge of edges) {
    const bo = edge.bpmnElement;
    if (!bo?.name) continue;
    const pts: any[] = edge.waypoint;
    const mid = longestSegmentIndex(pts);
    const a = pts[mid], b = pts[mid + 1];
    const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
    const horizontal = Math.abs(a.y - b.y) < WAYPOINT_DEDUP_EPSILON;

    const lines = wrapLabelText(bo.name, LABEL_MAX_WIDTH, LABEL_FONT_SIZE);
    let base: Rect;
    let candidates: Rect[];
    if (horizontal) {
      base = labelRectFor(lines, midX, midY - LABEL_CLEARANCE - lines.length * LABEL_LINE_HEIGHT);
      candidates = [base, { ...base, y: midY + LABEL_CLEARANCE }];
    } else {
      base = labelRectFor(lines, midX + LABEL_CLEARANCE + Math.max(...lines.map((l) => measureTextWidth(l, LABEL_FONT_SIZE))) / 2, midY - (lines.length * LABEL_LINE_HEIGHT) / 2);
      candidates = [base, { ...base, x: base.x - 2 * (base.x - midX) - base.width }];
    }
    const rect = pickClearRect(candidates, edges);

    const bounds = moddle.create('dc:Bounds', rect);
    const label = moddle.create('bpmndi:BPMNLabel', { bounds });
    bounds.$parent = label;
    label.$parent = edge;
    edge.label = label;
  }
}

/** Runs the full Phase 2 pass on parsed (post-layoutProcess) DI, in the required order. */
export function postProcessLayout(shapes: any[], edges: any[], moddle: any): void {
  dedupEdgeWaypoints(edges);
  routeAwayOverlaps(edges);
  authorLabels(shapes, edges, moddle);
}

/** Parses layoutProcess's raw XML, runs the Phase 2 pass, and re-serializes — shared by both call sites. */
async function applyPostProcessing(rawLaidOutXml: string, moddle: any): Promise<string> {
  const { rootElement: laidOutDefs } = await moddle.fromXML(rawLaidOutXml);
  const planeElements: any[] = laidOutDefs.diagrams?.[0]?.plane?.planeElement || [];
  const shapes = planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNShape');
  const edges = planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNEdge');
  postProcessLayout(shapes, edges, moddle);
  const { xml } = await moddle.toXML(laidOutDefs, { format: false });
  return xml;
}

/* ------------------------------------------------------------------ */
/*  Phase 3 — pool/lane/annotation/group composition layer            */
/* ------------------------------------------------------------------ */
//
// bpmn-auto-layout can't touch collaborations, lanes, annotations, or
// groups at all (confirmed by reading its source — getProcess() is a
// first-bpmn:Process-only lookup, laneSets/artifacts are never referenced).
// This layer works around that by never handing it anything it can't
// support: extract everything it doesn't understand, lay out each
// participant's flow-node core independently (the thing it's actually
// good at), then reassemble the pool/lane/annotation/group structure
// around the result using plain bbox math and live modeling.* calls —
// no attempt to re-route edges or shift individual nodes to resolve lane
// conflicts, since that's a much harder problem than this layer needs to
// solve (see the interleaving note below).

interface ParticipantCore {
  participantId: string | null; // null when there's no bpmn:Collaboration wrapper
  participantName?: string;
  processBo: any;
  laneInfos: { id: string; name?: string; memberIds: string[] }[];
}

interface ExtractedComposition {
  hadCollaboration: boolean;
  collaborationId?: string;
  participants: ParticipantCore[];
  messageFlows: { id: string; name?: string; sourceId: string; targetId: string }[];
  annotations: { id: string; text: string; x: number; y: number; width: number; height: number; associatedIds: string[] }[];
  groups: { id: string; name?: string; x: number; y: number; width: number; height: number }[];
}

/**
 * Pulls every collaboration/lane/annotation/group/message-flow out of a
 * parsed diagram, leaving each participant's `processBo` holding only its
 * flow nodes and sequence flows — the one thing `layoutProcess` can
 * actually handle. Lane membership is read directly from each `bpmn:Lane`'s
 * existing `flowNodeRef` array (already the authoritative membership list —
 * no need to infer it from geometry).
 */
export function extractComposition(definitions: any): ExtractedComposition {
  const collaboration = definitions.rootElements?.find((el: any) => el.$type === 'bpmn:Collaboration') || null;
  const participants: ParticipantCore[] = [];
  const messageFlows: ExtractedComposition['messageFlows'] = [];
  const annotations: ExtractedComposition['annotations'] = [];
  const groups: ExtractedComposition['groups'] = [];

  const plane = definitions.diagrams?.[0]?.plane;
  const shapeById = new Map<string, any>();
  for (const pe of plane?.planeElement || []) {
    if (pe.$type === 'bpmndi:BPMNShape' && pe.bpmnElement) shapeById.set(pe.bpmnElement.id, pe);
  }

  const sources = collaboration
    ? collaboration.participants.map((p: any) => ({ participantBo: p, processBo: p.processRef }))
    : [{ participantBo: null, processBo: definitions.rootElements.find((el: any) => el.$type === 'bpmn:Process') }];

  const collectArtifact = (fe: any) => {
    if (fe.$type === 'bpmn:TextAnnotation') {
      const shape = shapeById.get(fe.id);
      annotations.push({
        id: fe.id, text: fe.text || '',
        x: shape?.bounds?.x ?? 100, y: shape?.bounds?.y ?? 100,
        width: shape?.bounds?.width ?? 100, height: shape?.bounds?.height ?? 80,
        associatedIds: [],
      });
      return true;
    }
    if (fe.$type === 'bpmn:Group') {
      const shape = shapeById.get(fe.id);
      groups.push({
        id: fe.id, name: fe.categoryValueRef?.value,
        x: shape?.bounds?.x ?? 100, y: shape?.bounds?.y ?? 100,
        width: shape?.bounds?.width ?? 300, height: shape?.bounds?.height ?? 200,
      });
      return true;
    }
    if (fe.$type === 'bpmn:Association') {
      const sourceId = fe.sourceRef?.id, targetId = fe.targetRef?.id;
      const ann = annotations.find((a) => a.id === sourceId || a.id === targetId);
      if (ann) {
        const otherId = ann.id === sourceId ? targetId : sourceId;
        if (otherId) ann.associatedIds.push(otherId);
      }
      return true;
    }
    return false;
  };

  for (const { participantBo, processBo } of sources) {
    if (!processBo) continue;

    const laneInfos: ParticipantCore['laneInfos'] = [];
    for (const laneSet of processBo.laneSets || []) {
      for (const lane of laneSet.lanes || []) {
        laneInfos.push({ id: lane.id, name: lane.name, memberIds: (lane.flowNodeRef || []).map((ref: any) => ref.id) });
      }
    }

    const kept: any[] = [];
    for (const fe of processBo.flowElements || []) {
      if (!collectArtifact(fe)) kept.push(fe);
    }
    processBo.flowElements = kept;
    processBo.laneSets = [];

    participants.push({ participantId: participantBo?.id ?? null, participantName: participantBo?.name, processBo, laneInfos });
  }

  for (const mf of collaboration?.messageFlows || []) {
    messageFlows.push({ id: mf.id, name: mf.name, sourceId: mf.sourceRef?.id, targetId: mf.targetRef?.id });
  }
  for (const art of collaboration?.artifacts || []) collectArtifact(art);

  return { hadCollaboration: !!collaboration, collaborationId: collaboration?.id, participants, messageFlows, annotations, groups };
}

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

/** Pure translation — always safe (preserves every segment's orthogonality and every shape's size) unlike shifting nodes relative to each other. */
function translateShapesAndEdges(shapes: any[], edges: any[], dx: number, dy: number): void {
  for (const s of shapes) {
    s.bounds.x += dx; s.bounds.y += dy;
    if (s.label?.bounds) { s.label.bounds.x += dx; s.label.bounds.y += dy; }
  }
  for (const e of edges) {
    for (const p of e.waypoint) { p.x += dx; p.y += dy; }
    if (e.label?.bounds) { e.label.bounds.x += dx; e.label.bounds.y += dy; }
  }
}

const POOL_PADDING = 30;
const POOL_LABEL_BAND = 30;
const LANE_PADDING = 20;
const STACK_GAP = 60;

/**
 * How far `originalPool` could grow in each direction before colliding with
 * any of `originalSiblings`, plus `minGap` — #14. Takes each pool's
 * *original* (pre-growth) rect rather than its current one: once a pool has
 * already grown into an overlap, "is this sibling entirely above me" can go
 * ambiguous against the current (already-overlapping) bounds, but is always
 * well-defined against where things stood before anything grew. General 2D
 * collision, not a hardcoded "pools always stack vertically" assumption — a
 * sibling only constrains a direction when its range overlaps the pool's
 * range on the *other* axis (e.g. a sibling purely above only limits upward
 * growth if their X ranges overlap too).
 */
export function computeGrowthEnvelope(
  originalPool: Rect,
  originalSiblings: Rect[],
  minGap: number = POOL_PADDING,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = -Infinity, minY = -Infinity, maxX = Infinity, maxY = Infinity;
  const pTop = originalPool.y, pBottom = originalPool.y + originalPool.height;
  const pLeft = originalPool.x, pRight = originalPool.x + originalPool.width;
  for (const s of originalSiblings) {
    const sTop = s.y, sBottom = s.y + s.height, sLeft = s.x, sRight = s.x + s.width;
    const xOverlap = pLeft < sRight && pRight > sLeft;
    const yOverlap = pTop < sBottom && pBottom > sTop;
    if (xOverlap) {
      if (sBottom <= pTop) minY = Math.max(minY, sBottom + minGap);
      if (sTop >= pBottom) maxY = Math.min(maxY, sTop - minGap);
    }
    if (yOverlap) {
      if (sRight <= pLeft) minX = Math.max(minX, sRight + minGap);
      if (sLeft >= pRight) maxX = Math.min(maxX, sLeft - minGap);
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Recursively collects every real shape/connection inside `container` via
 * diagram-js's `.children` tree (the same containment relationship already
 * relied on via `.parent` walks elsewhere in this file, just inverted) —
 * used to check whether a pool's actual content still fits inside a
 * candidate clamped boundary (#14). Works against plain fake objects
 * (`{x,y,width,height,type,children}`) too, no live elementRegistry needed,
 * so it's unit-testable the same way as this file's other pure helpers.
 */
export function collectDescendantShapes(container: any): any[] {
  const result: any[] = [];
  for (const child of container.children || []) {
    if (child.x !== undefined && child.type !== 'label') result.push(child);
    if (child.children?.length) result.push(...collectDescendantShapes(child));
  }
  return result;
}

/**
 * Lays out each participant's flow-node core independently via the normal
 * Phase 1 + Phase 2 pipeline, stacks the results vertically (pure
 * translation per participant — never touches individual node positions
 * relative to each other, so orthogonality and validity are guaranteed),
 * and rebuilds pool/lane DI around the translated positions.
 *
 * Lane bounds are computed from each lane's actual post-layout member
 * positions and stacked in declaration order. `layoutProcess` has zero lane
 * awareness, so it can legitimately interleave two lanes' members in Y —
 * when that happens, a clean non-overlapping stack isn't achievable without
 * either re-routing edges or moving nodes independently of the graph
 * layout, both of which risk corrupting a result that's otherwise fully
 * correct. Rather than attempt that, this detects the conflict, still draws
 * each lane's bounds around its own members (bands may overlap in that
 * case), and reports it via `warnings` — mirrors `validateLayout`'s
 * existing "detect and report" philosophy for `subprocess_too_small`.
 *
 * Message flows, annotations, groups, and associations are deliberately
 * NOT rebuilt here — they get reapplied after import via the existing live
 * `addMessageFlow`/`addAnnotation`/`addGroup` modeling calls, which compute
 * their own correct DI, rather than hand-building connection routing here.
 */
interface LaneBand {
  memberIds: string[];
  y: number;
  height: number;
}

export async function composePoolsAndLanes(
  extracted: ExtractedComposition,
  services: BpmnServices,
): Promise<{ xml: string; warnings: string[]; laneBands: LaneBand[] }> {
  const { moddle, elementRegistry } = services;
  const warnings: string[] = [];
  const laneBands: LaneBand[] = [];

  const definitions = moddle.create('bpmn:Definitions', {
    id: 'Definitions_composed', targetNamespace: 'http://bpmn.io/schema/bpmn', rootElements: [],
  });

  let collaboration: any = null;
  if (extracted.hadCollaboration) {
    collaboration = moddle.create('bpmn:Collaboration', { id: extracted.collaborationId || 'Collaboration_composed', participants: [], messageFlows: [] });
    collaboration.$parent = definitions;
    definitions.rootElements.push(collaboration);
  }

  const plane = moddle.create('bpmndi:BPMNPlane', { planeElement: [] });
  const diagram = moddle.create('bpmndi:BPMNDiagram', { plane });
  plane.$parent = diagram;
  diagram.$parent = definitions;
  definitions.diagrams = [diagram];

  const allExpandedIds = collectExpandedSubprocessIds(elementRegistry);
  let stackY = 0;
  let firstLaidOutProcess: any = null;

  for (const participant of extracted.participants) {
    const tempDefs = moddle.create('bpmn:Definitions', { id: `Definitions_tmp_${participant.processBo.id}`, targetNamespace: 'http://bpmn.io/schema/bpmn', rootElements: [participant.processBo] });
    participant.processBo.$parent = tempDefs;

    const expandedBos: any[] = [];
    for (const id of allExpandedIds) {
      const bo = findFlowElementById(participant.processBo, id);
      if (bo) expandedBos.push(bo);
    }
    seedExpandedHints(moddle, tempDefs, participant.processBo, expandedBos);

    const { xml: tempXml } = await moddle.toXML(tempDefs, { format: false });
    const rawLaidOutXml = await layoutProcess(tempXml);
    const postXml = await applyPostProcessing(rawLaidOutXml, moddle);
    const { rootElement: laidOutDefs } = await moddle.fromXML(postXml);
    const laidOutProcess = laidOutDefs.rootElements.find((el: any) => el.$type === 'bpmn:Process');
    const laidOutPlaneElements: any[] = laidOutDefs.diagrams[0].plane.planeElement;
    const shapes = laidOutPlaneElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNShape');
    const edges = laidOutPlaneElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNEdge');

    if (!firstLaidOutProcess) firstLaidOutProcess = laidOutProcess;

    const bbox = bboxOfShapes(shapes);
    const marginX = POOL_PADDING + (extracted.hadCollaboration ? POOL_LABEL_BAND : 0);
    const dx = -bbox.x + marginX;
    const dy = -bbox.y + stackY + POOL_PADDING;
    translateShapesAndEdges(shapes, edges, dx, dy);
    for (const s of shapes) plane.planeElement.push(s);
    for (const e of edges) plane.planeElement.push(e);
    const contentRect: Rect = { x: bbox.x + dx, y: bbox.y + dy, width: bbox.width, height: bbox.height };

    const shapeById = new Map<string, any>(shapes.map((s: any) => [s.bpmnElement.id, s]));
    let contentBottom = contentRect.y + contentRect.height + POOL_PADDING;

    if (participant.laneInfos.length > 0) {
      const laneSet = moddle.create('bpmn:LaneSet', { id: `LaneSet_${participant.processBo.id}`, lanes: [] });
      laneSet.$parent = laidOutProcess;
      laidOutProcess.laneSets = [laneSet];

      const laneEntries = participant.laneInfos.map((laneInfo) => {
        const memberShapes = laneInfo.memberIds.map((id) => shapeById.get(id)).filter(Boolean);
        const rect = memberShapes.length > 0 ? bboxOfShapes(memberShapes) : { x: contentRect.x, y: contentRect.y, width: contentRect.width, height: 80 };
        const memberBos = laneInfo.memberIds.map((id) => findFlowElementById(laidOutProcess, id)).filter(Boolean);
        return { laneInfo, rect, memberBos };
      });

      let interleaved = false;
      for (let i = 1; i < laneEntries.length; i++) {
        if (laneEntries[i].rect.y < laneEntries[i - 1].rect.y + laneEntries[i - 1].rect.height) { interleaved = true; break; }
      }
      if (interleaved) {
        warnings.push(
          `Lanes in participant "${participant.participantName || participant.participantId || participant.processBo.id}" were interleaved by bpmn-auto-layout's lane-unaware layout and have been repositioned into their correct bands (moving the affected elements and re-routing their connections); worth a visual check since it's a best-effort correction, not a lane-aware re-layout.`,
        );
      }

      const laneMinX = contentRect.x - LANE_PADDING;
      const laneWidth = contentRect.width + LANE_PADDING * 2;
      let laneY = contentRect.y - LANE_PADDING;
      for (const { laneInfo, rect, memberBos } of laneEntries) {
        const lane = moddle.create('bpmn:Lane', { id: laneInfo.id, name: laneInfo.name, flowNodeRef: memberBos });
        lane.$parent = laneSet;
        laneSet.lanes.push(lane);
        const laneHeight = rect.height + LANE_PADDING * 2;
        const laneBounds = moddle.create('dc:Bounds', { x: laneMinX, y: laneY, width: laneWidth, height: laneHeight });
        const laneShape = moddle.create('bpmndi:BPMNShape', { id: `${lane.id}_di`, bpmnElement: lane, bounds: laneBounds, isHorizontal: true });
        laneBounds.$parent = laneShape; laneShape.$parent = plane;
        plane.planeElement.unshift(laneShape); // lanes render behind flow nodes
        laneBands.push({ memberIds: laneInfo.memberIds, y: laneY, height: laneHeight });
        laneY += laneHeight;
      }
      contentBottom = laneY + POOL_PADDING;
    }

    laidOutProcess.$parent = definitions;
    definitions.rootElements.push(laidOutProcess);

    if (extracted.hadCollaboration) {
      const participantBo = moddle.create('bpmn:Participant', { id: participant.participantId!, name: participant.participantName, processRef: laidOutProcess });
      participantBo.$parent = collaboration;
      collaboration.participants.push(participantBo);

      const poolBounds = moddle.create('dc:Bounds', {
        x: contentRect.x - POOL_PADDING - POOL_LABEL_BAND, y: contentRect.y - POOL_PADDING,
        width: contentRect.width + POOL_PADDING * 2 + POOL_LABEL_BAND, height: contentBottom - (contentRect.y - POOL_PADDING),
      });
      const poolShape = moddle.create('bpmndi:BPMNShape', { id: `${participantBo.id}_di`, bpmnElement: participantBo, bounds: poolBounds, isHorizontal: true });
      poolBounds.$parent = poolShape; poolShape.$parent = plane;
      plane.planeElement.unshift(poolShape); // pool renders behind everything inside it

      stackY = contentBottom + STACK_GAP;
    } else {
      stackY = contentBottom + STACK_GAP;
    }
  }

  plane.bpmnElement = extracted.hadCollaboration ? collaboration : firstLaidOutProcess;

  // Place annotations/groups in a dedicated notes area below all pools,
  // rather than trying to preserve their original coordinates — confirmed
  // live that keeping the original position let a group sized/placed
  // relative to the *old* layout overlap or overhang past a pool whose
  // final bounds came out a different shape. A fixed area below everything
  // is never at risk of colliding with pool/lane content, at the cost of
  // not staying visually "attached" to whatever it originally annotated.
  const notesX0 = extracted.hadCollaboration ? POOL_LABEL_BAND : 0;
  let noteX = notesX0;
  const noteY = stackY;
  for (const ann of extracted.annotations) {
    ann.x = noteX;
    ann.y = noteY;
    noteX += ann.width + POOL_PADDING;
  }
  let groupY = noteY;
  if (extracted.annotations.length > 0) {
    groupY += Math.max(...extracted.annotations.map((a) => a.height)) + POOL_PADDING;
  }
  noteX = notesX0;
  for (const grp of extracted.groups) {
    grp.x = noteX;
    grp.y = groupY;
    noteX += grp.width + POOL_PADDING;
  }

  const { xml } = await moddle.toXML(definitions, { format: false });
  return { xml, warnings, laneBands };
}

/**
 * Reapplies message flows, annotations, groups, and their associations
 * after import — live `modeling.*` calls compute correct DI/routing
 * themselves, so there's no need to hand-build any of it pre-import.
 * Elements keep their original ids through the moddle round-trip, so
 * `elementRegistry.get(originalId)` reliably finds the right live shape.
 */
async function reapplyArtifacts(extracted: ExtractedComposition, services: BpmnServices): Promise<void> {
  for (const mf of extracted.messageFlows) {
    try {
      addMessageFlow({ sourceId: mf.sourceId, targetId: mf.targetId, name: mf.name }, services);
    } catch {
      // best-effort — a message flow whose endpoints no longer resolve is skipped, not fatal
    }
  }
  const { elementRegistry, modeling } = services;
  for (const ann of extracted.annotations) {
    try {
      const [firstTarget, ...rest] = ann.associatedIds;
      // Prefer placing it right below its associated element's actual
      // final position (post lane-correction) instead of the shared notes
      // area — confirmed live that using the notes area for an annotation
      // WITH an association produced a valid but visually absurd result: a
      // single Association line stretching diagonally across the entire
      // diagram to reach it. Below (not beside/above) is deliberate: the
      // row directly below a flow element is far more likely to be open
      // space than left/right (which risk colliding with the next element
      // in sequence) or above (which risks escaping past the lane/pool's
      // own top edge for elements sitting near it, as "Review Request"
      // does here). Orphan annotations with no association keep the
      // notes-area fallback position computed in composePoolsAndLanes,
      // since they have no natural anchor to place near.
      let x = ann.x, y = ann.y;
      const targetShape = firstTarget ? elementRegistry.get(firstTarget) : null;
      if (targetShape) {
        x = targetShape.x;
        y = targetShape.y + targetShape.height + POOL_PADDING;
      }
      const result = addAnnotation({ text: ann.text, x, y, attachToId: firstTarget }, services) as any;
      const annotationShape = elementRegistry.get(result.elementId);
      for (const targetId of rest) {
        const target = elementRegistry.get(targetId);
        if (annotationShape && target) modeling.connect(annotationShape, target, { type: 'bpmn:Association' });
      }
    } catch {
      // best-effort
    }
  }
  for (const grp of extracted.groups) {
    try {
      addGroup({ name: grp.name, x: grp.x, y: grp.y, width: grp.width, height: grp.height }, services);
    } catch {
      // best-effort
    }
  }
}

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

/** All ids of currently-expanded subprocesses on the live canvas, using the same isExpanded check `validateLayout` uses. */
function collectExpandedSubprocessIds(elementRegistry: any): Set<string> {
  const ids = new Set<string>();
  for (const el of elementRegistry.getAll()) {
    if (el.type !== 'bpmn:SubProcess') continue;
    const isExpanded = (el as any).isExpanded ?? (el as any).di?.isExpanded ?? false;
    if (isExpanded) ids.add(el.id);
  }
  return ids;
}

/** Recursively finds a flowElement by id, descending into subprocesses. */
function findFlowElementById(container: any, id: string): any {
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

/**
 * Walks up from `elementId` to its nearest `bpmn:Participant` (pool)
 * ancestor and, if that pool's current bounds now extend past the safe
 * envelope relative to sibling pools' *original* positions, clamps it back
 * — but only when the pool's own actual content still fits inside the
 * clamped bounds. Never touches a sibling pool, only ever shrinks the
 * growing one, so a single pass can't introduce a new overlap while fixing
 * one — #14.
 */
function enforcePoolBoundary(
  elementId: string,
  originalPositions: Map<string, Rect>,
  services: BpmnServices,
): { corrected: boolean; warning?: string } {
  const { elementRegistry, modeling } = services;
  let node: any = elementRegistry.get(elementId);
  while (node && node.type !== 'bpmn:Participant') node = node.parent;
  if (!node) return { corrected: false };
  const pool = node;

  const originalPool = originalPositions.get(pool.id);
  if (!originalPool) return { corrected: false }; // pool itself is new this call — nothing to protect

  const siblings = elementRegistry.getAll().filter((el: any) => el.type === 'bpmn:Participant' && el.id !== pool.id);
  const originalSiblingRects = siblings
    .map((s: any) => originalPositions.get(s.id))
    .filter(Boolean) as Rect[];
  if (originalSiblingRects.length === 0) return { corrected: false }; // no other pools to collide with

  const envelope = computeGrowthEnvelope(originalPool, originalSiblingRects, POOL_PADDING);
  const current: Rect = { x: pool.x, y: pool.y, width: pool.width, height: pool.height };
  const withinEnvelope =
    current.x >= envelope.minX && current.y >= envelope.minY &&
    current.x + current.width <= envelope.maxX && current.y + current.height <= envelope.maxY;
  if (withinEnvelope) return { corrected: false };

  const poolName = pool.businessObject?.name || pool.id;
  const clampedMinX = Math.max(current.x, envelope.minX);
  const clampedMinY = Math.max(current.y, envelope.minY);
  const clampedMaxX = Math.min(current.x + current.width, envelope.maxX);
  const clampedMaxY = Math.min(current.y + current.height, envelope.maxY);
  if (clampedMaxX <= clampedMinX || clampedMaxY <= clampedMinY) {
    return { corrected: false, warning: `Pool "${poolName}" grew enough to overlap a neighboring pool, and there wasn't room to avoid it — worth a visual check.` };
  }
  const clampedRect: Rect = { x: clampedMinX, y: clampedMinY, width: clampedMaxX - clampedMinX, height: clampedMaxY - clampedMinY };

  const contentShapes = collectDescendantShapes(pool);
  const contentBbox = contentShapes.length > 0
    ? bboxOfShapes(contentShapes.map((s: any) => ({ bounds: { x: s.x, y: s.y, width: s.width, height: s.height } })))
    : null;
  const contentFits = !contentBbox || (
    contentBbox.x >= clampedRect.x + POOL_PADDING &&
    contentBbox.y >= clampedRect.y + POOL_PADDING &&
    contentBbox.x + contentBbox.width <= clampedRect.x + clampedRect.width - POOL_PADDING &&
    contentBbox.y + contentBbox.height <= clampedRect.y + clampedRect.height - POOL_PADDING
  );
  if (!contentFits) {
    return { corrected: false, warning: `Pool "${poolName}" grew enough to overlap a neighboring pool, and there wasn't room to avoid it without cutting off its own content — worth a visual check.` };
  }

  try {
    modeling.resizeShape(pool, clampedRect);
    return { corrected: true };
  } catch {
    return { corrected: false, warning: `Pool "${poolName}" grew enough to overlap a neighboring pool and the automatic correction failed — worth a visual check.` };
  }
}

async function layoutSubtree(scopeId: string, services: BpmnServices): Promise<{ positioned: number; routed: number; warning?: string }> {
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
/**
 * Live post-import correction pass: for any lane member whose actual Y
 * position falls outside its lane's assigned band (bpmn-auto-layout has no
 * lane awareness, so this happens whenever a branch/exception path in the
 * graph lands above or below where its lane says it should be —
 * `composePoolsAndLanes` only draws the band boundary, it never moves
 * shapes into it), nudges the *whole out-of-band group within that lane*
 * (preserving their relative spacing, not collapsing them onto each other)
 * so its center lands in the band's center. Uses `modeling.moveElements` —
 * bpmn-js re-routes connected edges (including ones crossing into a
 * different lane) as part of that command, the same as a user dragging a
 * shape, so there's no need to hand-roll edge re-routing here.
 */
function correctLanePositions(laneBands: LaneBand[], services: BpmnServices): void {
  const { elementRegistry, modeling } = services;
  for (const band of laneBands) {
    const bandTop = band.y;
    const bandBottom = band.y + band.height;
    const outOfBand: any[] = [];
    for (const id of band.memberIds) {
      const shape = elementRegistry.get(id);
      if (!shape) continue;
      const centerY = shape.y + shape.height / 2;
      if (centerY < bandTop || centerY > bandBottom) outOfBand.push(shape);
    }
    if (outOfBand.length === 0) continue;

    const minY = Math.min(...outOfBand.map((s: any) => s.y));
    const maxY = Math.max(...outOfBand.map((s: any) => s.y + s.height));
    const dy = (band.y + band.height / 2) - (minY + maxY) / 2;

    for (const shape of outOfBand) {
      try {
        modeling.moveElements([shape], { x: 0, y: dy });
      } catch {
        // best-effort — leave shapes that can't be moved where they are
      }
    }
  }
}

async function layoutViaComposition(currentXml: string, services: BpmnServices): Promise<any> {
  const { moddle, injector } = services;
  let modeler: any;
  try {
    modeler = injector.get('modeler');
  } catch {
    modeler = injector.get('bpmnjs');
  }

  const { rootElement: definitions } = await moddle.fromXML(currentXml);
  const extracted = extractComposition(definitions);
  const { xml: composedXml, warnings, laneBands } = await composePoolsAndLanes(extracted, services);
  await modeler.importXML(composedXml);

  await new Promise<void>(r => setTimeout(r, 50));

  correctLanePositions(laneBands, services);

  await new Promise<void>(r => setTimeout(r, 50));

  await reapplyArtifacts(extracted, services);

  await new Promise<void>(r => setTimeout(r, 50));

  const { rootElement: finalDefs } = await moddle.fromXML(composedXml);
  const planeElements: any[] = finalDefs.diagrams?.[0]?.plane?.planeElement || [];
  const positioned = planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNShape').length + extracted.annotations.length + extracted.groups.length;
  const routed = planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNEdge').length + extracted.messageFlows.length;

  const result: Record<string, unknown> = { positioned, routed, participants: extracted.participants.length };
  if (warnings.length) result.warnings = warnings;
  return result;
}

async function layoutDiagramViaAutoLayout(
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
  const hasAnnotationsOrGroups = (process.flowElements || []).some(
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
  await new Promise<void>(r => setTimeout(r, 50));

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