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
  bpmnFactory: any
) {
  console.log('[camunda-mcp] McpCommandHandler initialized');

  window.__mcpDispatch = async (tool: string, params: Record<string, unknown>) => {
    console.log(`[camunda-mcp] Dispatch: ${tool}`, params);
    try {
      const rawResult = await dispatchRendererTool(tool, params, { modeling, elementRegistry, canvas, moddle, bpmnFactory });
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

(McpCommandHandler as any).$inject = ['eventBus', 'modeling', 'elementRegistry', 'canvas', 'moddle', 'bpmnFactory'];

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

/** Debug helper — lists available moddle packages and zeebe types */
function debugModdle({ moddle }: BpmnServices) {
  const packages = (moddle.packages || []).map((p: any) => ({
    name: p.name,
    prefix: p.prefix,
    types: (p.types || []).map((t: any) => t.name),
  }));
  return { packages };
}

const McpCommandModule = {
  __init__: ['mcpCommandHandler'],
  mcpCommandHandler: ['type', McpCommandHandler]
};

export default McpCommandModule;
