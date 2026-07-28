/**
 * Renderer Bridge
 *
 * The Camunda Modeler runs with contextIsolation enabled, so ipcRenderer
 * is not accessible from plugin scripts. Instead, the renderer-side bpmn-js
 * module exposes `window.__mcpDispatch(tool, params)` and the main process
 * calls it via `webContents.executeJavaScript()`, which returns the result
 * directly as a promise.
 */

import { setIpcBridge, CallToolResult } from './tools/handlers';

// Electron is only available at runtime inside the Modeler — no @types/electron installed.
// All electron access is via dynamic require() wrapped in try/catch.
/* eslint-disable @typescript-eslint/no-explicit-any */

const LOG_PREFIX = '[camunda-mcp]';

const DISPATCH_TIMEOUT_MS = 10_000;

// build_process/batch_operations can create dozens of elements, run ELK
// auto-layout, and now auto-run a validation pass in the same call — all of
// which can outlast the default timeout on larger diagrams. auto_layout and
// validate_layout run the same ELK-based engine directly and hit the same
// ceiling on large diagrams.
const EXTENDED_DISPATCH_TIMEOUT_MS = 30_000;
const EXTENDED_TIMEOUT_TOOLS = new Set(['build_process', 'batch_operations', 'auto_layout', 'validate_layout']);

/**
 * Dispatches a tool call to the Chromium renderer via executeJavaScript.
 *
 * The renderer-side bpmn-js module registers `window.__mcpDispatch` which
 * calls the bpmn-js API and returns a CallToolResult. This function calls
 * that global function from the main process.
 */
async function dispatchToRenderer(
  tool: string,
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  let BrowserWindow: any;
  try {
    BrowserWindow = require('electron').BrowserWindow;
  } catch {
    throw new Error('Electron BrowserWindow not available');
  }

  const windows: any[] = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    throw new Error('No active Modeler window');
  }

  const win = windows[0];
  if (win.webContents.isDestroyed()) {
    throw new Error('Modeler window webContents is destroyed');
  }

  // Build the JS expression to execute in the renderer
  const toolJson = JSON.stringify(tool);
  const paramsJson = JSON.stringify(params);
  const script = `window.__mcpDispatch ? window.__mcpDispatch(${toolJson}, ${paramsJson}) : Promise.reject(new Error('window.__mcpDispatch not registered — no BPMN diagram is open'))`;

  console.log(`${LOG_PREFIX} Dispatching to renderer: ${tool}`);

  // Race the executeJavaScript call against a timeout
  const timeoutMs = EXTENDED_TIMEOUT_TOOLS.has(tool) ? EXTENDED_DISPATCH_TIMEOUT_MS : DISPATCH_TIMEOUT_MS;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error(`Renderer timeout — no response for "${tool}" within ${timeoutMs}ms`)), timeoutMs);
  });

  const result = await Promise.race([
    win.webContents.executeJavaScript(script, true),
    timeoutPromise,
  ]);

  console.log(`${LOG_PREFIX} Renderer result for ${tool}:`, JSON.stringify(result));

  // Guard: wrap raw result if not proper CallToolResult format
  if (result && result.content && Array.isArray(result.content)) {
    return result as CallToolResult;
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

/**
 * Sets up the renderer bridge by wiring dispatchToRenderer into the
 * tool handlers module.
 */
export function setupRendererBridge(): void {
  let BrowserWindow: any;
  try {
    BrowserWindow = require('electron').BrowserWindow;
  } catch {
    console.warn(`${LOG_PREFIX} Electron not available — renderer bridge disabled`);
    return;
  }

  if (BrowserWindow) {
    setIpcBridge(dispatchToRenderer);
    console.log(`${LOG_PREFIX} Renderer bridge initialized (using executeJavaScript)`);
  }
}
