# Camunda Desktop Modeler MCP Plugin — MVP Implementation Plan

## Context

We need to build a Camunda Desktop Modeler plugin that exposes an MCP HTTP server, allowing AI assistants (Claude Code, Copilot) to create and manipulate BPMN models inside the live Modeler. The MVP validates the full round-trip: MCP client → Node.js HTTP server → Electron IPC → bpmn-js canvas API, by delivering two tools: `create_model` and `add_start_event`.

**Key decisions:**
- **Language:** TypeScript (compiled to JS for the plugin runtime)
- **Build:** npm + webpack (this is a Node.js Electron plugin, not Java)
- **MCP transport:** Stateless Streamable HTTP (new transport per request, no session management)
- **MCP SDK:** `@modelcontextprotocol/sdk` with `zod` for input schemas

---

## Tasks (8 items for GitHub Project Kanban)

### Task 1: Project Scaffolding & Build Pipeline

Create `package.json`, `tsconfig.json`, `webpack.config.js`, and directory structure.

**Files:**
- `package.json` — scripts: `build`, `dev`; dependencies below
- `tsconfig.json` — target ES2020, module CommonJS for Node.js side; separate config or webpack ts-loader for client
- `webpack.config.js` — entry `client/client.ts` → output `client/dist/client.js`, using `CamundaModelerWebpackPlugin`, externalize `electron`
- `client/client.ts` — empty placeholder so webpack compiles

**Dependencies:**
- `@modelcontextprotocol/sdk`, `express`, `uuid`, `zod` — runtime
- `camunda-modeler-plugin-helpers` — runtime (client)
- `camunda-modeler-webpack-plugin`, `webpack`, `webpack-cli`, `ts-loader`, `typescript`, `@types/express`, `@types/uuid` — dev

**Build scripts:**
```json
"build": "tsc --project tsconfig.node.json && webpack --mode production",
"dev": "tsc --project tsconfig.node.json --watch & webpack --mode development --watch"
```

Two compilation targets:
1. `tsc` compiles Node.js side (`index.ts`, `server.ts`, `tools/`) → JS in place or `dist/`
2. `webpack` + `ts-loader` bundles `client/` → `client/dist/client.js` for Chromium

**Verify:** `npm install` succeeds, `npm run build` produces output without errors.

---

### Task 2: Plugin Entry Point & Menu

Create the files the Camunda Modeler expects to find when loading a plugin.

**Files:**
- `index.ts` — exports `{ name, script, menu }`, calls `startMcpServer()` (stubbed for now)
- `menu.ts` — exports a function returning a menu item under "Plugins" showing "MCP Server: Starting..."

**Plugin contract:**
```ts
module.exports = {
  name: 'Camunda Modeler MCP Plugin',
  script: './client/dist/client.js',
  menu: './menu.js'
};
```

**Verify:** Symlink into `~/Library/Application Support/camunda-modeler/resources/plugins/camunda-mcp`, start Modeler, confirm plugin appears in Plugins menu without console errors.

---

### Task 3: Tool Registry & Zod Schemas

Define the two MVP tools with Zod input schemas and the Node.js-side `create_model` handler.

**Files:**
- `tools/registry.ts` — tool definitions with Zod schemas, exported as an array
- `tools/handlers.ts` — `dispatch()` router + `createModel()` implementation

**Tool definitions (Zod):**
```ts
// create_model
z.object({ name: z.string().optional().describe('Optional diagram name') })

// add_start_event
z.object({
  diagramId: z.string().describe('ID returned by create_model'),
  name: z.string().default('Start').describe('Label for the Start Event'),
  x: z.number().default(200).describe('Canvas x coordinate'),
  y: z.number().default(200).describe('Canvas y coordinate'),
})
```

**`createModel()` implementation:**
- Generate `diagramId` as `diagram-${Date.now()}`
- Write minimal valid BPMN XML to `os.tmpdir()/<name>.bpmn`
- Call `shell.openPath(filePath)` to open in Modeler
- Return `{ diagramId, message }` wrapped in MCP CallToolResult format

**`dispatch()` router:**
- Routes `create_model` → local `createModel()`
- Routes `add_start_event` → IPC bridge (injected, wired in Task 5)

**Verify:** Unit test `createModel()` — assert file written with valid BPMN XML.

---

### Task 4: MCP HTTP Server

Implement the core MCP server using the SDK with Streamable HTTP transport.

**Files:**
- `server.ts` — `startMcpServer()` function

**Architecture:**
```
startMcpServer()
  → new McpServer({ name: 'camunda-modeler-mcp', version: '0.1.0' })
  → register tools from registry.ts via server.registerTool()
  → Express app with POST /mcp endpoint
  → each request: new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  → connect server to transport, forward request
  → listen on process.env.MCP_PORT || 3100, bound to 127.0.0.1
```

**SDK imports (monolithic v1 package):**
```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
```

**Port conflict:** Try port, if `EADDRINUSE` try port+1 (max 3 retries). Log actual port.

**Update `index.ts`:** Wire `startMcpServer()` call on plugin load.
**Update `menu.ts`:** Show "MCP Server: Running (port XXXX)" once started.

