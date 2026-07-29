# Camunda Desktop Modeler MCP Plugin

**v2.0.0**

> **Upgrading from v1.x?** v2.0 consolidates the tool surface from 41 tools to 12 — a **breaking change** to tool names. See [Upgrading from v1.x](#upgrading-from-v1x).

## Overview

This plugin adds an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) HTTP server to the Camunda Desktop Modeler. Once loaded, AI coding assistants such as Claude Code, Claude Desktop, and GitHub Copilot can create and manipulate BPMN diagrams and Camunda Forms inside the live Modeler through standard MCP tool calls.

The plugin ships with **12 resource-oriented tools** covering the full BPMN modeling lifecycle: placing elements (tasks, events, gateways, sub-processes), connecting them with sequence flows, configuring properties and implementation details (Camunda 7 and 8), managing I/O mappings and task headers, introspecting diagrams, and importing/exporting BPMN 2.0 XML. It also supports creating and linking Camunda Forms. Most tools select behaviour via an `operation` enum (e.g. `add_element {operation: "task"}`).

**Token-efficient features:** The `build_process` tool creates an entire process (elements + flows + auto-layout) in a single call. The `update_element {operation: "properties"}` action updates any combination of properties in one call. The `compact: true` flag on any tool strips responses to essential IDs only. The `query_diagram {operation: "list"}` action supports field selection and subprocess filtering.

**Undo/Redo support:** All tool operations integrate with the Modeler's command stack. Compound operations (`build_process`, `layout {operation: "auto"}`, `batch_operations`) are grouped into a single undo step — press Ctrl+Z once to undo an entire process build or layout change.

### Why 12 tools? (consolidated in v2.0)

Earlier versions exposed 41 fine-grained tools (`add_task`, `add_gateway`, `set_properties`, `move_element`, …). Every tool's name, description, and JSON schema is loaded into the AI agent's context on **every** turn, so a large flat toolset has real costs, documented in Anthropic's [*Writing effective tools for agents*](https://www.anthropic.com/engineering/writing-tools-for-agents):

- **Context bloat** — dozens of schemas consume tokens before any work begins.
- **Worse tool selection** — agents pick the wrong tool more often as the list grows; accuracy degrades noticeably past a few dozen tools.
- **Redundancy** — many tools were near-duplicates (`set_properties` / `patch_element` / `move_element`, `connect_elements` / `add_message_flow`).

