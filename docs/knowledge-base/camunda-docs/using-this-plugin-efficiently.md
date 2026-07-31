# Using This Plugin Efficiently

> Original notes written 2026-07-31, drawn from this repo's own README.md and tool schemas —
> not an external source. Everything below is this plugin's own advice; the point of a dedicated
> guide is that `kb_search` can surface it, since `README.md` itself isn't part of the searchable
> corpus.

Practical patterns for getting the most out of this plugin's tools, not general BPMN knowledge.

## Prefer `build_process` over many `add_element` calls

For anything beyond a couple of elements, `build_process` creates every element and flow in one
call using friendly type names (`serviceTask`, `exclusiveGateway`, etc.) and logical IDs you choose
— it returns an `idMap` from your logical IDs to the actual generated element IDs. Set
`autoLayout: true` to position everything automatically in the same call, rather than following up
with a separate `layout {operation: "auto"}`. This is both fewer round trips and less error-prone
than building a diagram element-by-element with repeated `add_element`/`connect` calls.

## `compact: true` cuts response size by roughly 80%

Any tool call can include `compact: true` to strip the response down to essential IDs and status
fields only — worth defaulting to once a diagram is past the exploratory stage and you don't need
full element detail back on every call.

## Undo/redo grouping

`build_process`, `layout {operation: "auto"}`, and `batch_operations` are each grouped into a
*single* undo step in the Modeler's command stack — a person can press Ctrl+Z once to undo an
entire generated process or layout pass, not once per element. Plain individual
`add_element`/`connect`/`update_element` calls each get their own undo step.

## `batch_operations` uses internal primitive names, not the public tool names

If you need to run a sequence of fine-grained operations as one grouped, undoable unit,
`batch_operations`'s `operations[].tool` field references **internal primitive names**
(`move_element`, `connect_elements`, `set_properties`, `add_task`, …), not the consolidated public
tool names (`update_element`, `connect`, `add_element`) used everywhere else. Use `"$ref:N"` as a
string value to reference the `elementId`/`connectionId` returned by an earlier operation in the
same batch.

## Always validate after bulk generation

`query_diagram {operation: "validate"}` runs Camunda's own live linting — the same data behind the
Modeler's Problems panel — rather than this plugin re-implementing validation rules itself. Call it
after `build_process`/`batch_operations` to confirm a generated diagram is actually valid, instead
of assuming success from the build call's own return value; see this KB's Common Camunda Validation
Errors guide for what the resulting messages actually mean.

## `diagramId` is informational for renderer tools

Renderer-side tools (`add_element`, `connect`, most `update_element`/`query_diagram` operations)
act on whichever diagram tab is currently active in the Modeler, regardless of the `diagramId`
value passed — use `manage_diagram {operation: "switch"}` first if multiple diagrams are open and
you need to target a specific one.
