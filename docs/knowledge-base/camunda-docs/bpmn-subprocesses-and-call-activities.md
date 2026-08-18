# Subprocesses & Call Activities

> Original notes written 2026-07-31, informed by camunda.com/bpmn/reference and docs.camunda.io's
> subprocess/call-activity pages (see Sources below). Written to be directly useful when calling
> this plugin's `add_element {operation: "subprocess"}` tool.

Both group a chunk of process behind one box on the diagram, but they mean different things and
have different variable-scoping rules.

## Embedded subprocess (`bpmn:SubProcess`) — a scope within this process

An embedded subprocess only exists inside its parent process; it can't be reused elsewhere. Use it
to encapsulate complexity (collapse a busy region into one expandable box) or to make a "collective
statement" about a group of steps by attaching a boundary event to the subprocess itself rather
than to each step inside it — a boundary event on a subprocess interrupts it regardless of *which*
inner element is currently active.

- `add_element {operation: "subprocess", type: "bpmn:SubProcess", collapsed: false/true}` —
  `collapsed: true` shows it as a single closed box; expanded shows its contents inline.
- An embedded subprocess may only have a *blank* (none) start event — typed start events (message,
  timer) aren't valid here. That's what distinguishes it from an **event subprocess**.
- Variables inside an embedded subprocess share the parent process's scope by default — no
  isolation, no mapping step needed to read/write the parent's variables.

## Call activity (`bpmn:CallActivity`) — invoke a separate, reusable process

A call activity (`add_element {operation: "subprocess", type: "bpmn:CallActivity", calledElement:
"..."}`) invokes a *different*, independently-deployed process definition, creating a real child
process instance. Use it for genuinely reusable sub-flows shared across multiple parent processes
(a "procurement" or "invoicing" flow triggered from several different places), not just to
visually collapse a busy region — that's what embedded subprocesses are for.

Variable propagation between parent and child is real, config-driven behavior, not automatic:

- **`propagateAllChildVariables`** (default `true`) — whether the child instance's variables flow
  back up into the call activity's scope on completion. Turn this off (or define explicit output
  mappings) when the call activity runs in a parallel context (e.g. a parallel multi-instance) —
  otherwise concurrent child instances can race and overwrite each other's variables in the parent.
- **`propagateAllParentVariables`** (default `true`) — whether the parent's variables are copied
  into the new child instance at start. Turn this off to limit the child to only its own local/
  input-mapped variables.

## Rule of thumb

| Question | Use |
|---|---|
| "Just visually collapsing a busy region of *this* process?" | Embedded subprocess |
| "A reusable flow, independently deployed, invoked from multiple places?" | Call activity |
| "Need to react to an event without interrupting the whole enclosing scope?" | Event subprocess (non-interrupting) — see the Error & Escalation Events guide |

## Sources

- https://camunda.com/bpmn/reference/ (Call Activity section)
- https://docs.camunda.io/docs/components/modeler/bpmn/subprocesses/
- https://docs.camunda.io/docs/components/modeler/bpmn/call-activities/