v2.0 follows the recommended pattern: a small set of **resource-oriented tools** that each select behaviour via an `operation` enum (e.g. `add_element {operation: "task"}`). **No functionality was removed** — every v1 capability maps onto an operation of one of the 12 tools (see the [old → new mapping](#old--new-tool-mapping) below). Internally it's a thin facade: each `(tool, operation)` resolves to the original implementation, so behaviour is identical.

## Getting Started

![Getting Started — BPMN process for installing and using the plugin](docs/getting-started.png)

*This diagram was built entirely by AI using the plugin itself.*

## Architecture

![Architecture — Request flow through the two Electron processes](docs/architecture.png)

*Architecture model created with [Archi](https://www.archimatetool.com/) via the [Archi MCP Plugin](https://github.com/tobi/archi-mcp-server).*

The plugin runs across two Electron processes connected by a renderer bridge.

**Request lifecycle:**

1. MCP client sends `POST /mcp` with a JSON-RPC tool call
2. The MCP SDK routes the call to the registered tool handler, which resolves the consolidated tool + `operation` to an internal handler
3. **Local handlers** (e.g. `manage_diagram {operation: "create"}`, `create_dmn`) execute directly in Node.js
4. **Renderer handlers** (e.g. `add_element`, `connect`) are forwarded to the Chromium renderer via `webContents.executeJavaScript()`, which calls `window.__mcpDispatch()` -- a global function registered by the bpmn-js plugin module
5. The renderer calls the bpmn-js API (`modeling.createShape`, `modeling.connect`, `modeling.updateLabel`, etc.) and returns the result
6. The MCP server returns the JSON-RPC response to the client

**Why `executeJavaScript` instead of IPC?** The Camunda Modeler runs with `contextIsolation` enabled, which prevents plugin scripts from accessing `ipcRenderer`. The `executeJavaScript` bridge bypasses this by calling a global function directly from the main process.

## Available Tools

The plugin exposes **12 resource-oriented tools**. Most select behaviour via an
`operation` enum, so a single tool covers a whole family of related actions. Any
tool call can also include `compact: true` to strip the response to essential IDs
and status fields only, reducing token usage by ~80%.

### `manage_diagram` — diagram lifecycle & I/O

| `operation` | Parameters | Description |
|------|-----------|-------------|
| `create` | `name` (optional) | Creates a new empty BPMN diagram tab. Returns `{ diagramId, filePath, message }`. |
| `list` | *(none)* | Lists all open diagram tabs with IDs, names, types, file paths. |
| `switch` | `diagramId` / `filePath` / `name` (at least one) | Switches the active tab. `name` is a partial, case-insensitive match. |
| `save` | `diagramId`, `filePath` | Saves the diagram as BPMN XML to a file path. |
| `export_image` | `diagramId`, `filePath`, `format` (`png`/`svg`, default `png`), `scale` (default `2`) | Exports the diagram as a PNG or SVG image. |
| `import_xml` | `diagramId`, `xml` | Imports/replaces the diagram from BPMN 2.0 XML. |
| `get_xml` | `diagramId` | Exports the diagram as BPMN 2.0 XML. |

### `add_element` — add a single element

Common params: `diagramId`, `name`, `x`, `y`, `parentId` (nest inside an expanded subprocess).

| `operation` | Extra parameters | Description |
|------|-----------|-------------|
| `start` | — | Start Event. |
| `end` | `eventDefinitionType` (Error, Signal, Message, Terminate, …) | End Event. A non-`none` definition creates a typed end event. |
| `task` | `type` (`bpmn:UserTask`, `bpmn:ServiceTask`, `bpmn:ScriptTask`, …) | Task. |
| `gateway` | `type` (`bpmn:ExclusiveGateway`, `bpmn:ParallelGateway`, …) | Gateway. |
| `event` | `type` (intermediate/boundary), `eventDefinitionType`, `attachedToId`, `cancelActivity`, `boundaryPosition`, `timerValue`, `timerType` | Intermediate or boundary event. |
| `subprocess` | `type` (`bpmn:SubProcess`/`bpmn:CallActivity`), `width`, `height`, `collapsed`, `calledElement` | SubProcess or CallActivity. |
| `pool` | `width`, `height` | Pool (`bpmn:Participant`) for collaboration diagrams. |
| `lane` | `participantId` | Lane inside a pool. |
| `annotation` | `text`, `attachToId` (optional) | Text annotation. |
| `group` | `width`, `height`, `categoryValue` (optional) | BPMN Group artifact. |

### `connect` — sequence/message flows

| `operation` | Parameters | Description |
|------|-----------|-------------|
| `sequence_flow` | `diagramId`, `sourceId`, `targetId`, `waypoints` (optional) | Connects two elements with a sequence flow. |
| `message_flow` | `diagramId`, `sourceId`, `targetId`, `name` (optional) | Cross-pool message flow. |
| `set_waypoints` | `diagramId`, `flowId`, `waypoints` (min 2) | Replaces the routing of an existing flow without touching source/target/labels. |

### `update_element` — modify an existing element

Common params: `diagramId`, `elementId`.

| `operation` | Extra parameters | Description |
|------|-----------|-------------|
| `properties` | `name`, `documentation`, `conditionExpression`, `implementationType`, `implementationValue`, `taskTopic`, `taskPriority`, `taskType`, `taskRetries`, `isExecutable`, `x`, `y`, `waypoints` | Sets any combination of properties in one call (Camunda 7 & 8). |
| `move` | `x`, `y` | Moves the element to new center coordinates. |
| `resize` | `width`, `height` | Resizes a shape; center stays fixed. |
| `io_mapping` | `inputs`/`outputs` (arrays of `{ source, target }`) | Input/output variable mappings (Camunda 7 & 8). |
| `headers` | `headers` (array of `{ key, value }`) | Task headers. |

### `query_diagram` — read diagram state

| `operation` | Parameters | Description |
|------|-----------|-------------|
| `list` | `diagramId`, `typeFilter` (optional), `parentId` (optional), `fields` (optional) | Lists elements with optional type filter, subprocess scope, and field selection. |
| `get` | `diagramId`, `elementId` | Full detail incl. properties, extensions, connections. |
| `bounds` | `diagramId`, `elementId` | Exact rendered bounds, center, edge connection points, and waypoints. |

### `manage_element` — delete / clone

| `operation` | Parameters | Description |
|------|-----------|-------------|
| `delete` | `diagramId`, `elementId` | Removes an element. |
| `clone` | `diagramId`, `sourceId`, `name` (optional), `x`, `y`, `deep` (default `false`) | Clones an element with its config; `deep=true` also clones subprocess children. |

### `layout` — auto-layout & validation

| `operation` | Parameters | Description |
|------|-----------|-------------|
| `auto` | `diagramId`, `elementId` (optional scope), `options` (`branchSpacing`, `horizontalSpacing`, `flowRouting`, `mergeAlignment`, `boundaryEventPosition`) | Smart branch-aware auto-layout. |
| `validate` | `diagramId`, `elementId` (optional scope), `autoFix` (default `false`), `severity` (default `"warning"`) | Detects layout issues and generates/applies fixes. |

### `manage_form` — Camunda Forms

| `operation` | Parameters | Description |
|------|-----------|-------------|
| `create` | `name`, `fields` (optional) | Creates a new `.form` JSON file. Returns `{ formId, filePath, fieldCount }`. |
| `add_field` | `formPath`, `key`, `label`, `type`, `required`, `description`, `options` | Appends a field. Types: `textfield`, `textarea`, `number`, `checkbox`, `select`, `radio`, `taglist`, `datetime`. |
| `link_to_task` | `diagramId`, `taskId`, `formPath` | Links a form to a UserTask, auto-detecting Camunda 7 vs 8. |

### Standalone tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `build_process` | `diagramId`, `elements` (array), `flows` (array, optional), `autoLayout` (default `false`) | **Preferred for multi-element processes.** Creates an entire process in one call using friendly type names (`serviceTask`, `exclusiveGateway`, …) and logical IDs. Returns `{ idMap }`. |
| `batch_operations` | `diagramId`, `operations` (array of `{tool, params}`) | Executes multiple **internal primitive** operations in one undoable call. `tool` uses internal primitive names (e.g. `move_element`, `connect_elements`), not the consolidated public tool names. Use `"$ref:N"` to reference the result of operation N. |
| `create_dmn` | `name`, `tableName`, `hitPolicy` (UNIQUE/FIRST/…), `inputs`, `outputs` | Creates a DMN decision table file. |
| `deploy_process` | `filePath`, `clusterUrl`, `clientId`, `clientSecret` | Deploys a BPMN process to Camunda 8 Zeebe. Requires `ZEEBE_ADDRESS`, `ZEEBE_CLIENT_ID`, `ZEEBE_CLIENT_SECRET` env vars. |

### Authentication

Set the `MCP_API_KEY` environment variable to enable Bearer token authentication on the MCP endpoint. When set, all requests must include `Authorization: Bearer <key>`. When unset, no auth (backwards compatible).

## Prerequisites

- **Camunda Desktop Modeler** v5.x (Electron-based)
- **Node.js** >= 20 and **npm** >= 9 *(only required if building from source)*

## Installation

Pick one of the two installation paths below.

### Option A — Install from a pre-built release (no Node.js / npm required)

1. **Download the latest release archive** from the [Releases page](https://github.com/JesseLeresche/Camunda-mcp/releases/latest):

   - `camunda-mcp-v<version>.zip` (Windows / macOS)
   - `camunda-mcp-v<version>.tar.gz` (macOS / Linux)

   Each archive ships with the pre-compiled `dist/` and `client/dist/` bundles, so no build step is needed.

2. **Extract the archive** somewhere stable (e.g. `~/camunda-mcp/`). On macOS / Linux:

   ```bash
   mkdir -p ~/camunda-mcp
   tar -xzf camunda-mcp-v*.tar.gz -C ~/camunda-mcp --strip-components=1
   ```

   On Windows, right-click the `.zip` and choose **Extract All...** to `%USERPROFILE%\camunda-mcp\`.

3. **Copy (or symlink) the extracted folder into the Camunda Modeler plugins directory:**

   ```bash
   # macOS — copy
   cp -R ~/camunda-mcp ~/Library/Application\ Support/camunda-modeler/resources/plugins/camunda-mcp

   # macOS — or symlink
   ln -s ~/camunda-mcp ~/Library/Application\ Support/camunda-modeler/resources/plugins/camunda-mcp

   # Linux
   cp -R ~/camunda-mcp ~/.config/camunda-modeler/resources/plugins/camunda-mcp

   # Windows (PowerShell)
   Copy-Item -Recurse "$env:USERPROFILE\camunda-mcp" "$env:APPDATA\camunda-modeler\resources\plugins\camunda-mcp"
   ```

   If the `resources/plugins/` directory does not exist yet, create it first.

4. **Restart the Camunda Desktop Modeler.** The plugin will load automatically. Check the **Plugins** menu for "MCP Server: Running (port 3100)".

### Option B — Build from source

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

## Upgrading from v1.x

v2.0 is a **breaking change**: the v1 tool names (`add_task`, `set_properties`, `connect_elements`, …) have been removed and replaced by 12 consolidated tools. The MCP server config (URL/port) is unchanged. Follow these three steps.

### 1. Remove the old version

The new version is installed into the same `camunda-mcp` plugin folder, so remove the old one first to avoid a stale bundle.

1. **Quit the Camunda Desktop Modeler** (fully closed, not just the window).
2. **Delete (or unlink) the existing plugin folder:**

   ```bash
   # macOS
   rm -rf ~/Library/Application\ Support/camunda-modeler/resources/plugins/camunda-mcp

   # Linux
   rm -rf ~/.config/camunda-modeler/resources/plugins/camunda-mcp

   # Windows (PowerShell)
   Remove-Item -Recurse -Force "$env:APPDATA\camunda-modeler\resources\plugins\camunda-mcp"
   ```

   > If you installed via a **symlink** (Option B / build-from-source), this only removes the link, not your source checkout. You can also just `unlink` the path instead of `rm -rf`.

### 2. Install v2.0

Follow [Option A](#option-a--install-from-a-pre-built-release-no-nodejs--npm-required) (pre-built release) or [Option B](#option-b--build-from-source) above to install the new version into the plugin folder, then **restart the Modeler**. Confirm the **Plugins** menu shows "MCP Server: Running (port 3100)".

If you built from source, pull and rebuild instead of re-cloning:

```bash
cd Camunda-mcp
git pull
npm install
npm run build
# the existing symlink already points here — just restart the Modeler
```

### 3. Update your prompts and automation

Any saved prompts, scripts, or `autoApprove` lists that reference v1 tool names must be updated to the consolidated tools. Most v1 tools become an `operation` on a v2 tool.

#### Old → new tool mapping

| v1 tool(s) | v2 call |
|---|---|
| `create_model` | `manage_diagram {operation: "create"}` |
| `list_open_diagrams` | `manage_diagram {operation: "list"}` |
| `switch_diagram` | `manage_diagram {operation: "switch"}` |
| `save_diagram` | `manage_diagram {operation: "save"}` |
| `export_image` | `manage_diagram {operation: "export_image"}` |
| `import_xml` | `manage_diagram {operation: "import_xml"}` |
| `get_diagram_xml` | `manage_diagram {operation: "get_xml"}` |
| `add_start_event` | `add_element {operation: "start"}` |
| `add_end_event` / `add_end_event_typed` | `add_element {operation: "end"}` |
| `add_task` | `add_element {operation: "task", type: "bpmn:…"}` |
| `add_gateway` | `add_element {operation: "gateway", type: "bpmn:…"}` |
| `add_event` | `add_element {operation: "event"}` |
| `add_subprocess` | `add_element {operation: "subprocess"}` |
| `add_participant` | `add_element {operation: "pool"}` |
| `add_lane` | `add_element {operation: "lane"}` |
| `add_annotation` | `add_element {operation: "annotation"}` |
| `add_group` | `add_element {operation: "group"}` |
| `connect_elements` | `connect {operation: "sequence_flow"}` |
| `add_message_flow` | `connect {operation: "message_flow"}` |
| `set_flow_waypoints` | `connect {operation: "set_waypoints"}` |
| `set_properties` / `patch_element` | `update_element {operation: "properties"}` |
| `move_element` | `update_element {operation: "move"}` |
| `resize_element` | `update_element {operation: "resize"}` |
| `set_io_mapping` | `update_element {operation: "io_mapping"}` |
| `set_task_headers` | `update_element {operation: "headers"}` |
| `list_elements` | `query_diagram {operation: "list"}` |
| `get_element` | `query_diagram {operation: "get"}` |
| `get_element_bounds` | `query_diagram {operation: "bounds"}` |
| `delete_element` | `manage_element {operation: "delete"}` |
| `clone_element` | `manage_element {operation: "clone"}` |
| `auto_layout` | `layout {operation: "auto"}` |
| `validate_layout` | `layout {operation: "validate"}` |
| `create_form` | `manage_form {operation: "create"}` |
| `add_form_field` | `manage_form {operation: "add_field"}` |
| `link_form_to_task` | `manage_form {operation: "link_to_task"}` |
| `build_process` | `build_process` *(unchanged)* |
| `batch_operations` | `batch_operations` *(unchanged — still uses internal primitive names in its `operations[].tool` field)* |
| `create_dmn` | `create_dmn` *(unchanged)* |
| `deploy_process` | `deploy_process` *(unchanged)* |

All other parameters keep the same names — only the tool name and the new `operation` selector change. See [Available Tools](#available-tools) for the full per-operation parameter reference.

## MCP Client Configuration

### Claude Code / Claude Desktop

Add the following to your project's `.mcp.json`:

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

### Kiro

Add the following to your Kiro MCP config (`~/.kiro/settings/mcp.json` for user-level, or `.kiro/settings/mcp.json` in the workspace root):

```json
{
  "mcpServers": {
    "camunda-modeler": {
      "type": "http",
      "url": "http://localhost:3100/mcp",
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Set `disabled: true` to temporarily turn the server off without removing the entry. Populate `autoApprove` with tool names (e.g. `["query_diagram"]`) to skip the approval prompt for safe, read-only calls.

### Port configuration

The port defaults to `3100` and can be changed by setting the `MCP_PORT` environment variable before launching the Modeler. If port 3100 is in use, the server automatically retries up to 3 consecutive ports (3100, 3101, 3102).

## Development

### Watch mode

Run both the TypeScript compiler and webpack in watch mode for iterative development:

```bash
npm run dev
```

After making changes, hot-reload inside the Modeler with **F12** (open DevTools) then **Cmd+R**. A full Modeler restart is only needed when server-side tool registrations change.

### Adding new tools

Tool implementations are split across a few layers:

1. **Schema** -- Define a Zod input schema in `src/tools/schemas/primitives.ts` (internal per-tool schemas) or `src/tools/schemas/public.ts` (one of the 9 consolidated public tools). `src/tools/registry.ts` is a thin barrel re-exporting both, so no changes are needed there.

2. **Routing** -- For a new `operation` on an existing consolidated tool, add it to the relevant schema plus a `FACADE` map entry in `src/tools/handlers/facade.ts`. Add the schema to the `SCHEMA_BY_TOOL` lookup in `src/tools/handlers.ts` so params get validated before dispatch. Local (Node.js-side) tools are implemented in `src/tools/handlers/local-tools.ts`; renderer tools are forwarded via `ipcBridge(toolName, params)`.

3. **Renderer implementation** -- For renderer tools, implement the bpmn-js API call in the relevant file under `client/elements/` (`create.ts`, `mutate.ts`, `query.ts`, `forms.ts`), `client/diagram-io.ts`, or `client/batch.ts`, using the injected services: `modeling`, `elementRegistry`, `canvas`, `moddle`, `bpmnFactory`, `injector`. Then register it in the `TOOL_HANDLERS` lookup (and `SYNC_TOOL_NAMES` if it should be callable inside a compound command) in `client/bpmn-tools.ts`.

## Project Structure

```
camunda-mcp/
├── index.js                        # Plugin entry point (plain JS, required by Modeler)
├── menu.js                         # Menu plugin (plain JS, shows server status)
├── package.json                    # Dependencies and build scripts
├── tsconfig.json                   # TypeScript config for Node.js side (src/ -> dist/)
├── webpack.config.js               # Webpack config: bundles client/ -> client/dist/client.js
├── dev/
│   └── layout-tests.ts             # Standalone dev harness for tuning auto-layout options (npm run layout:test)
├── src/
│   ├── server.ts                   # MCP HTTP server (Express + SDK)
│   ├── renderer-bridge.ts          # Electron executeJavaScript() bridge to the renderer
│   ├── menu.ts                     # Menu status tracking (updateMenuStatus, getMenuLabel)
│   └── tools/
│       ├── registry.ts             # Thin barrel: re-exports schemas/primitives.ts + schemas/public.ts
│       ├── schemas/
│       │   ├── primitives.ts       # Internal per-tool Zod schemas
│       │   └── public.ts           # The 9 consolidated public tool schemas + tools[] listing
│       ├── handlers.ts             # dispatch() + ipcBridge wiring + SCHEMA_BY_TOOL lookup
│       └── handlers/
│           ├── local-tools.ts      # Node.js-side tools (createModel, createForm, addFormField, createDmn, deployProcess)
│           ├── tabs.ts             # Tab management (listOpenDiagrams, switchDiagram)
│           ├── facade.ts           # FACADE map + resolveFacade (public tool+operation -> internal tool name)
│           └── compact.ts          # compactResult (the `compact: true` response trimming)
├── client/
│   ├── tsconfig.json                # TypeScript config for the renderer side, discoverable by editors opening any client/*.ts file directly
│   ├── client.ts                   # Renderer entry: registers bpmn-js plugin + tab manager
│   ├── bpmn-tools.ts               # Dispatch hub: TOOL_HANDLERS lookup, dispatchRendererTool(Sync)
│   ├── element-shared.ts           # Shared element-building helpers (used by elements/ and layout/)
│   ├── elements/
│   │   ├── create.ts               # add* element-creation tools
│   │   ├── mutate.ts               # set*/resize/move/clone/delete/patch tools
│   │   ├── query.ts                # list_elements, get_element, get_element_bounds
│   │   └── forms.ts                # linkFormToTask (Camunda 7 & 8)
│   ├── diagram-io.ts                # get/import/save/export_image, validate_diagram
│   ├── batch.ts                     # batch_operations
│   ├── layout/                      # bpmn-auto-layout pipeline (build_process, auto_layout)
│   │   ├── bo-builders.ts, post-process.ts, composition.ts, subtree.ts,
│   │   └── pool-boundary.ts, build-process.ts, auto-layout.ts
│   ├── validate-layout.ts          # layout {operation: "validate"} advisory + auto-fix
│   ├── tab-manager.ts              # Client extension for tab tracking and switching
│   ├── types.d.ts                  # Type declarations for camunda-modeler-plugin-helpers + React
│   ├── __tests__/                  # Vitest unit tests for the layout/composition subsystem
│   └── dist/
│       └── client.js               # Webpack output (generated, not checked in)
└── dist/                           # tsc output (generated, not checked in)
```

## Known Limitations

- **`diagramId` is informational only.** Renderer tools operate on the currently active diagram tab regardless of the `diagramId` parameter. Use `switch_diagram` to activate the correct tab before calling renderer tools.
- **Tab discovery is incremental.** `list_open_diagrams` only returns tabs that have been focused at least once since the plugin loaded. Switch to a tab to register it.
- **Authentication is optional.** Set `MCP_API_KEY` env var to enable Bearer token auth. Without it, the server is open on localhost.
- **Single-window support.** The renderer bridge targets `BrowserWindow.getAllWindows()[0]`.
- **Form linking in Camunda 8 mode.** Embedding forms via `zeebe:UserTaskForm` depends on the Modeler's moddle extensions. Falls back to `formId` reference if unavailable.
- **Port conflicts.** The server retries up to 3 ports. If all are in use, startup fails.
- **Streaming transport:** The server currently uses stateless Streamable HTTP. Server-Sent Events for real-time diagram change notifications is planned for a future release.

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
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"manage_diagram","arguments":{"operation":"create","name":"test"}},"id":3}'

# Add a start event
curl -s -X POST http://localhost:3100/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"add_element","arguments":{"operation":"start","diagramId":"d","name":"Begin","x":200,"y":200}},"id":4}'
```

### Full E2E workflow test

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Open Camunda Desktop Modeler | Plugin loads. HTTP server on port 3100. Plugins menu shows status. |
| 2 | `manage_diagram {operation: "create"}` | New empty BPMN diagram tab opens. |
| 3 | `add_element {operation: "start"}` | Start Event circle appears with label. |
| 4 | `add_element {operation: "task", type: "bpmn:UserTask"}` ("Review Request") | User Task rectangle appears with label. |
| 5 | `add_element {operation: "gateway", type: "bpmn:ExclusiveGateway"}` ("Approved?") | Gateway diamond appears with label. |
| 6 | `add_element {operation: "task", type: "bpmn:ServiceTask"}` ("Process Order") | Service Task rectangle appears. |
| 7 | `add_element {operation: "task", type: "bpmn:ServiceTask"}` ("Send Rejection") | Second Service Task appears. |
| 8 | `add_element {operation: "end"}` (x2, "Done" and "Rejected") | Two End Events appear. |
| 9 | `connect {operation: "sequence_flow"}` (Start -> UserTask -> Gateway, Gateway -> each branch -> End Events) | Sequence flows connect all elements. |
| 10 | `update_element {operation: "properties"}` (conditionExpression on gateway outgoing flows) | Conditions appear on sequence flows in properties panel. |
| 11 | `update_element {operation: "properties"}` (taskType: "order-processing" on ServiceTask) | Zeebe job type set on ServiceTask. |
| 12 | `update_element {operation: "io_mapping"}` (inputs/outputs on ServiceTask) | I/O mappings visible in properties panel. |
| 13 | `update_element {operation: "headers"}` (headers on ServiceTask) | Task headers visible in properties panel. |
| 14 | `manage_form {operation: "create"}` with fields | `.form` file created with field definitions. |
| 15 | `manage_form {operation: "link_to_task"}` | Form linked to UserTask (visible in properties panel). |
| 16 | `query_diagram {operation: "list"}` | Returns all elements with correct types. |
| 17 | `query_diagram {operation: "get"}` (on the gateway) | Returns gateway details including connections. |
| 18 | `manage_diagram {operation: "get_xml"}` | Returns valid BPMN 2.0 XML with all elements and extensions. |
| 19 | Save diagram | `.bpmn` XML contains all elements, conditions, and form reference. |

## License

MIT
