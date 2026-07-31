# Camunda-MCP — Architecture

Full picture of the plugin: what it's for, how the two Electron processes talk to each other, how
a tool call actually gets from an MCP client to the live diagram, and how the knowledge base fits
into all of it. For a deep dive on the knowledge base specifically (component-by-component, with
its own diagrams and the editable Archi model), see
[`docs/kb-architecture/architecture.md`](./kb-architecture/architecture.md).

## Purpose

A Camunda Desktop Modeler plugin that adds an [MCP](https://modelcontextprotocol.io/) HTTP server
to the running Modeler application. Once loaded, an MCP client (Claude Code, Claude Desktop,
GitHub Copilot, or any other MCP-compliant agent) can create and manipulate BPMN diagrams and
Camunda Forms inside the *live* Modeler, in real time, through standard MCP tool calls — plus,
now, search a knowledge base of guidance and reference material before acting.

## Two-process Electron architecture

![Architecture — Request flow through the two Electron processes](./architecture.png)

*(This diagram predates both the #18 module-structure refactor and the knowledge base — the
overall two-process shape and request lifecycle it shows are still accurate, but "Tool Registry"
and "bpmn-js Plugin Module" are now simplifications of a more detailed internal structure; see the
breakdowns below and the knowledge base diagrams for the current, precise picture.)*

The plugin runs across two Electron processes, connected by a renderer bridge:

- **Node.js main process** (`index.js`, `dist/`, `menu.js`) — runs the MCP HTTP server on port
  3100 (configurable via `MCP_PORT`), receives JSON-RPC 2.0 tool calls, and executes local tools
  directly.
- **Chromium renderer process** (`client/`) — a bundled bpmn-js plugin registered via
  `camunda-modeler-plugin-helpers`, with direct access to the live diagram through bpmn-js's own
  dependency-injected services (`modeling`, `elementRegistry`, `canvas`, `moddle`, `bpmnFactory`,
  `injector`).

**Why not just use Electron IPC?** The Modeler runs with `contextIsolation` enabled, which blocks
plugin scripts from accessing `ipcRenderer` directly. Instead, the main process calls
`webContents.executeJavaScript('window.__mcpDispatch(tool, params)')` — a global function the
renderer process registers — and awaits the result with a timeout. This bypasses the isolation
without needing a preload-script contract.

### Request lifecycle

1. An MCP client sends `POST /mcp` with a JSON-RPC tool call.
2. The MCP SDK routes the call to the registered tool handler.
3. **Facade Routing** (`src/tools/handlers/facade.ts`'s `resolveFacade()`) maps the public
   consolidated tool + `operation` (e.g. `add_element {operation:"task"}`) to its internal tool
   name (`add_task`).
4. **Tool Schemas** (`SCHEMA_BY_TOOL` in `src/tools/handlers.ts`, backed by
   `src/tools/schemas/{primitives,public}.ts`) validates the params against the correct internal
   Zod schema.
5. **Local tools** (`manage_diagram {operation:"create"}`, `create_dmn`, `create_form`,
   `deploy_process`) execute directly in Node.js via `src/tools/handlers/local-tools.ts`.
   **Renderer tools** (`add_element`, `connect`, most BPMN modeling operations) are forwarded to
   the Chromium renderer through `src/renderer-bridge.ts`.
6. The renderer's dispatch hub (`client/bpmn-tools.ts`'s `TOOL_HANDLERS` lookup) routes to the
   actual bpmn-js implementation, which calls the bpmn-js API (`modeling.createShape`,
   `modeling.connect`, `modeling.updateLabel`, etc.) against the live diagram.
7. The result flows back through the same chain to the MCP client.

## Node.js main process (`src/`)

- **`server.ts`** — the MCP HTTP server itself (Express + `@modelcontextprotocol/sdk`). Builds a
  fresh `McpServer` per request (stateless mode) and registers every tool and resource on it.
- **`renderer-bridge.ts`** — the `executeJavaScript()` bridge described above; owns dispatch
  timeouts and per-tool timeout overrides.
- **`menu.ts`** — tray/menu status tracking (server running/stopped indicator).
- **`tools/registry.ts`** — a thin barrel, `export * from './schemas/primitives'` +
  `export * from './schemas/public'`.
- **`tools/schemas/primitives.ts`** — internal per-tool Zod schemas (one per fine-grained
  operation).
- **`tools/schemas/public.ts`** — the 9 consolidated public tool schemas plus the `tools[]`
  listing the server actually registers.
- **`tools/handlers.ts`** — `dispatch()`, the `ipcBridge` wiring, and the `SCHEMA_BY_TOOL` lookup.
- **`tools/handlers/facade.ts`** — the `FACADE` map + `resolveFacade()` (public tool+operation →
  internal tool name).
- **`tools/handlers/local-tools.ts`** — Node.js-side tool implementations that never touch the
  renderer: `createModel`, `createForm`, `addFormField`, `createDmn`, `deployProcess`.
- **`tools/handlers/tabs.ts`** — tab management (`listOpenDiagrams`, `switchDiagram`).
- **`tools/handlers/compact.ts`** — `compactResult`, the `compact: true` response-trimming option
  available on every tool.

## Chromium renderer process (`client/`)

- **`bpmn-tools.ts`** — the dispatch hub. Holds the `TOOL_HANDLERS` lookup (and `SYNC_TOOL_NAMES`
  for tools callable inside a compound undo-step) that every renderer tool call routes through.
- **`element-shared.ts`** — bpmn-js helpers shared by `elements/` and `layout/` (e.g.
  `resolveParent`, which is collaboration/pool-aware).
- **`elements/create.ts` / `mutate.ts` / `query.ts` / `forms.ts`** — the actual `add*`/`set*`/
  `list*`/form-linking implementations, each calling the injected bpmn-js services directly.
- **`diagram-io.ts`** — get/import/save/export-image, and diagram validation.
- **`batch.ts`** — `batch_operations`, which runs a sequence of internal primitive tool calls
  (referenced by internal name, not consolidated public name) as one grouped undo step.
- **`layout/`** — the `bpmn-auto-layout`-based pipeline behind `build_process` and
  `layout {operation:"auto"}`: `bo-builders.ts`, `post-process.ts`, `composition.ts` (pool/lane
  composition), `subtree.ts`, `pool-boundary.ts`, `build-process.ts`, `auto-layout.ts`.
- **`validate-layout.ts`** — `layout {operation:"validate"}`'s advisory checks and auto-fixes.
- **`tab-manager.ts`** — tracks and switches between open diagram tabs.
- **`types.d.ts`** — ambient type declarations for `camunda-modeler-plugin-helpers` + React.
- **`__tests__/`** — Vitest unit tests, mainly covering the `layout/` composition subsystem.

## The 12 consolidated public tools

`manage_diagram`, `add_element`, `connect`, `update_element`, `query_diagram`, `manage_element`,
`layout`, `manage_form`, plus standalone `build_process`, `batch_operations`, `create_dmn`,
`deploy_process`. Most select behaviour via an `operation` enum rather than exposing one tool per
fine-grained action — collapsed from 41 tools in v1 specifically to reduce the context cost and
tool-selection error rate that comes with a large flat tool list (see the main
[README](../README.md#why-12-tools-consolidated-in-v20) for the full rationale). Internally, every
consolidated tool is a thin facade over the original fine-grained implementation — see
**Request lifecycle** above.

## Knowledge base

![Camunda-MCP Plugin Structure View](./kb-architecture/kb-structure-view.png)

Two complementary tiers, added so the plugin's own guidance (and a growing team-contributed
corpus) is available over the MCP protocol itself, not just to one specifically-instructed editor
session:

- **Tier A — curated guides**, served over MCP's native Resources protocol (`resources/list` /
  `resources/read`). Currently `BPMN-BEST-PRACTICES.md`.
- **Tier B1 — a searchable, multi-format doc corpus** (`kb_search` tool, SQLite FTS5 with BM25
  ranking). Accepts Markdown, PDF, BPMN XML, and OCR'd diagram images dropped into
  `docs/knowledge-base/`, reindexed live via a `chokidar` file watcher — no restart, no manual
  command.

Full design rationale (why FTS5 over vector search, the `better-sqlite3` native-ABI risk and its
mitigation, per-format extractor choices, the content-contribution workflow, and a real-world
usage walkthrough) lives in
[`docs/kb-architecture/architecture.md`](./kb-architecture/architecture.md), tracked in
[#24](https://github.com/JesseLeresche/Camunda-mcp/issues/24).

## Build & deployment

```bash
npm run build   # tsc (src/ -> dist/) && webpack (client/ -> client/dist/client.js)
npm run dev     # both in --watch mode
```

Installed into the Modeler via a **symlink** into its plugins directory (not `npm install` — this
plugin isn't built through the Modeler's own Electron packaging pipeline):

```bash
ln -s /path/to/plugin ~/Library/Application\ Support/camunda-modeler/resources/plugins/camunda-mcp
```

Client-only (`client/`) changes hot-reload with **F12 → Ctrl+R** inside the Modeler. Any change
under `src/` needs a full Modeler restart to take effect.

## Key dependencies

| Package | Role |
|---|---|
| `@modelcontextprotocol/sdk` | MCP server implementation (tools, resources, transport) |
| `express` | HTTP server for the `/mcp` endpoint |
| `zod` | Schema definition and runtime validation for every tool |
| `bpmn-auto-layout` | The layout engine behind `build_process` / `auto_layout` |
| `camunda-modeler-plugin-helpers` | Plugin registration with the host Modeler |
| `camunda-modeler-webpack-plugin` | Prevents double-bundling shared deps (React, etc.) with the host app |
| `uuid` | IPC correlation IDs |
| `webpack` + `ts-loader` | Client bundling |
| `vitest` | Unit tests (`layout/` composition subsystem) |

Knowledge base-specific dependencies (`better-sqlite3`, `pdfjs-dist`, `tesseract.js`, `chokidar`)
are listed in [`docs/kb-architecture/architecture.md`](./kb-architecture/architecture.md#key-dependencies).

## Known limitations

- **`diagramId` is informational only.** Renderer tools operate on the currently active diagram
  tab regardless of the `diagramId` parameter — use `switch_diagram` first.
- **Tab discovery is incremental.** `list_open_diagrams` only returns tabs focused at least once
  since the plugin loaded.
- **Authentication is optional.** Set `MCP_API_KEY` to enable Bearer token auth; without it the
  server is open on localhost.
- **Single-window support.** The renderer bridge targets `BrowserWindow.getAllWindows()[0]`.
- **Camunda 8 form linking** depends on the Modeler's moddle extensions and falls back to a
  `formId` reference if unavailable.
