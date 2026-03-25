# Camunda Desktop Modeler MCP Plugin

**v0.1.0**

## Overview

This plugin adds an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) HTTP server to the Camunda Desktop Modeler. Once loaded, AI coding assistants such as Claude Code, Claude Desktop, and GitHub Copilot can create and manipulate BPMN diagrams and Camunda Forms inside the live Modeler through standard MCP tool calls.

The plugin ships with tools for building complete BPMN workflows (start events, tasks, end events, sequence flows) and creating/editing Camunda Forms with field definitions.

## Architecture

The plugin runs across two Electron processes connected by a renderer bridge:

```
MCP Client (Claude Code / Copilot)
        |
        |  HTTP POST (JSON-RPC 2.0)
        v
+--------------------------+
|  Node.js Main Process    |
|  Express on 127.0.0.1    |
|  port 3100               |
|                          |
|  MCP Server (SDK)        |
|  Tool Registry (Zod)     |
+-----------+--------------+
            |
            |  webContents.executeJavaScript()
            |  window.__mcpDispatch()
            v
+--------------------------+
|  Chromium Renderer       |
|  bpmn-js Plugin Module   |
|  McpCommandHandler (DI)  |
|  modeling, canvas,       |
|  elementRegistry, moddle |
+--------------------------+
```

**Request lifecycle:**

1. MCP client sends `POST /mcp` with a JSON-RPC tool call
2. The MCP SDK routes the call to the registered tool handler
3. **Local tools** (e.g. `create_model`, `create_form`) execute directly in Node.js
4. **Renderer tools** (e.g. `add_start_event`, `add_task`) are forwarded to the Chromium renderer via `webContents.executeJavaScript()`, which calls `window.__mcpDispatch()` -- a global function registered by the bpmn-js plugin module
5. The renderer calls the bpmn-js API (`modeling.createShape`, `modeling.connect`, `modeling.updateLabel`, etc.) and returns the result
6. The MCP server returns the JSON-RPC response to the client

**Why `executeJavaScript` instead of IPC?** The Camunda Modeler runs with `contextIsolation` enabled, which prevents plugin scripts from accessing `ipcRenderer`. The `executeJavaScript` bridge bypasses this by calling a global function directly from the main process.

## Available Tools

### BPMN Diagram Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `create_model` | `name` (string, optional) | Creates a new empty BPMN diagram. Writes minimal BPMN XML to a temp file and opens it in the Modeler. Returns `{ diagramId, filePath, message }`. |
| `add_start_event` | `diagramId`, `name` (default `"Start"`), `x` (default `200`), `y` (default `200`) | Places a BPMN Start Event on the canvas. Returns `{ elementId, name, x, y }`. |
| `add_task` | `diagramId`, `type` (default `"bpmn:Task"`), `name`, `x` (default `400`), `y` (default `200`) | Places a BPMN Task on the canvas. Supported types: `bpmn:UserTask`, `bpmn:ServiceTask`, `bpmn:Task`, `bpmn:SendTask`, `bpmn:ReceiveTask`, `bpmn:ScriptTask`, `bpmn:BusinessRuleTask`, `bpmn:ManualTask`. Returns `{ elementId, type, name, x, y }`. |
| `add_end_event` | `diagramId`, `name`, `x` (default `600`), `y` (default `200`) | Places a BPMN End Event on the canvas. Returns `{ elementId, name, x, y }`. |
| `connect_elements` | `diagramId`, `sourceId`, `targetId` | Connects two BPMN elements with a sequence flow. Returns `{ connectionId, sourceId, targetId }`. |

### Camunda Forms Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `create_form` | `name`, `fields` (optional array of field definitions) | Creates a new Camunda Form (`.form`) JSON file. Each field has `key`, `label`, `type`, `required`, `description`, and `options` (for select/radio). Returns `{ formId, filePath, fieldCount }`. |
| `add_form_field` | `formPath`, `key`, `label`, `type` (default `"textfield"`), `required`, `description`, `options` | Adds a field to an existing `.form` file. Supported types: `textfield`, `textarea`, `number`, `checkbox`, `select`, `radio`, `taglist`, `datetime`. Returns `{ fieldId, key, fieldCount }`. |
| `link_form_to_task` | `diagramId`, `taskId`, `formPath` | Links a Camunda Form to a UserTask in the BPMN model. Auto-detects Camunda 8 (Zeebe) or Camunda 7 (Platform) mode and sets the appropriate extension elements. Returns `{ taskId, formId, mode }`. |

## Prerequisites

- **Camunda Desktop Modeler** v5.x (Electron-based)
- **Node.js** >= 18
- **npm** >= 9

## Installation

1. **Clone and install dependencies:**

   ```bash
   git clone https://github.com/JesseLeresche/Camunda-mcp.git
   cd Camunda-mcp
   npm install
   ```

2. **Build the plugin:**

   ```bash
   npm run build
   ```

   This runs two compilation steps:
   - `tsc` compiles the Node.js-side TypeScript (`src/`) to `dist/`
   - `webpack` bundles the renderer-side TypeScript (`client/`) to `client/dist/client.js`

