# Camunda Desktop Modeler — MCP Plugin Specification
**Version 0.1 — MVP Scope | Author: Jesse Leresche | March 2026**

---

## 1. Purpose & Scope

This document specifies the design and implementation plan for a Camunda Desktop Modeler plugin that exposes an MCP (Model Context Protocol) HTTP server. The server allows AI coding assistants — Claude Code, GitHub Copilot, and compatible MCP clients — to create and manipulate BPMN models and Camunda Forms directly inside the live Desktop Modeler application.

The approach mirrors the architecture of the Archi MCP plugin, adapted for the Electron/bpmn-js runtime instead of Java/OSGi/EMF.

> **MVP Goal (v0.1):** Create a new BPMN diagram from scratch and place a Start Event element on the canvas. This validates the full IPC bridge from MCP client → Node.js HTTP server → Electron IPC → bpmn-js modeling API. All subsequent tools (tasks, gateways, connections, forms) follow the same pattern established here.

---

## 2. Architecture

### 2.1 Overview

The plugin runs in two distinct runtimes within the Electron application, connected by IPC:

| Layer | Details |
|-------|---------|
| **MCP HTTP Server** | Node.js main process. Opens an HTTP server (default port 3100). Receives JSON-RPC 2.0 MCP tool calls from the AI client. Forwards commands to the client layer via Electron `ipcMain`. |
| **bpmn-js Client** | Chromium renderer process. Bundled JavaScript. Receives IPC messages, calls the live bpmn-js Modeler API (`modeling`, `elementRegistry`, `canvas`), and returns results back via `ipcRenderer`. |
| **MCP Client** | Claude Code / Claude Desktop / Copilot. Connects to the HTTP server. Discovers tools via the standard MCP `initialize` handshake. |

### 2.2 Data Flow (MVP)

The sequence below shows the full round-trip for the `create_model` + `add_start_event` tools:

```
1. Claude Code  →  POST /mcp  (JSON-RPC: tools/call → create_model)
2. Node.js      →  ipcMain.emit('mcp:command', { id, tool, params })
3. Chromium     →  ipcRenderer.on('mcp:command') → bpmn-js modeler.createDiagram()
4. Chromium     →  ipcRenderer.send('mcp:result', { id, success, diagramId })
5. Node.js      →  resolves HTTP response → JSON-RPC result
6. Claude Code  ←  { result: { diagramId: 'diagram-1' } }
```

### 2.3 IPC Bridge Design

Because the HTTP server and the bpmn-js API live in different processes, every tool call must cross the Electron IPC boundary. The bridge uses a promise queue to correlate async responses:

```js
// index.js (Node.js side)
const pendingCalls = new Map();

function dispatchToRenderer(tool, params) {
  return new Promise((resolve, reject) => {
    const id = uuid();
    pendingCalls.set(id, { resolve, reject });
    mainWindow.webContents.send('mcp:command', { id, tool, params });
    setTimeout(() => reject(new Error('timeout')), 10000);
  });
}

ipcMain.on('mcp:result', (event, { id, result, error }) => {
  const pending = pendingCalls.get(id);
  if (pending) { error ? pending.reject(error) : pending.resolve(result); }
  pendingCalls.delete(id);
});
```

---

## 3. Plugin File Structure

```
camunda-modeler-mcp-plugin/
├── index.js                  ← Plugin entry point (Node.js)
├── server.js                 ← MCP HTTP server + IPC bridge
├── menu.js                   ← Optional: menu entry to show server status
├── tools/
│   ├── registry.js           ← Tool definitions (name, description, inputSchema)
│   └── handlers.js           ← dispatch() router
├── client/
│   ├── client.js             ← Chromium entry: registers bpmn-js plugin + IPC listener
│   └── bpmn-tools.js         ← bpmn-js tool implementations
├── webpack.config.js         ← Bundles client/ for Chromium
└── package.json
```

> **Key constraint:** The `client/` code runs inside Chromium and cannot use Node.js modules directly. It must be bundled via webpack before the Modeler can load it. The `index.js` entry point wires both sides together on startup.

---

## 4. MCP Server (`server.js`)

### 4.1 Transport

Streamable HTTP transport (JSON-RPC 2.0 over HTTP POST). This is the current recommended MCP transport, replacing the deprecated SSE approach. Default port: **3100**, configurable via `MCP_PORT` environment variable.

### 4.2 MCP Handshake

The server must respond correctly to the MCP `initialize` request so that Claude Code auto-discovers available tools:

