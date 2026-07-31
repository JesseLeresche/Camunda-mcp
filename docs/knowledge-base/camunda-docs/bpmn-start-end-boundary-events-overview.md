# Start, End & Boundary Events: The Unified Picture

> Original notes written 2026-07-31. The Message, Timer, Signal, Error, Escalation, and
> Compensation event guides in this knowledge base each cover one *definition type* in depth —
> this one ties together how start/end/boundary events work as a general mechanism, independent
> of which definition type is attached.

Every event in BPMN has two independent properties: **where** it sits in the flow (start,
intermediate, end, boundary) and **what triggers/produces it** (the event definition type — none,
message, timer, signal, error, escalation, compensation, terminate). This plugin's `add_element`
operations (`start`, `end`, `event`) map to the "where"; `eventDefinitionType` maps to the "what."

## Start events

Where a process (or a subprocess/event subprocess) begins.

- A **blank (`none`) start event** just marks "the process begins here" with no specific trigger
  modeled — the default from `add_element {operation: "start"}`.
- A **typed start event** (message, timer, or signal only — this plugin's `add_element` schema
  restricts start events to these three definition types) declares *how* the process actually
  gets kicked off.
- **A process may only have one blank start event.** If a process needs a second, distinct way to
  begin, it must be a *typed* start event, not a second blank one — this is enforced by Camunda
  validation, and it's exactly why `add_element {operation: "start", eventDefinitionType: "..."}`
  exists as a parameter rather than start events always being blank.

## End events

Where a path through the process concludes.

- A **blank end event** just marks "this path is done," with no further meaning attached.
- A **typed end event** (error, escalation, signal, message, or terminate) *throws* something as
  the path concludes — an error end event, for instance, propagates an error outward exactly the
  way a thrown error from elsewhere would (see the Error & Escalation Events guide).
- A **terminate end event** is the odd one out: reaching it immediately ends the *entire* process
  instance, cancelling every other still-active path — not just the branch that reached it. Use it
  deliberately, not as a default "end" choice.
- A single process can (and often should) have multiple, differently-labeled end events — see this
  KB's readability guide on why each one should describe *which* business outcome it represents.

## Boundary events

Attached to the edge of an activity or subprocess, not sitting inline in the flow — they represent
"something that can interrupt (or run alongside) this specific piece of work."

- **Interrupting** (the default) — when the boundary event fires, the activity it's attached to is
  abandoned immediately, and execution follows the boundary event's own outgoing path instead.
- **Non-interrupting** (`cancelActivity: false` in this plugin's `add_element`/`build_process`
  parameters) — the boundary event fires *without* stopping the host activity; both the original
  work and the boundary event's reaction proceed in parallel. Error boundary events are always
  interrupting (see the Error & Escalation Events guide) — only certain definition types
  (timer, message, signal, escalation) support the non-interrupting variant.
- A boundary event's host must be a task or subprocess — it can't attach to a gateway or another
  event.

## How this maps to this plugin's tools

`add_element {operation: "event", type: "bpmn:BoundaryEvent", attachedToId: "...",
cancelActivity: true/false, boundaryPosition: "..."}` is the one call that creates any boundary
event; which reaction it represents comes entirely from `eventDefinitionType` and the matching
`*Ref`/`*Code` parameter, per the dedicated guide for that definition type.
