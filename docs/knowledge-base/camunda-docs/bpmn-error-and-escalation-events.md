# Error & Escalation Events

> Original notes written 2026-07-31, informed by docs.camunda.io's error-events page (see Sources
> below). Written to be directly useful when calling this plugin's `add_element`
> (`eventDefinitionType: "bpmn:ErrorEventDefinition"` / `"bpmn:EscalationEventDefinition"`) tools.

BPMN gives you two distinct mechanisms for "something went wrong, handle it visibly in the model"
— error events and escalation events. They look similar (both throw/catch, both use a boundary
event or event subprocess) but mean different things.

## Error events: interrupting, "this branch failed"

An error event models a genuine failure that should abandon the current path and jump to a
recovery path. Thrown from an end event (`add_element {operation: "end",
eventDefinitionType: "bpmn:ErrorEventDefinition", errorRef: "...", errorCode: "..."}`) or a
service task's own failure, caught by an **error boundary event** on an activity, or an error event
subprocess.

- **`errorRef`** — the error's name (find-or-creates the underlying `bpmn:Error` root element).
- **`errorCode`** — required by Camunda validation alongside `errorRef`; defaults to the error
  name if you don't set one explicitly. This is the value actually matched at runtime — a boundary
  event catches an error if its own `errorCode` matches (or if it's a catch-all with no code set).
- Error boundary events and error event subprocesses are always **interrupting** — the process does
  not continue along its original path once the error is caught, it follows the recovery path
  instead. There's no "non-interrupting error event."
- Matching is scope-based: Camunda checks the boundary events/event subprocesses at the scope where
  the error was thrown first, then walks up parent scopes (including into a calling process, if the
  failing instance was started via a call activity) until something catches it.

## Business error vs. technical error — model reactions, not causes

Camunda's own guidance (worth internalizing, not just the mechanics above): don't get stuck
debating whether a given failure is "technical" or "business" in origin. What actually matters is
how you *react*. A technical failure (a downstream service is down) can still warrant a business
reaction modeled explicitly in the diagram (e.g. "give every customer a default rating instead of
blocking the process"). Reserve error events for reactions worth modeling visibly; let genuinely
transient technical failures retry or fall back to Zeebe incidents instead of bloating the diagram
with error-handling branches on every single service task.

## Escalation events: non-interrupting, "flag this, keep going"

Escalation is error's quieter sibling: it signals a subprocess-level condition upward without
necessarily aborting anything. A non-interrupting escalation boundary event lets the original path
keep running *while also* triggering a parallel notification/handling branch — useful for "this is
worth flagging to someone, but don't stop the process over it." Same `escalationRef`/
`escalationCode` pattern as errors via this plugin's `add_element`/`update_element` parameters.

## Sources

- https://docs.camunda.io/docs/components/modeler/bpmn/error-events/
