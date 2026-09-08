/**
 * MCP HTTP Server
 *
 * Exposes an MCP Streamable HTTP server on 127.0.0.1:3100 (configurable via
 * MCP_PORT env var). Renderer-bound tool dispatch (e.g. add_start_event
 * forwarded to the bpmn-js plugin in the Chromium process) is wired via
 * setupRendererBridge() from renderer-bridge.ts.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { z } from 'zod';

import { tools } from './tools/registry';
import { dispatch } from './tools/handlers';
import { updateMenuStatus } from './menu';
import { setupRendererBridge } from './renderer-bridge';
import { RESOURCES, readResource } from './resources/registry';
import { reindex } from './knowledge-base/reindex';
import { startKnowledgeBaseWatcher, stopKnowledgeBaseWatcher } from './knowledge-base/watcher';

// Electron is only available at runtime inside the Modeler — no @types/electron installed.
// All electron access is via dynamic require() wrapped in try/catch.
/* eslint-disable @typescript-eslint/no-explicit-any */

const LOG_PREFIX = '[camunda-mcp]';

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
  // --- Knowledge base: build/refresh the FTS index once at plugin load ---
  // (a live file watcher is added in a later phase; this covers content
  // that changed while the plugin wasn't running). Deliberately NOT
  // awaited: PDF/OCR extraction can take real time (OCR especially, on a
  // first-ever run that needs a one-time language-data download — see
  // extractors/image.ts), and none of that should delay BPMN tooling or
  // the MCP server itself from becoming available. kb_search may return
  // incomplete results for the few seconds this takes on a large corpus;
  // any KB failure is caught here and logged, never thrown.
  reindex()
    .then(({ indexed, removed, skipped, unsupported }) => {
      console.log(
        `${LOG_PREFIX} Knowledge base reindexed: ${indexed} indexed, ${removed} removed, `
        + `${skipped} unchanged, ${unsupported} unsupported format(s) skipped`
      );
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('%s Knowledge base reindex failed:', LOG_PREFIX, message);
    });

  // --- Knowledge base: live reindex while the plugin is running ---
  // Watches docs/knowledge-base/ so a file dropped in, edited, or removed
  // while Modeler is already running is picked up without a restart —
  // the second of reindex()'s two triggers (see reindex.ts).
  startKnowledgeBaseWatcher();

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
        const zodObject = toolDef.inputSchema as z.ZodObject;
        const toolName = toolDef.name;

        (server as any).registerTool(toolName, {
          description: toolDef.description,
          inputSchema: zodObject.shape,
        }, async (args: Record<string, unknown>) => {
          console.log('%s Tool call: %s', LOG_PREFIX, toolName, args);
          try {
            return await dispatch(toolName, args);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('%s Tool error (%s):', LOG_PREFIX, toolName, message);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
              isError: true,
            };
          }
        });
      }

      // Register knowledge base resources (Tier A — curated guides) on this
      // per-request server instance, same shape as the tool loop above.
      for (const res of RESOURCES) {
        (server as any).registerResource(res.name, res.uri, {
          description: res.description,
          mimeType: res.mimeType,
        }, async (uri: URL) => ({
          contents: [{ uri: uri.href, mimeType: res.mimeType, text: readResource(res) }],
        }));
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('%s Request error:', LOG_PREFIX, message);
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
        console.error('%s Failed to bind to port %s:', LOG_PREFIX, tryPort, err);
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

    stopKnowledgeBaseWatcher().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('%s Failed to stop knowledge base watcher:', LOG_PREFIX, message);
    });

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
