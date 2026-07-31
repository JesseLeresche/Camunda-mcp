# Multi-Instance Activities (Loops Over a Collection)

> Original notes written 2026-07-31, informed by docs.camunda.io's multi-instance page (see
> Sources below). Written to be directly useful when modeling a "for each" pattern in a diagram
> built with this plugin.

A multi-instance activity runs the same task once per item in a collection — the BPMN equivalent
of a `for` loop. Applies as a marker on tasks, subprocesses, and call activities alike.

## Parallel vs sequential

- **Parallel** — every instance starts at once, independently. Use when items are genuinely
  independent of each other (send N notification emails, process N line items with no ordering
  dependency).
- **Sequential** — one instance at a time, each waiting for the previous to finish. Use when order
  matters or when instances would otherwise contend for a shared resource.

## The moving parts

- **Input collection** — the array-valued variable to iterate over.
- **`inputElement`** — the per-instance loop variable, one element of the collection, available
  inside that instance only.
- **`loopCounter`** — the current instance's index, also instance-local.
- **`outputElement`** — set by output mappings on each instance; these get gathered back into the
  parent scope as the overall result collection once every instance completes.
- **Completion condition** — an optional FEEL expression that can end the whole multi-instance
  activity *before* every instance has finished (e.g. "stop once 3 out of 5 approvals are in,"
  rather than always waiting for all 5).

## The variable-scoping trap

By default, a new variable written by a job worker inside a multi-instance instance is visible at
the *process instance* scope, not just within that one instance — which means, under **parallel**
execution, concurrent instances writing to the same variable name can race and clobber each other.
The fix: use input mappings to make instance-specific data genuinely **local** to each instance
(not propagated to the parent scope), and rely on output mappings — not shared variables — to
report each instance's result back out safely.

This is the single most common correctness bug in multi-instance modeling: it works fine in testing
with sequential execution or small collections, then produces inconsistent results once real
parallel load hits shared variable names.

## Sources

- https://docs.camunda.io/docs/components/modeler/bpmn/multi-instance/
