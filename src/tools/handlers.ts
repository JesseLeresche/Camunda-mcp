import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';
import {
  createModelSchema, addStartEventSchema, addTaskSchema, addEndEventSchema,
  connectElementsSchema, createFormSchema, addFormFieldSchema, linkFormToTaskSchema,
  addGatewaySchema, addEventSchema, addSubprocessSchema, setPropertiesSchema,
  setIoMappingSchema, setTaskHeadersSchema, listElementsSchema, getElementSchema,
  deleteElementSchema, getDiagramXmlSchema, importXmlSchema,
  moveElementSchema, saveDiagramSchema, addParticipantSchema, addLaneSchema,
  addEndEventTypedSchema, addMessageFlowSchema, addAnnotationSchema,
  createDmnSchema, deployProcessSchema,
  resizeElementSchema,
  setFlowWaypointsSchema, autoLayoutSchema, getElementBoundsSchema,
  cloneElementSchema, batchOperationsSchema, addGroupSchema,
  patchElementSchema, buildProcessSchema, validateLayoutSchema, exportImageSchema,
  listOpenDiagramsSchema, switchDiagramSchema,
} from './registry';

const LOG_PREFIX = '[camunda-mcp]';

/** MCP CallToolResult content item */
interface TextContent {
  type: 'text';
  text: string;
}

/** MCP CallToolResult shape returned by all tool handlers */
export interface CallToolResult {
  content: TextContent[];
  isError?: boolean;
}

/**
 * Minimal valid BPMN 2.0 XML for a new empty diagram.
 */
const EMPTY_BPMN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/BPMN/20100524/DC"
                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn"
                  exporter="Camunda MCP Plugin" exporterVersion="0.1.0">
  <bpmn:process id="Process_1" isExecutable="true" />
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/**
 * Type for the IPC bridge function that forwards tool calls to the renderer.
 * Will be injected by the IPC bridge module (Task 5).
 */
export type IpcBridgeFn = (
  tool: string,
  params: Record<string, unknown>
) => Promise<CallToolResult>;

/** The IPC bridge function, set via `setIpcBridge()` once wired in Task 5 */
let ipcBridge: IpcBridgeFn | null = null;

/**
 * Inject the IPC bridge function used to dispatch tool calls to the renderer.
 * Called during server startup once the IPC bridge is initialized.
 */
export function setIpcBridge(bridge: IpcBridgeFn): void {
  ipcBridge = bridge;
}

/**
 * Creates a new empty BPMN diagram and opens it in the Camunda Desktop Modeler.
 *
 * - Generates a unique diagramId
 * - Writes minimal BPMN XML to a temp file
 * - Opens the file via Electron's shell.openPath()
 */
async function createModel(
  params: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = createModelSchema.parse(params);
  const diagramId = `diagram-${Date.now()}`;
  const name = parsed.name || diagramId;
  const fileName = `${name}.bpmn`;
  const filePath = path.join(os.tmpdir(), fileName);

  // Write the BPMN XML to a temp file
  try {
    fs.writeFileSync(filePath, EMPTY_BPMN_XML, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Failed to write BPMN file to ${filePath}:`, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Failed to write diagram file: ${message}` }) }],
      isError: true,
    };
  }

  // Attempt to open the file in the Camunda Desktop Modeler via Electron's shell
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { shell: { openPath: (path: string) => Promise<string> } };
    const { shell } = electron;
    const errorMessage = await shell.openPath(filePath);
    if (errorMessage) {
      console.warn(`${LOG_PREFIX} shell.openPath warning: ${errorMessage}`);
    }
  } catch {
    // Running outside Electron (e.g. tests) — skip shell.openPath
    console.warn(
      `${LOG_PREFIX} Electron not available; skipping shell.openPath`
    );
  }

  const result = { diagramId, filePath, message: `Created diagram "${name}"` };
  console.log(`${LOG_PREFIX} Created model: ${diagramId} at ${filePath}`);

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

/**
 * Creates a new Camunda Form (.form) JSON file.
 */