```json
// Request
{ "jsonrpc": "2.0", "method": "initialize", "params": { "protocolVersion": "2025-03-26" } }

// Response
{
  "result": {
    "protocolVersion": "2025-03-26",
    "serverInfo": { "name": "camunda-modeler-mcp", "version": "0.1.0" },
    "capabilities": { "tools": {} }
  }
}
```

### 4.3 Tool Discovery

```json
// Request
{ "method": "tools/list" }

// Response → returns the full tool registry (see Section 5)
```

---

## 5. Tool Registry

### 5.1 MVP Tools (v0.1)

#### `create_model`

Creates a new empty BPMN diagram in the Modeler (equivalent to File → New BPMN Diagram).

```json
{
  "name": "create_model",
  "description": "Creates a new empty BPMN diagram tab in the Camunda Desktop Modeler.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "Optional name for the diagram" }
    }
  }
}
```

**Returns:** `{ diagramId: string, message: string }`

#### `add_start_event`

Places a Start Event element on the current diagram canvas at the specified coordinates.

```json
{
  "name": "add_start_event",
  "description": "Places a BPMN Start Event on the canvas of an open diagram.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "diagramId": { "type": "string", "description": "ID returned by create_model" },
      "name":      { "type": "string", "description": "Label for the Start Event", "default": "Start" },
      "x":         { "type": "number", "description": "Canvas x coordinate", "default": 200 },
      "y":         { "type": "number", "description": "Canvas y coordinate", "default": 200 }
    },
    "required": ["diagramId"]
  }
}
```

**Returns:** `{ elementId: string, x: number, y: number }`

### 5.2 Post-MVP Tool Roadmap

These are out of scope for v0.1 but should be accounted for in the architecture — each follows the same IPC dispatch pattern:

| Tool | bpmn-js API Target |
|------|--------------------|
| `add_task` | `modeling.createShape()` with type `bpmn:UserTask` / `bpmn:ServiceTask` / etc. |
| `add_gateway` | `modeling.createShape()` with type `bpmn:ExclusiveGateway` / `bpmn:ParallelGateway` |
| `connect_elements` | `modeling.connect(sourceElement, targetElement)` |
| `set_property` | `modeling.updateProperties(element, { name: value })` |
| `get_diagram_xml` | `modeler.saveXML({ format: true })` |
| `import_xml` | `modeler.importXML(xmlString)` |
| `list_elements` | `elementRegistry.getAll()` |
| `delete_element` | `modeling.removeElements([element])` |
| `create_form` | `fs.writeFile()` — Node.js side only, no IPC needed |
| `add_form_field` | Read `.form` JSON → mutate `components[]` → write back |
| `link_form_to_task` | `modeling.updateProperties()` on UserTask + write `.form` file |

---

## 6. Client Layer (Chromium)

### 6.1 Registration

```js
// client/client.js
import { registerBpmnJSPlugin } from 'camunda-modeler-plugin-helpers';
import McpCommandHandler from './bpmn-tools';

registerBpmnJSPlugin(McpCommandHandler);
```

### 6.2 bpmn-js Module

The `McpCommandHandler` module uses bpmn-js dependency injection to access the modeling services, then listens for IPC commands from the main process:

