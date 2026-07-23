/**
 * MCP HTTP Server + IPC Bridge
 *
 * Exposes an MCP Streamable HTTP server on 127.0.0.1:3100 (configurable via
 * MCP_PORT env var) and wires up the Electron IPC bridge so renderer-bound
 * tool calls (e.g. add_start_event) are forwarded to the bpmn-js plugin in
 * the Chromium process.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { z } from 'zod';

import { tools } from './tools/registry';
import { dispatch, setIpcBridge, CallToolResult } from './tools/handlers';
import { updateMenuStatus } from './menu';

// Electron is only available at runtime inside the Modeler — no @types/electron installed.
// All electron access is via dynamic require() wrapped in try/catch.
/* eslint-disable @typescript-eslint/no-explicit-any */

const LOG_PREFIX = '[camunda-mcp]';

// ---------------------------------------------------------------------------
// Renderer Bridge — uses webContents.executeJavaScript() instead of IPC
// ---------------------------------------------------------------------------
// The Camunda Modeler runs with contextIsolation enabled, so ipcRenderer
// is not accessible from plugin scripts. Instead, the renderer-side bpmn-js
// module exposes `window.__mcpDispatch(tool, params)` and the main process
// calls it via `webContents.executeJavaScript()`, which returns the result
// directly as a promise.
// ---------------------------------------------------------------------------

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
function setupRendererBridge(): void {
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

// ---------------------------------------------------------------------------
// MCP HTTP Server
// ---------------------------------------------------------------------------

// Reference to the running HTTP server — used for graceful shutdown
let httpServer: import('http').Server | null = null;

/**
 * Attempts to start the Express server on the given port.
 * Returns a promise that resolves with the actual port on success,
 * or rejects if the port is unavailable.
 * Stores the server reference in `httpServer` for graceful shutdown.
 */
function listenOnPort(
  app: import('express').Express,
  port: number,
  host: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = app.listen(port, host, () => {
      httpServer = srv;
      resolve(port);
    });
    srv.on('error', (err: NodeJS.ErrnoException) => {
      reject(err);
    });
  });
}

/**
 * Starts the MCP HTTP server and IPC bridge.
 *
 * 1. Creates an McpServer and registers all tools from the registry.
 * 2. Sets up Express with the MCP SDK's DNS rebinding protection.
 * 3. Binds to 127.0.0.1 on the configured port (with retry on EADDRINUSE).
 * 4. Initializes the Electron IPC bridge (if running inside the Modeler).
 */
export async function startMcpServer(): Promise<void> {
  // --- Renderer bridge setup (must happen before tool calls arrive) ---
  setupRendererBridge();

  // --- Set up Express app with DNS rebinding protection ---
  const host = '127.0.0.1';
  const app = createMcpExpressApp({ host });

  // --- Optional API key authentication ---
  const apiKey = process.env.MCP_API_KEY;
  if (apiKey) {
    app.use('/mcp', (req, res, next) => {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${apiKey}`) {
        res.status(401).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Unauthorized — set Authorization: Bearer <MCP_API_KEY>' },
          id: null,
        });
        return;
      }
      next();
    });
    console.log(`${LOG_PREFIX} API key authentication enabled`);
  }

  // POST /mcp — stateless Streamable HTTP transport
  // In stateless mode, we create a new McpServer + transport per request because
  // the SDK's Protocol.connect() throws if already connected to a transport.
  app.post('/mcp', async (req, res) => {
    try {
      const server = new McpServer({
        name: 'camunda-modeler-mcp',
        version: '0.1.0',
      });

      // Register tools on this per-request server instance
      for (const toolDef of tools) {
        const zodObject = toolDef.inputSchema as z.AnyZodObject;
        const toolName = toolDef.name;

        (server as any).registerTool(toolName, {
          description: toolDef.description,
          inputSchema: zodObject.shape,
        }, async (args: Record<string, unknown>) => {
          console.log(`${LOG_PREFIX} Tool call: ${toolName}`, args);
          try {
            return await dispatch(toolName, args);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`${LOG_PREFIX} Tool error (${toolName}):`, message);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
              isError: true,
            };
          }
        });
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} Request error:`, message);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  console.log(`${LOG_PREFIX} Tools registered: ${tools.map(t => t.name).join(', ')}`);

  // --- Bind to port with retry ---
  const basePort = parseInt(process.env.MCP_PORT || '3100', 10);
  const maxRetries = 3;

  let actualPort: number | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const tryPort = basePort + attempt;
    try {
      actualPort = await listenOnPort(app, tryPort, host);
      break;
    } catch (err) {
      const errno = (err as NodeJS.ErrnoException).code;
      if (errno === 'EADDRINUSE' && attempt < maxRetries - 1) {
        console.warn(`${LOG_PREFIX} Port ${tryPort} in use, trying ${tryPort + 1}...`);
      } else {
        console.error(`${LOG_PREFIX} Failed to bind to port ${tryPort}:`, err);
        throw err;
      }
    }
  }

  if (actualPort !== undefined) {
    console.log(`${LOG_PREFIX} MCP server listening on http://${host}:${actualPort}/mcp`);
    updateMenuStatus(actualPort);
  }

  // --- Graceful shutdown on Modeler quit ---
  registerShutdownHook();
}

/**
 * Registers an Electron `before-quit` handler to gracefully shut down the
 * HTTP server.
 */
function registerShutdownHook(): void {
  let app: any;
  try {
    app = require('electron').app;
  } catch {
    console.warn(`${LOG_PREFIX} Electron app not available — shutdown hook not registered`);
    return;
  }

  app.on('before-quit', () => {
    console.log(`${LOG_PREFIX} Shutting down MCP server...`);

    if (httpServer) {
      httpServer.close(() => {
        console.log(`${LOG_PREFIX} HTTP server closed`);
      });
      httpServer = null;
    }

    console.log(`${LOG_PREFIX} MCP server shutdown complete`);
  });

  console.log(`${LOG_PREFIX} Shutdown hook registered`);
}