async function createForm(
  params: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = createFormSchema.parse(params);
  const formId = `Form_${parsed.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const fileName = `${parsed.name}.form`;
  const filePath = path.join(os.tmpdir(), fileName);

  let fieldCounter = 0;
  const components: any[] = [];

  if (parsed.fields) {
    for (const field of parsed.fields) {
      fieldCounter++;
      const component: any = {
        label: field.label,
        type: field.type,
        id: `Field_${fieldCounter.toString().padStart(3, '0')}`,
        key: field.key,
      };
      if (field.required) {
        component.validate = { required: true };
      }
      if (field.description) {
        component.description = field.description;
      }
      if (field.options && ['select', 'radio', 'taglist'].includes(field.type)) {
        component.values = field.options.map(o => ({ label: o.label, value: o.value }));
      }
      components.push(component);
    }
  }

  const formJson = {
    components,
    type: 'default',
    id: formId,
    executionPlatform: 'Camunda Cloud',
    executionPlatformVersion: '8.4.0',
    exporter: { name: 'Camunda MCP Plugin', version: '0.1.0' },
    schemaVersion: 16,
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(formJson, null, 2), 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Failed to write form file: ${message}` }) }],
      isError: true,
    };
  }

  console.log(`${LOG_PREFIX} Created form: ${formId} at ${filePath}`);
  return {
    content: [{ type: 'text', text: JSON.stringify({ formId, filePath, fieldCount: components.length }) }],
  };
}

/**
 * Adds a field to an existing Camunda Form (.form) file.
 */
async function addFormField(
  params: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = addFormFieldSchema.parse(params);

  let formJson: any;
  try {
    const raw = fs.readFileSync(parsed.formPath, 'utf-8');
    formJson = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Failed to read form file: ${message}` }) }],
      isError: true,
    };
  }

  if (!formJson.components) {
    formJson.components = [];
  }

  const fieldId = `Field_${(formJson.components.length + 1).toString().padStart(3, '0')}`;
  const component: any = {
    label: parsed.label,
    type: parsed.type,
    id: fieldId,
    key: parsed.key,
  };
  if (parsed.required) {
    component.validate = { required: true };
  }
  if (parsed.description) {
    component.description = parsed.description;
  }
  if (parsed.options && ['select', 'radio', 'taglist'].includes(parsed.type)) {
    component.values = parsed.options.map(o => ({ label: o.label, value: o.value }));
  }

  formJson.components.push(component);

  try {
    fs.writeFileSync(parsed.formPath, JSON.stringify(formJson, null, 2), 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Failed to write form file: ${message}` }) }],
      isError: true,
    };
  }

  console.log(`${LOG_PREFIX} Added field ${parsed.key} to form at ${parsed.formPath}`);
  return {
    content: [{ type: 'text', text: JSON.stringify({ fieldId, key: parsed.key, fieldCount: formJson.components.length }) }],
  };
}

/**
 * Creates a new DMN decision table file.
 */
