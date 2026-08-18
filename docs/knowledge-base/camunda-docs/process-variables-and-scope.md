# Process Variables & Scope

> Original notes written 2026-07-31, informed by docs.camunda.io's variables concept page (see
> Sources below). This is the general model that the Service Tasks, Call Activities, and
> Multi-Instance guides in this knowledge base each build on for their own specific gotchas.

Variables carry business data through a running process instance — JSON-valued, read/written by
FEEL expressions and job workers alike.

## Scope is hierarchical

Every variable lives at a **scope**: the process instance itself, or a narrower scope nested
inside it (a subprocess, a single multi-instance iteration, a call activity). A variable set in an
inner scope is visible to everything inside that scope and, by default, propagates outward to the
parent scope too — which is exactly the behavior that causes the race-condition bug documented in
this KB's Multi-Instance guide when multiple parallel branches write the same variable name.

## Setting variables: two different mechanisms

- **Input/output variable mappings** (`update_element {operation: "io_mapping"}`) — FEEL
  expressions evaluated when entering/leaving a task, mapping data between the task's local scope
  and its parent. This is the primary way to control exactly what a task reads and writes, and the
  main tool for containing scope-propagation problems (map a variable in as *local*, and it never
  leaks to the parent scope at all).
- **Job worker results** — when a job worker completes a service task, the variables it returns are
  merged directly into the task's scope (and, without explicit output mappings narrowing this,
  upward from there) — this is the default, unmapped path data takes.

## Reading a variable from a FEEL expression

Once a variable exists at a scope visible to the expression being evaluated, referencing it is just
its name (`orderId`) or a property path for structured data (`customer.email`) — see this
knowledge base's FEEL Expressions guide for the language itself.

## Practical rule for keeping scope bugs out of a diagram

Default to letting variables propagate normally in a purely sequential diagram — the scoping rules
only bite when execution becomes concurrent (parallel gateways, parallel multi-instance, call
activities running in parallel branches). Whenever you're modeling something that runs
concurrently, that's the specific moment to double-check whether each branch needs its own
*local*, non-propagating copy of a variable name rather than sharing one across branches.

## Sources

- https://docs.camunda.io/docs/components/concepts/variables/
