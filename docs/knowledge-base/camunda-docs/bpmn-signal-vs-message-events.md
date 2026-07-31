# Signal Events vs Message Events

> Original notes written 2026-07-31, informed by docs.camunda.io's signal-events page (see
> Sources below). Written to be directly useful when deciding between `eventDefinitionType:
> "bpmn:SignalEventDefinition"` and `"bpmn:MessageEventDefinition"` in this plugin's `add_element`
> tool.

Both let a process react to something happening outside it, and both are set up the same way in
this plugin (`add_element {..., eventDefinitionType, signalRef}` vs `{..., eventDefinitionType,
messageRef, correlationKey}`) — but they model fundamentally different communication shapes.

## The core distinction: fan-out vs point-to-point

- **Signal = one sender, many recipients.** Broadcasting a signal triggers *every* signal event
  (across every process, every instance) currently waiting on a signal with that name. There's no
  correlation key, no targeting — a signal is a public announcement, not addressed to anyone in
  particular. Good fit for "notify anyone who cares that X happened" — e.g. "a system-wide
  maintenance window just started," broadcast to every process that has a corresponding signal
  boundary event.
- **Message = one sender, one recipient.** A message is correlated to exactly one specific waiting
  instance via its `correlationKey` (see the Message Events guide). Good fit for "this specific
  order's payment just cleared" — that response belongs to one particular process instance, not
  every instance in the system.

## Practical rule

If you find yourself trying to give a signal a correlation key, that's a sign you actually want a
message event instead — signals are deliberately un-targeted. Conversely, if you're broadcasting
the same message name to every listener and never actually using the correlation key to
distinguish instances, a signal event is the more honest model of what's actually happening.

## Signal start events

A broadcast signal doesn't just wake up waiting intermediate events — it can also start a *new*
process instance, if the process has a matching signal start event. One broadcast, potentially:
several intermediate catches resumed *and* several brand-new instances started, all from a single
event.

## Sources

- https://docs.camunda.io/docs/components/modeler/bpmn/signal-events/