3. **Symlink into the Camunda Modeler plugins directory:**

   ```bash
   # macOS
   ln -s "$(pwd)" ~/Library/Application\ Support/camunda-modeler/resources/plugins/camunda-mcp

   # Linux
   ln -s "$(pwd)" ~/.config/camunda-modeler/resources/plugins/camunda-mcp

   # Windows (run as Administrator)
   mklink /d "%APPDATA%\camunda-modeler\resources\plugins\camunda-mcp" C:\path\to\Camunda-mcp
   ```

4. **Restart the Camunda Desktop Modeler.** The plugin will load automatically. Check the **Plugins** menu for "MCP Server: Running (port 3100)".

## MCP Client Configuration

Add the following to your project's `.mcp.json` (Claude Code / Claude Desktop):

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

The port defaults to `3100` and can be changed by setting the `MCP_PORT` environment variable before launching the Modeler. If port 3100 is in use, the server automatically retries up to 3 consecutive ports (3100, 3101, 3102).

## Development

### Watch mode

Run both the TypeScript compiler and webpack in watch mode for iterative development:

```bash
npm run dev
```

After making changes, hot-reload inside the Modeler with **F12** (open DevTools) then **Cmd+R**. A full Modeler restart is only needed when server-side tool registrations change.

### Adding new tools

Every tool follows the same pattern across three files:

1. **`src/tools/registry.ts`** -- Define a Zod input schema and add a `ToolDefinition` entry to the `tools` array. Set `executeLocal: true` for Node.js-side tools or `executeLocal: false` for tools that need bpmn-js API access.

2. **`src/tools/handlers.ts`** -- Add a `case` to the `dispatch()` switch. Local tools implement their logic here directly. Renderer tools forward via `ipcBridge(toolName, params)`.

3. **`client/bpmn-tools.ts`** -- For renderer tools, add a `case` to `dispatchRendererTool()` and implement the bpmn-js API call using the injected services: `modeling`, `elementRegistry`, `canvas`, `moddle`, `bpmnFactory`.

## Project Structure

```
camunda-mcp/
├── index.js                        # Plugin entry point (plain JS, required by Modeler)
├── menu.js                         # Menu plugin (plain JS, shows server status)
├── package.json                    # Dependencies and build scripts
├── tsconfig.json                   # TypeScript config for Node.js side (src/ -> dist/)
├── tsconfig.client.json            # TypeScript config for renderer side (client/)
├── webpack.config.js               # Webpack config: bundles client/ -> client/dist/client.js
├── src/
│   ├── server.ts                   # MCP HTTP server (Express + SDK) + renderer bridge
│   ├── menu.ts                     # Menu status tracking (updateMenuStatus, getMenuLabel)
│   └── tools/
│       ├── registry.ts             # Tool definitions with Zod input schemas
│       └── handlers.ts             # Dispatch router + local tool handlers (createModel, createForm, addFormField)
├── client/
│   ├── client.ts                   # Renderer entry: registers bpmn-js plugin
│   ├── bpmn-tools.ts               # bpmn-js DI module, renderer tool implementations
│   ├── types.d.ts                  # Type declarations for camunda-modeler-plugin-helpers
│   └── dist/
│       └── client.js               # Webpack output (generated, not checked in)
└── dist/                           # tsc output (generated, not checked in)
```

## Known Limitations

- **`diagramId` is informational only.** Renderer tools operate on the currently active diagram tab regardless of the `diagramId` parameter.
- **No authentication.** The MCP server binds to `127.0.0.1` (localhost only) with no auth.
- **Single-window support.** The renderer bridge targets `BrowserWindow.getAllWindows()[0]`.
- **Form linking in Camunda 8 mode.** Embedding forms via `zeebe:UserTaskForm` depends on the Modeler's moddle extensions. Falls back to `formId` reference if unavailable.
- **Port conflicts.** The server retries up to 3 ports. If all are in use, startup fails.

## Verification / Testing

### Quick smoke test

After installing and starting the Modeler, verify with curl (note: `Accept` header must include `text/event-stream`):

```bash
# Initialize
curl -s -X POST http://localhost:3100/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'

# List tools
curl -s -X POST http://localhost:3100/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'

# Create a diagram
curl -s -X POST http://localhost:3100/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"create_model","arguments":{"name":"test"}},"id":3}'

# Add a start event
curl -s -X POST http://localhost:3100/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"add_start_event","arguments":{"diagramId":"d","name":"Begin","x":200,"y":200}},"id":4}'
```

### Full E2E workflow test

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Open Camunda Desktop Modeler | Plugin loads. HTTP server on port 3100. Plugins menu shows status. |
| 2 | `create_model` | New empty BPMN diagram tab opens. |
| 3 | `add_start_event` | Start Event circle appears with label. |
| 4 | `add_task` (UserTask) | User Task rectangle appears with label. |
| 5 | `add_task` (ServiceTask) | Service Task rectangle appears with label. |
| 6 | `add_end_event` | End Event circle appears with label. |
| 7 | `connect_elements` (x3) | Sequence flow arrows connect all elements. |
| 8 | `create_form` with fields | `.form` file created with field definitions. |
| 9 | `link_form_to_task` | Form linked to UserTask (visible in properties panel). |
| 10 | Save diagram | `.bpmn` XML contains all elements and form reference. |

## License

MIT
