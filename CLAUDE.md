# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Camunda Desktop Modeler MCP plugin — exposes an MCP (Model Context Protocol) HTTP server so AI coding assistants can create and manipulate BPMN models inside the live Desktop Modeler. The architecture mirrors the Archi MCP plugin, adapted for Electron/bpmn-js.

## Architecture

Two-process Electron plugin:

- **Node.js main process** (`index.js`, `server.js`, `tools/`): MCP HTTP server on port 3100 (configurable via `MCP_PORT`). Receives JSON-RPC 2.0 tool calls. Some tools (e.g. `create_model`) execute here directly; others are forwarded to the renderer via Electron IPC with a promise-based correlation queue.
- **Chromium renderer process** (`client/`): Bundled bpmn-js plugin registered via `camunda-modeler-plugin-helpers`. Receives IPC commands, calls bpmn-js Modeler API (`modeling`, `elementRegistry`, `canvas`), returns results via `ipcRenderer`.

IPC bridge pattern: main process sends `mcp:command` with a UUID, renderer executes and replies on `mcp:result`. The promise queue in `server.js` correlates responses with a 10s timeout.

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