```js
// client/bpmn-tools.js
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

### 6.3 MVP Tool Implementations

#### `create_model`

`create_model` operates at the Modeler/Tab level (file system + tab management), not the bpmn-js canvas level. It is best triggered from the **Node.js menu plugin** side rather than through the IPC bridge.

Two options, in order of preference:

1. Use the Electron `app` API or trigger the `diagram.init` event via the Modeler's internal event bus if accessible from the plugin entry point.
2. **Fallback:** Write a minimal valid `.bpmn` file to a temp path and use `shell.openPath()` to open it in the Modeler. This is reliable and doesn't depend on undocumented internal APIs.

```js
// server.js — fallback implementation for create_model
const { shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

function createModel(params) {
  const name = params.name || 'new-diagram';
  const diagramId = `diagram-${Date.now()}`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true" />
  <bpmndi:BPMNDiagram id="${diagramId}">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

  const filePath = path.join(os.tmpdir(), `${name}.bpmn`);
  fs.writeFileSync(filePath, xml, 'utf8');
  shell.openPath(filePath);
  return { diagramId, message: `Opened ${filePath}` };
}
```

#### `add_start_event`

```js
// client/bpmn-tools.js
function addStartEvent(params, { modeling, canvas }) {
  const { name = 'Start', x = 200, y = 200 } = params;
  const rootElement = canvas.getRootElement();

  const shape = modeling.createShape(
    { type: 'bpmn:StartEvent', name },
    { x, y, width: 36, height: 36 },
    rootElement
  );

  return { elementId: shape.id, x: shape.x, y: shape.y };
}
```

> **Note on the two tools:** `create_model` operates at the Modeler/Tab level (handled Node.js side) while `add_start_event` operates at the bpmn-js canvas level (requires IPC to Chromium). The MVP exercises both pathways, which validates the full architecture.

---

## 7. Plugin Entry Point (`index.js`)

```js
// index.js
const { startMcpServer } = require('./server');

module.exports = {
  name: 'Camunda Modeler MCP Plugin',
  script: './client/dist/client.js',  // bundled by webpack
  menu: './menu.js'                    // shows server status in menu bar
};

// Start the MCP HTTP server when the plugin loads
startMcpServer();
```

---

## 8. Build & Development Setup

### 8.1 Dependencies

| Package | Purpose |
|---------|---------|
| `camunda-modeler-plugin-helpers` | `registerBpmnJSPlugin`, shared React/bpmn-js utilities |
| `camunda-modeler-webpack-plugin` | Prevents double-bundling shared deps (React, etc.) |
| `express` | MCP HTTP server |
| `uuid` | Correlation IDs for IPC promise queue |
| `webpack` + `webpack-cli` | Bundle `client/` code for Chromium |

### 8.2 Build Commands

```bash
npm run build   # webpack bundles client/ → client/dist/client.js
npm run dev     # webpack --watch for iterative development
```

### 8.3 Installing into Modeler

Symlink the plugin folder into the Camunda Modeler plugins directory:

```bash
# Windows
mklink /d "%APPDATA%\camunda-modeler\resources\plugins\camunda-mcp" C:\path\to\plugin

# macOS
ln -s /path/to/plugin ~/Library/Application\ Support/camunda-modeler/resources/plugins/camunda-mcp

# Linux
ln -s /path/to/plugin ~/.config/camunda-modeler/resources/plugins/camunda-mcp
```

After symlinking, restart the Modeler. Use **F12 → Ctrl+R** to hot-reload during development without a full restart.

### 8.4 Claude Code Configuration

Add the following to your workspace `.mcp.json`:

```json
{
  "mcpServers": {
    "camunda-modeler": {
      "type": "http",
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

---

## 9. MVP Acceptance Criteria

The MVP is complete when the following sequence works end-to-end without errors:

| Step | Expected Outcome |
|------|-----------------|
| 1. Camunda Desktop Modeler is open | Plugin loads on startup; HTTP server starts on port 3100 |
| 2. Claude Code connects to the MCP server | `tools/list` returns `create_model` and `add_start_event` |
| 3. Claude Code calls `create_model` | A new empty BPMN diagram tab opens in the Modeler |
| 4. Claude Code calls `add_start_event` with the returned `diagramId` | A Start Event circle appears on the canvas at the specified coordinates |
| 5. User interacts with the placed element | Element is selectable, moveable, and shows correct properties in the panel |
| 6. File is saved | Saved `.bpmn` XML contains a valid `bpmn:StartEvent` element |

---

## 10. Known Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Plugin API is marked unstable by Camunda | Pin to a specific Modeler version; add compatibility badge to README |
| `create_model` requires Tab-level API not publicly documented | Use the temp-file fallback (see Section 6.3) — reliable and version-agnostic |
| `ipcRenderer` not accessible inside bundled bpmn-js module | Inject via Electron `contextBridge` in a preload script, or use `window.__ipc` bridge |
| Port 3100 conflicts with other local services | Make port configurable; add port-in-use detection with auto-increment fallback |
| bpmn-js API changes between Modeler versions | Abstract all bpmn-js calls behind a thin adapter layer in `bpmn-tools.js` |

---

## 11. Out of Scope (v0.1)

- DMN decision table manipulation
- Camunda Forms tools (`create_form`, `add_form_field`) — these are purely Node.js filesystem operations and can be added in v0.2 without touching the IPC bridge
- Multi-diagram support (targeting a specific named tab)
- Authentication on the MCP HTTP endpoint
- SSE / streaming transport (Streamable HTTP is sufficient for MVP)
- Deployment to Camunda 8 cluster from within the plugin

---

*camunda-modeler-mcp-plugin · v0.1 MVP Spec · Jesse Leresche · March 2026*
