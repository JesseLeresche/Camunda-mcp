import * as fs from 'fs';
import { z } from 'zod';
import {
  addStartEventSchema, addTaskSchema, addEndEventSchema,
  connectElementsSchema, linkFormToTaskSchema,
  addGatewaySchema, addEventSchema, addSubprocessSchema, setPropertiesSchema,
  setIoMappingSchema, setTaskHeadersSchema, listElementsSchema, getElementSchema,
  deleteElementSchema, getDiagramXmlSchema, importXmlSchema,
  moveElementSchema, saveDiagramSchema, addParticipantSchema, addLaneSchema,
  addEndEventTypedSchema, addMessageFlowSchema, addAnnotationSchema,
  resizeElementSchema,
  setFlowWaypointsSchema, autoLayoutSchema, getElementBoundsSchema,
  cloneElementSchema, batchOperationsSchema, addGroupSchema,
  patchElementSchema, buildProcessSchema, validateLayoutSchema, exportImageSchema,
  setExecutionPlatformVersionSchema,
  validateDiagramSchema,
} from './registry';
import { createModel, createForm, addFormField, createDmn, deployProcess } from './handlers/local-tools';
import { kbSearch } from './handlers/knowledge-base';
import { listOpenDiagrams, switchDiagram } from './handlers/tabs';
import { resolveFacade } from './handlers/facade';
import { compactResult } from './handlers/compact';

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
 * Single source of truth for tool-name -> params-schema selection, used by
 * the renderer-dispatched tool group in dispatch() below — replaces a
 * ~30-branch if/else-if chain that existed purely to pick which schema to
 * validate against. Mirrors the FACADE map's lookup-table pattern.
 */
const SCHEMA_BY_TOOL: Record<string, z.ZodType> = {
  add_start_event: addStartEventSchema,
  add_task: addTaskSchema,
  add_end_event: addEndEventSchema,
  connect_elements: connectElementsSchema,
  add_gateway: addGatewaySchema,
  add_event: addEventSchema,
  add_subprocess: addSubprocessSchema,
  set_properties: setPropertiesSchema,
  set_io_mapping: setIoMappingSchema,
  set_task_headers: setTaskHeadersSchema,
  list_elements: listElementsSchema,
  get_element: getElementSchema,
  delete_element: deleteElementSchema,
  get_diagram_xml: getDiagramXmlSchema,
  import_xml: importXmlSchema,
  move_element: moveElementSchema,
  save_diagram: saveDiagramSchema,
  add_participant: addParticipantSchema,
  add_lane: addLaneSchema,
  add_end_event_typed: addEndEventTypedSchema,
  add_message_flow: addMessageFlowSchema,
  add_annotation: addAnnotationSchema,
  resize_element: resizeElementSchema,
  set_flow_waypoints: setFlowWaypointsSchema,
  get_element_bounds: getElementBoundsSchema,
  clone_element: cloneElementSchema,
  batch_operations: batchOperationsSchema,
  add_group: addGroupSchema,
  patch_element: patchElementSchema,
  build_process: buildProcessSchema,
  validate_layout: validateLayoutSchema,
  auto_layout: autoLayoutSchema,
  export_image: exportImageSchema,
  set_execution_platform_version: setExecutionPlatformVersionSchema,
  validate_diagram: validateDiagramSchema,
  link_form_to_task: linkFormToTaskSchema,
};

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

      case 'kb_search':
        result = await kbSearch(params);
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
      case 'export_image':
      case 'set_execution_platform_version':
      case 'validate_diagram': {
        // All renderer-dispatched tools: validate then forward via bridge
        const schema = SCHEMA_BY_TOOL[toolName];
        if (schema) schema.parse(params);

        if (toolName === 'link_form_to_task') {
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
