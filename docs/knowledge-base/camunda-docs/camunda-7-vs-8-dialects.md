# Camunda 7 vs. Camunda 8: What Changes in the BPMN Model

> Original notes written 2026-07-31, based on general knowledge of both platforms plus this
> plugin's own dual-dialect parameter support. Written to explain why this plugin's tool
> parameters split the way they do — `implementationType` for Camunda 7, `taskType` for Camunda 8.

Both are Camunda process engines, but different generations with different execution models — and
that difference shows up directly in how a BPMN diagram is annotated, not just in how it's deployed.

## The core difference: synchronous engine vs. asynchronous, job-based engine

- **Camunda 7** — a Java-embedded process engine, typically synchronous: a service task's logic is
  invoked more or less directly (a Java delegate class, an expression, an external task, or a
  connector), in-process or via a defined implementation.
- **Camunda 8 (Zeebe)** — a cloud-native, horizontally scalable engine built entirely around
  asynchronous **job workers** polling for work of a given type. Every automated task — service,
  send, business rule, script — is job-worker-backed; there's no "invoke this Java class directly"
  option at all.

## How this shows up in this plugin's parameters

This split is exactly why `update_element {operation: "properties"}` (and `add_element`/
`build_process`) carry two separate, non-overlapping sets of implementation fields:

| Camunda 7 | Camunda 8 |
|---|---|
| `implementationType` (`class`, `delegateExpression`, `expression`, `external`, `connector`) | `taskType` (a job-type string, matched by a job worker) |
| `implementationValue` (the class name/expression/connector ID) | *(the job type string itself, no separate value field)* |
| `taskTopic` (external task topic) | *(superseded by `taskType`)* |

Setting Camunda 7 fields on a diagram targeting Camunda 8 (or vice versa) doesn't error immediately
at modeling time — but it produces a diagram that won't validate or deploy correctly against the
engine it's actually meant for. Know which dialect a diagram targets before setting either group.

## How this plugin figures out which dialect a diagram is

`manage_form {operation: "link_to_task"}` explicitly auto-detects Camunda 7 vs Camunda 8 style
before wiring up the form reference — this plugin doesn't require you to declare the dialect
separately for every operation, but the detection only works because the diagram's own XML already
carries dialect-specific markers (a `zeebe:` namespace/extension elements for Camunda 8, a
`camunda:` namespace for Camunda 7). `manage_diagram {operation: "set_execution_platform_version"}`
exists specifically to correct/set the Camunda 8 execution platform version stamp on a diagram
that doesn't already carry the right one.

## Practical rule

If a diagram was created via `manage_diagram {operation: "create"}` in this plugin, it's Camunda 8
by default — use `taskType`, not `implementationType`, unless you have a specific reason to be
targeting a Camunda 7 environment.