**Verify:**
```bash
curl -X POST http://localhost:3100/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26"},"id":1}'
# → returns serverInfo

curl -X POST http://localhost:3100/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'
# → returns create_model and add_start_event
```

---

### Task 5: IPC Bridge (Main Process)

Add the IPC bridge to `server.ts` that forwards renderer-bound tool calls to Chromium.

**Additions to `server.ts`:**
- `pendingCalls: Map<string, { resolve, reject, timer }>` — correlation queue
- `dispatchToRenderer(tool, params)` — generates UUID, stores promise, sends `mcp:command` via `BrowserWindow.webContents.send()`, sets 10s timeout
- `ipcMain.on('mcp:result', ...)` — correlates response by UUID, resolves/rejects, clears timer

**Window discovery:** Use `BrowserWindow.getAllWindows()[0]` lazily at dispatch time (Modeler always has at least one window).

**Error cases:**
- No active window → reject with "No active Modeler window"
- Timeout (10s) → reject with "IPC timeout", clean up pending entry
- `webContents.isDestroyed()` → reject immediately

**Wire into tool registration:** `add_start_event` handler calls `dispatchToRenderer()` instead of local dispatch.

**Verify:** Call `add_start_event` via curl — should timeout with "IPC timeout" (expected until Task 6 wires the renderer side).

---

### Task 6: Renderer-Side bpmn-js Plugin & IPC Listener

Implement the client code that closes the IPC loop by calling the bpmn-js modeling API.

**Files:**
- `client/client.ts` — registers the bpmn-js module via `registerBpmnJSPlugin`
- `client/bpmn-tools.ts` — bpmn-js module with DI injection + `addStartEvent()` implementation

**bpmn-js module:**
```ts
export default {
  __init__: ['mcpCommandHandler'],
  mcpCommandHandler: ['type', McpCommandHandler]
};

function McpCommandHandler(eventBus, modeling, elementRegistry, canvas) {
  const { ipcRenderer } = require('electron');
  ipcRenderer.on('mcp:command', async (event, { id, tool, params }) => {
    try {
      const result = await dispatch(tool, params, { modeling, elementRegistry, canvas });
      ipcRenderer.send('mcp:result', { id, result });
    } catch (err) {
      ipcRenderer.send('mcp:result', { id, error: err.message });
    }
  });
}
McpCommandHandler.$inject = ['eventBus', 'modeling', 'elementRegistry', 'canvas'];
```

**`addStartEvent()` implementation:**
```ts
function addStartEvent(params, { modeling, canvas }) {
  const rootElement = canvas.getRootElement();
  const shape = modeling.createShape(
    { type: 'bpmn:StartEvent', name: params.name },
    { x: params.x, y: params.y },
    rootElement
  );
  return { elementId: shape.id, x: shape.x, y: shape.y };
}
```

**Webpack:** `electron` is external, `camunda-modeler-plugin-helpers` handled by `CamundaModelerWebpackPlugin`.

**Verify:** `npm run build` succeeds. Load in Modeler, no console errors. Send `add_start_event` — StartEvent appears on canvas.

---

### Task 7: Error Handling & Hardening

Harden all layers with proper error handling, logging, and edge cases.

**Areas:**
1. **Logging:** Consistent `[camunda-mcp]` prefix. Log tool calls, IPC dispatch/response, server start/stop.
2. **IPC resilience:** Guard duplicate UUID responses, clear timers on response, check `webContents.isDestroyed()`.
3. **Tool errors:** Handle no diagram open (`canvas.getRootElement()` null), fs write failures, invalid params.
4. **Graceful shutdown:** Close Express server on Modeler quit (`app.on('before-quit')`).
5. **`diagramId` note:** For MVP, `add_start_event` operates on the currently active tab regardless of `diagramId`. Document this limitation in the tool description.

**Verify:** Kill Modeler mid-call → error returned, not hang. Start with port 3100 occupied → uses 3101. Call `add_start_event` with no diagram → meaningful error.

---

### Task 8: End-to-End Integration Testing

Validate the complete MVP acceptance criteria from spec Section 9.

**Test sequence:**
1. Start Modeler → plugin loads, HTTP server on 3100, menu shows "Running"
2. Claude Code connects → `tools/list` returns both tools
3. Call `create_model` → new BPMN diagram tab opens
4. Call `add_start_event` with returned `diagramId` → StartEvent circle appears at (x, y)
5. Click/drag the element → selectable, moveable, properties panel works
6. Save file → `.bpmn` XML contains valid `bpmn:StartEvent`

**Also test:**
- Call `add_start_event` before `create_model` (no diagram) → error
- Invalid JSON body → proper JSON-RPC error
- Unknown tool name → error
- Modeler restart → server comes back up

**Configure `.mcp.json`:**
```json
{ "mcpServers": { "camunda-modeler": { "type": "http", "url": "http://localhost:3100/mcp" } } }
```

---

## Task Dependency Order

```
1 (Scaffolding) → 2 (Entry Point) → 3 (Tool Registry) → 4 (MCP Server) → 5 (IPC Bridge) → 6 (Renderer Plugin) → 7 (Hardening) → 8 (E2E Testing)
```

Tasks 2 and 3 can run in parallel after Task 1. All others are sequential.
