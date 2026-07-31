# Camunda's Modeling Readability Guidelines

> Original notes written 2026-07-31, informed by docs.camunda.io's "creating readable process
> models" page (see Sources below). Complements this repo's own `BPMN-BEST-PRACTICES.md`, which
> covers this plugin's/bpmn-js's coordinate system and layout mechanics — this guide is about
> modeling *readability* independent of tooling.

Camunda's own guidance for keeping a diagram understandable to someone who didn't build it,
distilled to what's actionable when building a diagram via this plugin's tools:

## Labeling — the single biggest lever on readability

Every element type communicates something different through its label, and a diagram is only as
clear as its labels:

- **Start event** label → *what triggers* the process.
- **Activity** label → the *work* being done — a verb phrase ("Review Request"), not a noun
  ("Request").
- **Gateway** label → the *question* being answered, phrased so each outgoing flow's condition
  reads naturally against it (e.g. gateway "Approved?" with flows labeled "Yes"/"No", not "Amount >
  100").
- **Boundary event** label → the *exceptional path* it represents ("Payment Timeout", not just
  "Timer").
- **End event** label → the *business outcome*, not just "Done" — different end events in the same
  diagram should have distinguishable labels describing *which* outcome each represents.

## Keep symbol size and color meaningful, not decorative

Don't resize elements for emphasis — a bigger task box implicitly suggests "more important," which
is rarely the actual intent and reads as inconsistent to viewers. Keep labels short (move detail
into documentation/annotations, e.g. via `add_element {operation: "annotation"}`, rather than
padding the visible label). Similarly, use color sparingly and consistently — e.g. lightly
highlighting the "happy path," or distinguishing human vs. automated lanes by header color — not
as arbitrary decoration, which just reads as noise (or worse, as meaning something it doesn't).

## Structural habits worth keeping

- **Left-to-right flow** — matches how most readers scan a diagram; avoid routing that forces
  jumping backward across the canvas.
- **Symmetry** — when a gateway splits into parallel/exclusive branches that later rejoin, keeping
  the branches visually balanced (similar length, aligned merge point) makes the split/join
  relationship obvious at a glance, which is exactly what `layout {operation: "auto"}` in this
  plugin optimizes for.
- **Consistent naming conventions** — apply the same tense/phrasing pattern across every element of
  a given type in a diagram (all activities as imperative verb phrases, all gateways as questions)
  so the *shape* of a label alone hints at what kind of element it is, before a reader even checks
  the icon.

## Sources

- https://docs.camunda.io/docs/components/best-practices/modeling/creating-readable-process-models/
