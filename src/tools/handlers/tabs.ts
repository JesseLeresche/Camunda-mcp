import { switchDiagramSchema } from '../registry';
import type { CallToolResult } from '../handlers';

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
export async function executeInRenderer(script: string): Promise<any> {
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
export async function listOpenDiagrams(): Promise<CallToolResult> {
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
export async function switchDiagram(
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
