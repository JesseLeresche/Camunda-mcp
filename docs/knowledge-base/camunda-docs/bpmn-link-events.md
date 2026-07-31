# Link Events

> Original notes written 2026-07-31, informed by camunda.com/bpmn/reference and docs.camunda.io's
> link-events page (see Sources below). A pure diagram-layout tool, not a runtime behavior.

Link events are the odd one out among event types: they carry **zero process meaning**. A pair of
linked events behaves exactly like an ordinary sequence flow connecting two points — the link
exists purely to make the *diagram* more readable, not to change how the process executes.

## How the pairing works

- A **throwing** link event marks an "exit point."
- A **catching** link event, given the same link name, marks the matching "re-entrance point."
- Multiple throwing link events can all point to the same catching link event (several different
  paths converging into one continuation point) — but a single throwing link event can't fan out
  to multiple catches.
- Link events are intermediate-only — there's no start or end variant.

## When to actually use one

Reach for a link event pair specifically to avoid a long sequence flow line crossing most of the
canvas, or snaking back on itself — e.g. a retry loop that would otherwise require routing a flow
line all the way back across the diagram to an earlier point. Two paired link events replace that
long, visually noisy connector with two small, clearly-labeled markers instead.

This is purely a **readability** tool (see this KB's Camunda Modeling Readability Guidelines guide)
— don't reach for it as a substitute for restructuring a genuinely tangled diagram. If a diagram
needs many link-event pairs to stay readable, that's often a sign the underlying process itself (or
its layout) deserves rethinking, not just visual patching.

## Sources

- https://camunda.com/bpmn/reference/ (Link section)
- https://docs.camunda.io/docs/components/modeler/bpmn/link-events/
