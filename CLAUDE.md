# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## BPMN Modeling Guidelines

**Always read `BPMN-BEST-PRACTICES.md` before creating or modifying any BPMN diagram.** It contains critical rules about coordinate systems, flow routing, and layout patterns that must be followed.

**When the user requests a layout improvement or correction to a BPMN model, update `BPMN-BEST-PRACTICES.md` with the new guideline so it is captured for future use.**

## Project Overview

Camunda Desktop Modeler MCP plugin — exposes an MCP (Model Context Protocol) HTTP server so AI coding assistants can create and manipulate BPMN models inside the live Desktop Modeler.

## Architecture

Two-process Electron plugin:

- **Node.js main process** (`index.js`, `dist/`, `menu.js`): MCP HTTP server on port 3100 (configurable via `MCP_PORT`). Receives JSON-RPC 2.0 tool calls. Local tools (e.g. `create_model`, `create_form`, `create_dmn`) execute here directly; renderer tools are forwarded via `webContents.executeJavaScript()`.
- **Chromium renderer process** (`client/`): Bundled bpmn-js plugin registered via `camunda-modeler-plugin-helpers`. Exposes `window.__mcpDispatch()` which the main process calls. Uses bpmn-js DI injection for `modeling`, `elementRegistry`, `canvas`, `moddle`, `bpmnFactory`, `injector`.

Renderer bridge pattern: main process calls `webContents.executeJavaScript('window.__mcpDispatch(tool, params)')` and awaits the result with a 10s timeout. This bypasses Electron's `contextIsolation` which blocks `ipcRenderer` access.

## Build Commands

```bash
npm run build   # webpack bundles client/ → client/dist/client.js
npm run dev     # webpack --watch for iterative development
```

## Installing into Modeler

Symlink plugin folder into Camunda Modeler plugins directory:

```bash
# macOS
ln -s /path/to/plugin ~/Library/Application\ Support/camunda-modeler/resources/plugins/camunda-mcp
```

Hot-reload during development: **F12 → Ctrl+R** (no full restart needed).

## MCP Client Configuration

Add to `.mcp.json`:

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

## Key Constraints

- `client/` code runs in Chromium — cannot use Node.js modules directly; must be webpack-bundled.
- `ipcRenderer` access may require `contextBridge` or a `window.__ipc` bridge depending on Modeler's preload config.
- `create_model` operates at the Modeler/Tab level (Node.js side); canvas-level tools like `add_start_event` require IPC to Chromium.
- The public MCP surface is **12 consolidated, resource-oriented tools** (`manage_diagram`, `add_element`, `connect`, `update_element`, `query_diagram`, `manage_element`, `layout`, `manage_form`, plus standalone `build_process`, `batch_operations`, `create_dmn`, `deploy_process`). Most select behaviour via an `operation` enum.
- **Facade architecture:** consolidated tools are a thin layer. `resolveFacade()` in `src/tools/handlers/facade.ts` maps `(publicTool, operation)` → an internal tool name (e.g. `add_element {operation:"task"}` → `add_task`); the internal `SCHEMA_BY_TOOL` dispatch lookup (`src/tools/handlers.ts`) and the renderer implementations keyed on `TOOL_HANDLERS`/`SYNC_TOOL_NAMES` (`client/bpmn-tools.ts`) are keyed on those internal names and stay untouched. Internal per-operation Zod schemas in `src/tools/schemas/primitives.ts` (public/consolidated schemas in `src/tools/schemas/public.ts`, re-exported via the `src/tools/registry.ts` barrel) remain the source of truth for validation.
- **To add a capability:** add an `operation` value to the relevant consolidated schema in `src/tools/schemas/public.ts` + its `FACADE` map entry in `src/tools/handlers/facade.ts`, then implement the internal handler the usual way — internal Zod schema in `src/tools/schemas/primitives.ts`, a `SCHEMA_BY_TOOL` entry in `src/tools/handlers.ts`, and the bpmn-js implementation in the relevant `client/elements/*.ts` / `client/diagram-io.ts` / `client/batch.ts` file registered in `TOOL_HANDLERS` (and `SYNC_TOOL_NAMES` if it should be sync-dispatchable) in `client/bpmn-tools.ts`. The renderer keeps using internal tool names.
- `batch_operations` runs in the renderer and its `operations[].tool` field references **internal primitive names** (e.g. `move_element`), not the consolidated public names.

## Dependencies

- `camunda-modeler-plugin-helpers` — plugin registration
- `camunda-modeler-webpack-plugin` — prevents double-bundling shared deps (React, etc.)
- `express` — HTTP server
- `uuid` — IPC correlation IDs
- `webpack` + `webpack-cli` — client bundling
