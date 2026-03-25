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
- All new tools follow the same IPC dispatch pattern: register in `tools/registry.js`, route in `tools/handlers.js`, implement bpmn-js calls in `client/bpmn-tools.js`.

## Dependencies

- `camunda-modeler-plugin-helpers` — plugin registration
- `camunda-modeler-webpack-plugin` — prevents double-bundling shared deps (React, etc.)
- `express` — HTTP server
- `uuid` — IPC correlation IDs
- `webpack` + `webpack-cli` — client bundling