async function createDmn(
  params: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = createDmnSchema.parse(params);
  const fileName = `${parsed.name}.dmn`;
  const filePath = path.join(os.tmpdir(), fileName);

  // Build inputs XML
  let inputsXml = '';
  if (parsed.inputs && parsed.inputs.length > 0) {
    inputsXml = parsed.inputs.map((inp, i) => {
      const id = `Input_${i + 1}`;
      const exprId = `InputExpression_${i + 1}`;
      return `      <input id="${id}" label="${escapeXml(inp.label)}">
        <inputExpression id="${exprId}" typeRef="${escapeXml(inp.type)}">
          <text>${escapeXml(inp.expression)}</text>
        </inputExpression>
      </input>`;
    }).join('\n');
  } else {
    inputsXml = `      <input id="Input_1" label="Input">
        <inputExpression id="InputExpression_1" typeRef="string">
          <text></text>
        </inputExpression>
      </input>`;
  }

  // Build outputs XML
  let outputsXml = '';
  if (parsed.outputs && parsed.outputs.length > 0) {
    outputsXml = parsed.outputs.map((out, i) => {
      const id = `Output_${i + 1}`;
      return `      <output id="${id}" label="${escapeXml(out.label)}" name="${escapeXml(out.name)}" typeRef="${escapeXml(out.type)}" />`;
    }).join('\n');
  } else {
    outputsXml = `      <output id="Output_1" label="Output" name="output" typeRef="string" />`;
  }

  const dmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/"
             xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/"
             id="Definitions_1" name="DRD" namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="Decision_1" name="${escapeXml(parsed.tableName)}">
    <decisionTable id="DecisionTable_1" hitPolicy="${escapeXml(parsed.hitPolicy)}">
${inputsXml}
${outputsXml}
    </decisionTable>
  </decision>
</definitions>`;

  try {
    fs.writeFileSync(filePath, dmnXml, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Failed to write DMN file to ${filePath}:`, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Failed to write DMN file: ${message}` }) }],
      isError: true,
    };
  }

  // Attempt to open the file via Electron's shell
  try {
    const electron = require('electron') as { shell: { openPath: (path: string) => Promise<string> } };
    const { shell } = electron;
    const errorMessage = await shell.openPath(filePath);
    if (errorMessage) {
      console.warn(`${LOG_PREFIX} shell.openPath warning: ${errorMessage}`);
    }
  } catch {
    console.warn(`${LOG_PREFIX} Electron not available; skipping shell.openPath`);
  }

  console.log(`${LOG_PREFIX} Created DMN: ${parsed.tableName} at ${filePath}`);
  return {
    content: [{ type: 'text', text: JSON.stringify({
      filePath,
      tableName: parsed.tableName,
      hitPolicy: parsed.hitPolicy,
      inputCount: parsed.inputs?.length ?? 1,
      outputCount: parsed.outputs?.length ?? 1,
    }) }],
  };
}

/**
 * Escapes special XML characters in a string.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Stub handler for deploying a BPMN process to Camunda 8 Zeebe.
 * Returns configuration guidance — actual deployment requires @camunda8/sdk.
 */
async function deployProcess(
  params: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = deployProcessSchema.parse(params);
  const clusterUrl = parsed.clusterUrl || process.env.ZEEBE_ADDRESS;
  const clientId = parsed.clientId || process.env.ZEEBE_CLIENT_ID;

  if (!clusterUrl) {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        error: 'Zeebe cluster not configured',
        message: 'Set ZEEBE_ADDRESS, ZEEBE_CLIENT_ID, and ZEEBE_CLIENT_SECRET environment variables, or pass clusterUrl/clientId/clientSecret parameters. Install @camunda8/sdk for full deployment support.',
        requiredEnvVars: ['ZEEBE_ADDRESS', 'ZEEBE_CLIENT_ID', 'ZEEBE_CLIENT_SECRET'],
      }) }],
      isError: true,
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify({
      message: 'Deployment not yet implemented — @camunda8/sdk integration planned for a future release.',
      filePath: parsed.filePath,
      clusterUrl,
    }) }],
  };
}

// ---------------------------------------------------------------------------
// Renderer execution helper — for tab management tools that need the
// Modeler's app-level API (not bpmn-js services)
// ---------------------------------------------------------------------------

const RENDERER_TIMEOUT_MS = 10_000;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Executes JavaScript in the Modeler's renderer process via
 * webContents.executeJavaScript(). Used for tab management operations
 * that need the Modeler's app-level API rather than bpmn-js services.
 */
async function executeInRenderer(script: string): Promise<any> {
  let BrowserWindow: any;
  try {
    BrowserWindow = require('electron').BrowserWindow;
  } catch {
    throw new Error(
      'Electron BrowserWindow not available — ensure the Camunda Desktop Modeler is running'
    );
  }

  const windows: any[] = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    throw new Error('No active Modeler window');
  }

  const win = windows[0];
  if (win.webContents.isDestroyed()) {
    throw new Error('Modeler window webContents is destroyed');
  }

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(
      () => reject(new Error(`Renderer timeout — no response within ${RENDERER_TIMEOUT_MS}ms`)),
      RENDERER_TIMEOUT_MS,
    );
  });

  return Promise.race([
    win.webContents.executeJavaScript(script, true),
    timeoutPromise,
  ]);
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Lists all open diagram tabs tracked by the tab manager client extension.
 */
async function listOpenDiagrams(): Promise<CallToolResult> {
  try {
    const tabs = await executeInRenderer(
      `window.__mcpTabManager`
      + ` ? window.__mcpTabManager.listTabs()`
      + ` : Promise.reject(new Error('Tab manager not initialized — ensure the plugin is loaded and at least one diagram has been opened'))`
    );
    return {
      content: [{ type: 'text', text: JSON.stringify({ tabs }) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
}

/**
 * Switches to a specific diagram tab by ID, file path, or name.
 */
async function switchDiagram(
  params: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = switchDiagramSchema.parse(params);

  if (!parsed.diagramId && !parsed.filePath && !parsed.name) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'At least one of diagramId, filePath, or name must be provided' }) }],
      isError: true,
    };
  }

  try {
    const paramsJson = JSON.stringify({
      diagramId: parsed.diagramId,
      filePath: parsed.filePath,
      name: parsed.name,
    });
    const result = await executeInRenderer(
      `window.__mcpTabManager`
      + ` ? window.__mcpTabManager.switchTab(${paramsJson})`
      + ` : Promise.reject(new Error('Tab manager not initialized — ensure the plugin is loaded and at least one diagram has been opened'))`
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
}

/**
 * Strips a tool response down to essential information.
 * Applied when the caller passes `compact: true`.
 *
 * Strategy:
 * - Mutations (move, resize, connect, delete, etc.): return {ok: true}
 * - build_process: return flat idMap only
 * - batch_operations: return {ok: N} where N is the number of operations
 * - list_elements: return array of {id, type}
 * - validate_layout / get_element / get_element_bounds: keep full detail (that IS the payload)
 * - Errors: always keep full detail
 */
function compactResult(result: CallToolResult, toolName?: string): CallToolResult {
  if (result.isError) return result;
  try {
    const data = JSON.parse(result.content[0].text);

    // Read-oriented tools: keep full response (the data IS the purpose)
    const keepFullTools = [
      'validate_layout', 'get_element', 'get_element_bounds', 'get_diagram_xml',
      'list_open_diagrams',
    ];
    if (toolName && keepFullTools.includes(toolName)) return result;

    // build_process: return just the idMap (only new information)
    if (data.idMap) {
      return { content: [{ type: 'text', text: JSON.stringify(data.idMap) }] };
    }

    // batch_operations: return count of operations
    if (Array.isArray(data.results)) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: data.results.length }) }] };
    }

    // list_elements: trim to id array
    if (Array.isArray(data.elements)) {
      return { content: [{ type: 'text', text: JSON.stringify({ ids: data.elements.map((el: any) => el.id) }) }] };
    }

    // Tabs
    if (Array.isArray(data.tabs)) {
      return { content: [{ type: 'text', text: JSON.stringify({ tabs: data.tabs.map((t: any) => ({ id: t.id, name: t.name })) }) }] };
    }

    // Issues (validate_layout) — keep full
    if (Array.isArray(data.issues)) return result;

    // Everything else (mutations): return {ok: true} + any ID fields
    const compacted: Record<string, unknown> = { ok: true };
    for (const key of Object.keys(data)) {
      if (key.endsWith('Id') || key === 'idMap' || key === 'childIds') {
        compacted[key] = data[key];
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify(compacted) }] };
  } catch {
    return result;
  }
}

/**
 * Maps each consolidated public tool to its `operation` field and the internal
 * tool name each operation resolves to. Tools not listed here (build_process,
 * batch_operations, create_dmn, deploy_process) are pass-through. The internal
 * names still drive the dispatch switch and the renderer implementations, which
 * are unchanged.
 */
const FACADE: Record<string, { op: string; map: Record<string, string> }> = {
  manage_diagram: {
    op: 'operation',
    map: {
      create: 'create_model', list: 'list_open_diagrams', switch: 'switch_diagram',
      save: 'save_diagram', export_image: 'export_image', import_xml: 'import_xml',
      get_xml: 'get_diagram_xml',
    },
  },
  add_element: {
    op: 'operation',
    map: {
      start: 'add_start_event', end: 'add_end_event', task: 'add_task',
      gateway: 'add_gateway', event: 'add_event', subprocess: 'add_subprocess',
      pool: 'add_participant', lane: 'add_lane', annotation: 'add_annotation',
      group: 'add_group',
    },
  },
  connect: {
    op: 'operation',
    map: {
      sequence_flow: 'connect_elements', message_flow: 'add_message_flow',
      set_waypoints: 'set_flow_waypoints',
    },
  },
  update_element: {
    op: 'operation',
    map: {
      properties: 'patch_element', move: 'move_element', resize: 'resize_element',
      io_mapping: 'set_io_mapping', headers: 'set_task_headers',
    },
  },
  query_diagram: {
    op: 'operation',
    map: { list: 'list_elements', get: 'get_element', bounds: 'get_element_bounds' },
  },
  manage_element: {
    op: 'operation',
    map: { delete: 'delete_element', clone: 'clone_element' },
  },
  layout: {
    op: 'operation',
    map: { auto: 'auto_layout', validate: 'validate_layout' },
  },
  manage_form: {
    op: 'operation',
    map: { create: 'create_form', add_field: 'add_form_field', link_to_task: 'link_form_to_task' },
  },
};

/**
 * Resolves a consolidated public tool call to the internal tool name + params.
 * - Pass-through for standalone tools and any name not in FACADE.
 * - Strips the `operation` field from params.
 * - add_element `end` upgrades to add_end_event_typed when a (non-none) event
 *   definition is supplied.
 * Returns an `error` message string for an unknown/missing operation.
 */
export function resolveFacade(
  toolName: string,
  params: Record<string, unknown>
): { internalTool: string; params: Record<string, unknown> } | { error: string } {
  const facade = FACADE[toolName];
  if (!facade) return { internalTool: toolName, params };

  const op = params[facade.op];
  if (typeof op !== 'string' || !(op in facade.map)) {
    return { error: `${facade.op}: must be one of [${Object.keys(facade.map).join(', ')}]` };
  }

  let internalTool = facade.map[op];
  const rest = { ...params };
  delete rest[facade.op];

  if (toolName === 'add_element' && op === 'end') {
    const edt = rest.eventDefinitionType;
    if (typeof edt === 'string' && edt !== 'none' && edt !== '') {
      internalTool = 'add_end_event_typed';
    }
  }

  return { internalTool, params: rest };
}

/**
 * Dispatches an MCP tool call to the appropriate handler.
 *
 * Public tool calls are first resolved through {@link resolveFacade} to an
 * internal tool name. Local tools (e.g. create_model) then execute directly in
 * Node.js; renderer tools (e.g. add_start_event) are forwarded via the IPC bridge.
 *
 * All tools support an optional `compact: true` parameter that strips the
 * response down to essential IDs and status fields.
 */
export async function dispatch(
  toolName: string,
  params: Record<string, unknown>
): Promise<CallToolResult> {
  // Extract compact flag before schema validation (not part of individual schemas)
  const compact = !!params.compact;
  if (params.compact !== undefined) {
    params = { ...params };
    delete params.compact;
  }

  // Resolve the consolidated public tool to its internal tool name + params.
  const resolved = resolveFacade(toolName, params);
  if ('error' in resolved) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Invalid parameters', details: resolved.error }) }],
      isError: true,
    };
  }
  toolName = resolved.internalTool;
  params = resolved.params;

  try {
    let result: CallToolResult;
    switch (toolName) {
      case 'create_model':
        result = await createModel(params);
        break;

      case 'create_form':
        result = await createForm(params);
        break;

      case 'add_form_field':
        result = await addFormField(params);
        break;

      case 'create_dmn':
        result = await createDmn(params);
        break;

      case 'deploy_process':
        result = await deployProcess(params);
        break;

      case 'list_open_diagrams':
        result = await listOpenDiagrams();
        break;

      case 'switch_diagram':
        result = await switchDiagram(params);
        break;

      case 'add_start_event':
      case 'add_task':
      case 'add_end_event':
      case 'connect_elements':
      case 'link_form_to_task':
      case 'add_gateway':
      case 'add_event':
      case 'add_subprocess':
      case 'set_properties':
      case 'set_io_mapping':
      case 'set_task_headers':
      case 'list_elements':
      case 'get_element':
      case 'delete_element':
      case 'get_diagram_xml':
      case 'import_xml':
      case 'move_element':
      case 'save_diagram':
      case 'add_participant':
      case 'add_lane':
      case 'add_end_event_typed':
      case 'add_message_flow':
      case 'add_annotation':
      case 'resize_element':
      case 'set_flow_waypoints':
      case 'get_element_bounds':
      case 'clone_element':
      case 'batch_operations':
      case 'add_group':
      case 'patch_element':
      case 'build_process':
      case 'validate_layout':
      case 'auto_layout':
      case 'export_image': {
        // All renderer-dispatched tools: validate then forward via bridge
        if (toolName === 'add_start_event') addStartEventSchema.parse(params);
        else if (toolName === 'add_task') addTaskSchema.parse(params);
        else if (toolName === 'add_end_event') addEndEventSchema.parse(params);
        else if (toolName === 'connect_elements') connectElementsSchema.parse(params);
        else if (toolName === 'add_gateway') addGatewaySchema.parse(params);
        else if (toolName === 'add_event') addEventSchema.parse(params);
        else if (toolName === 'add_subprocess') addSubprocessSchema.parse(params);
        else if (toolName === 'set_properties') setPropertiesSchema.parse(params);
        else if (toolName === 'set_io_mapping') setIoMappingSchema.parse(params);
        else if (toolName === 'set_task_headers') setTaskHeadersSchema.parse(params);
        else if (toolName === 'list_elements') listElementsSchema.parse(params);
        else if (toolName === 'get_element') getElementSchema.parse(params);
        else if (toolName === 'delete_element') deleteElementSchema.parse(params);
        else if (toolName === 'get_diagram_xml') getDiagramXmlSchema.parse(params);
        else if (toolName === 'import_xml') importXmlSchema.parse(params);
        else if (toolName === 'move_element') moveElementSchema.parse(params);
        else if (toolName === 'save_diagram') saveDiagramSchema.parse(params);
        else if (toolName === 'add_participant') addParticipantSchema.parse(params);
        else if (toolName === 'add_lane') addLaneSchema.parse(params);
        else if (toolName === 'add_end_event_typed') addEndEventTypedSchema.parse(params);
        else if (toolName === 'add_message_flow') addMessageFlowSchema.parse(params);
        else if (toolName === 'add_annotation') addAnnotationSchema.parse(params);
        else if (toolName === 'resize_element') resizeElementSchema.parse(params);
        else if (toolName === 'set_flow_waypoints') setFlowWaypointsSchema.parse(params);
        else if (toolName === 'get_element_bounds') getElementBoundsSchema.parse(params);
        else if (toolName === 'clone_element') cloneElementSchema.parse(params);
        else if (toolName === 'batch_operations') batchOperationsSchema.parse(params);
        else if (toolName === 'add_group') addGroupSchema.parse(params);
        else if (toolName === 'patch_element') patchElementSchema.parse(params);
        else if (toolName === 'build_process') buildProcessSchema.parse(params);
        else if (toolName === 'validate_layout') validateLayoutSchema.parse(params);
        else if (toolName === 'auto_layout') autoLayoutSchema.parse(params);
        else if (toolName === 'export_image') exportImageSchema.parse(params);
        else if (toolName === 'link_form_to_task') {
          linkFormToTaskSchema.parse(params);
          // Read the form JSON and pass it to the renderer so it can embed it
          const formPath = params.formPath as string;
          try {
            const formJson = fs.readFileSync(formPath, 'utf-8');
            params = { ...params, formJson };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: `Failed to read form file: ${message}` }) }],
              isError: true,
            };
          }
        }

        if (!ipcBridge) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'IPC bridge not initialized',
                  message:
                    'The renderer-side IPC bridge has not been wired yet. ' +
                    'Ensure the Camunda Desktop Modeler is running with the plugin loaded.',
                }),
              },
            ],
            isError: true,
          };
        }

        // export_image: renderer returns SVG string or PNG base64, we write the file
        if (toolName === 'export_image') {
          result = await ipcBridge(toolName, params);
          try {
            const resultText = JSON.parse(result.content[0].text);
            if (resultText.data && resultText.filePath) {
              if (resultText.format === 'png') {
                // PNG: data is base64-encoded
                const buf = Buffer.from(resultText.data, 'base64');
                fs.writeFileSync(resultText.filePath, buf);
              } else {
                // SVG: data is a string
                fs.writeFileSync(resultText.filePath, resultText.data, 'utf-8');
              }
              result = {
                content: [{ type: 'text', text: JSON.stringify({
                  saved: true, filePath: resultText.filePath, format: resultText.format,
                  width: resultText.width, height: resultText.height,
                }) }],
              };
            }
          } catch {
            // If parsing/writing fails, return the original result
          }
          break;
        }

        // save_diagram: renderer returns XML, we write the file on the Node.js side
        if (toolName === 'save_diagram') {
          result = await ipcBridge(toolName, params);
          try {
            const resultText = JSON.parse(result.content[0].text);
            if (resultText.xml && resultText.filePath) {
              fs.writeFileSync(resultText.filePath, resultText.xml, 'utf-8');
              result = {
                content: [{ type: 'text', text: JSON.stringify({ saved: true, filePath: resultText.filePath }) }],
              };
            }
          } catch {
            // If parsing/writing fails, return the original result
          }
          break;
        }

        result = await ipcBridge(toolName, params);
        break;
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Unknown tool',
                message: `No handler registered for tool "${toolName}"`,
              }),
            },
          ],
          isError: true,
        };
    }

    return compact ? compactResult(result, toolName) : result;
  } catch (err) {
    // Catch Zod validation errors and return them as proper MCP error results
    if (err instanceof z.ZodError) {
      const issues = err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      console.error(`${LOG_PREFIX} Validation error for tool "${toolName}": ${issues}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Invalid parameters',
              details: issues,
            }),
          },
        ],
        isError: true,
      };
    }
    // Re-throw non-validation errors so the server-level catch in server.ts handles them
    throw err;
  }
}
