/**
 * bpmn-js module that handles MCP commands against the bpmn-js modeling API.
 *
 * Instead of Electron IPC (which requires ipcRenderer access that may be
 * blocked by contextIsolation), this module exposes a global function
 * `window.__mcpDispatch` that the main process calls via
 * `webContents.executeJavaScript()`.
 */

import { type BpmnServices } from './element-shared';
import {
  addStartEvent, addTask, addEndEvent, connectElements, addGateway, addEvent, addSubprocess,
  addParticipant, addLane, addEndEventTyped, addMessageFlow, addAnnotation, addGroup,
} from './elements/create';
import {
  setProperties, setIoMapping, setTaskHeaders, resizeElement, moveElement, cloneElement,
  deleteElement, patchElement, setExecutionPlatformVersion, setFlowWaypoints,
} from './elements/mutate';
import { listElements, getElement, getElementBounds } from './elements/query';
import { linkFormToTask } from './elements/forms';
import { getDiagramXml, importXml, saveDiagram, exportImage, validateDiagram } from './diagram-io';
import { batchOperations } from './batch';
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

type ToolHandler = (params: Record<string, unknown>, services: BpmnServices) => any;

// Single source of truth for tool-name -> handler routing, read by both
// dispatchRendererTool and dispatchRendererToolSync below — replaces two
// independently-hand-maintained switch statements that had to be kept in
// sync by hand (a tool added to one and not the other was a silent runtime
// gap, not a compile error).
const TOOL_HANDLERS: Record<string, ToolHandler> = {
  add_start_event: addStartEvent,
  add_task: addTask,
  add_end_event: addEndEvent,
  connect_elements: connectElements,
  link_form_to_task: linkFormToTask,
  add_gateway: addGateway,
  add_event: addEvent,
  add_subprocess: addSubprocess,
  set_properties: setProperties,
  set_io_mapping: setIoMapping,
  set_task_headers: setTaskHeaders,
  list_elements: listElements,
  get_element: getElement,
  delete_element: deleteElement,
  get_diagram_xml: getDiagramXml,
  import_xml: importXml,
  move_element: moveElement,
  save_diagram: saveDiagram,
  add_participant: addParticipant,
  add_lane: addLane,
  add_end_event_typed: addEndEventTyped,
  add_message_flow: addMessageFlow,
  add_annotation: addAnnotation,
  resize_element: resizeElement,
  set_flow_waypoints: setFlowWaypoints,
  get_element_bounds: getElementBounds,
  clone_element: cloneElement,
  batch_operations: batchOperations,
  add_group: addGroup,
  patch_element: patchElement,
  build_process: buildProcess,
  validate_layout: validateLayout,
  auto_layout: layoutDiagramViaAutoLayout,
  export_image: exportImage,
  set_execution_platform_version: setExecutionPlatformVersion,
  validate_diagram: validateDiagram,
};

export async function dispatchRendererTool(
  tool: string,
  params: Record<string, unknown>,
  services: BpmnServices
): Promise<any> {
  const handler = TOOL_HANDLERS[tool];
  if (!handler) throw new Error(`Unknown renderer tool: "${tool}"`);
  return handler(params, services);
}

// Tools that are async and cannot be dispatched synchronously inside a compound
export const ASYNC_TOOLS = new Set([
  'get_diagram_xml', 'import_xml', 'save_diagram', 'export_image',
  'build_process', 'auto_layout', 'batch_operations',
]);

// Tools wired for sync dispatch inside commandStack compound commands — a
// narrower set than "not in ASYNC_TOOLS": validate_diagram and
// set_execution_platform_version are neither async-only nor sync-wired
// today, so they're excluded here too (unchanged from the original switch).
const SYNC_TOOL_NAMES = new Set([
  'add_start_event', 'add_task', 'add_end_event', 'connect_elements', 'link_form_to_task',
  'add_gateway', 'add_event', 'add_subprocess', 'set_properties', 'set_io_mapping',
  'set_task_headers', 'list_elements', 'get_element', 'delete_element', 'move_element',
  'add_participant', 'add_lane', 'add_end_event_typed', 'add_message_flow', 'add_annotation',
  'resize_element', 'set_flow_waypoints', 'get_element_bounds', 'clone_element', 'add_group',
  'patch_element', 'validate_layout',
]);

/**
 * Synchronous dispatch for tools that don't need async execution.
 * Used inside commandStack compound commands where async would break nesting.
 */
export function dispatchRendererToolSync(
  tool: string,
  params: Record<string, unknown>,
  services: BpmnServices
): any {
  if (!SYNC_TOOL_NAMES.has(tool)) {
    throw new Error(`Tool "${tool}" cannot be dispatched synchronously`);
  }
  return TOOL_HANDLERS[tool](params, services);
}

const McpCommandModule = {
  __init__: ['mcpCommandHandler'],
  mcpCommandHandler: ['type', McpCommandHandler]
};

export default McpCommandModule;
