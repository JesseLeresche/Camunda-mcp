import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';
import { createModelSchema, addStartEventSchema, addTaskSchema, addEndEventSchema, connectElementsSchema, createFormSchema, addFormFieldSchema, linkFormToTaskSchema } from './registry';

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
 * Dispatches an MCP tool call to the appropriate handler.
 *
 * Local tools (e.g. create_model) execute directly in Node.js.
 * Renderer tools (e.g. add_start_event) are forwarded via the IPC bridge.
 */
export async function dispatch(
  toolName: string,
  params: Record<string, unknown>
): Promise<CallToolResult> {
  try {
    switch (toolName) {
      case 'create_model':
        return await createModel(params);

      case 'create_form':
        return await createForm(params);

      case 'add_form_field':
        return await addFormField(params);

      case 'add_start_event':
      case 'add_task':
      case 'add_end_event':
      case 'connect_elements':
      case 'link_form_to_task': {
        // All renderer-dispatched tools: validate then forward via bridge
        if (toolName === 'add_start_event') addStartEventSchema.parse(params);
        else if (toolName === 'add_task') addTaskSchema.parse(params);
        else if (toolName === 'add_end_event') addEndEventSchema.parse(params);
        else if (toolName === 'connect_elements') connectElementsSchema.parse(params);
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

        return await ipcBridge(toolName, params);
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
