# Common Camunda Validation Errors & Fixes

> Original notes written 2026-07-31, compiled from this plugin's own tool schema requirements (see
> `src/tools/schemas/primitives.ts`) and validation output observed while using this plugin's
> `query_diagram {operation: "validate"}` and `build_process` tools. A practical symptom-to-fix
> reference, not a copy of any single external page.

`query_diagram {operation: "validate"}` (and the validation Camunda runs at deploy time) surfaces
the same recurring handful of issues. This maps the actual error messages to the fix, so a
`kb_search` hit here goes straight to "do this," not just "here's the theory."

| Error message (or its gist) | What it means | Fix |
|---|---|---|
| `A <Service Task> must have a <Task definition type>` | Missing `taskType`. Applies to **ServiceTask, SendTask, BusinessRuleTask, and ScriptTask** — not just ServiceTask, despite the message naming only one. | Set `taskType` via `add_element`/`update_element {operation: "properties"}`. |
| `A <Sequence Flow> must have a defined <Condition expression> or be the default <Sequence Flow>` | A gateway has an outgoing flow with neither a condition nor `isDefault: true`. | Set `conditionExpression` on it, or mark exactly one outgoing flow per gateway as `isDefault: true`. |
| `A <User Task> should have a defined <Form>` | Advisory, not blocking — a user task with no form attached still deploys. | Link one via `manage_form {operation: "link_to_task"}` if the task genuinely needs human input fields; otherwise safe to ignore for a purely illustrative diagram. |
| `<Implementation: Job worker> ... is deprecated` on a user task | The task uses the legacy job-worker-backed user task implementation instead of a native Camunda user task. | Use `add_element {operation: "task", type: "bpmn:UserTask"}`'s default (native Camunda user task) rather than manually configuring a job-worker implementation. |
| Missing `errorCode` alongside `errorRef` | Camunda requires a non-empty `errorCode` on any error reference, even though `errorRef` alone finds-or-creates the underlying `bpmn:Error` element. | Set `errorCode` explicitly, or accept this plugin's default of falling back to the `errorRef` name. |
| Missing `correlationKey` on a message-referencing element | Required alongside `messageRef` for a **ReceiveTask**, or a **BoundaryEvent/IntermediateCatchEvent** with `eventDefinitionType: "bpmn:MessageEventDefinition"`. *Not* required for a plain start event, SendTask, or IntermediateThrowEvent. | Add `correlationKey` (a FEEL expression, e.g. `=orderId`) — see the Message Events & Correlation Keys guide. |
| A second blank start event on the same process | A process may only have one `none` start event. | Give the second trigger a real `eventDefinitionType` (message/signal/timer) instead of leaving it blank. |
| Parallel gateway join never completes (process appears stuck) | Not a validation error — a runtime deadlock. A parallel join is waiting on an incoming branch that was never actually reached (e.g. it sat behind an exclusive gateway that chose a different path). | Re-check the gateway guide's warning: don't feed a parallel join from a branch that isn't guaranteed to run. |

## General practice

Always run `query_diagram {operation: "validate"}` after `build_process`/`batch_operations` on a
non-trivial diagram rather than assuming success from the tool call's return value alone — several
of the issues above (missing `taskType`, missing `correlationKey`) are easy to introduce silently
when building a diagram element-by-element.
