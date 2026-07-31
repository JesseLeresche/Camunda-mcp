# Service Tasks & Job Workers

> Original notes written 2026-07-31, informed by docs.camunda.io's service-tasks page (see
> Sources below). Written to be directly useful when calling this plugin's
> `add_element {operation: "task"}` / `update_element {operation: "properties"}` tools.

A service task (`bpmn:ServiceTask`) represents automated work — something a piece of software does,
not a human. In Camunda 8 (Zeebe), that software is a **job worker**: an external process that
polls for jobs of a specific type and executes them.

## The task definition

Every service task needs a `taskDefinition`, which this plugin exposes as the `taskType` parameter
(`add_element {operation: "task", taskType: "..."}` or the equivalent `update_element` /
`build_process` property):

- **`type`** (required) — an arbitrary string job workers poll for, e.g. `order-items`,
  `send-confirmation-email`. This is the contract between your process model and whatever code
  actually does the work — it's just a label, Zeebe doesn't validate that a worker exists for it
  at deploy time.
- **`retries`** (optional, `taskRetries` in this plugin) — how many times Zeebe retries the job
  after a worker signals failure, before giving up and raising an incident. Defaults to 3.

`type` can also be a FEEL expression (prefixed `=`) if the job type needs to vary per instance,
e.g. `= "notify-" + region` — though a static string covers the overwhelming majority of cases.

## Not just ServiceTask

This "must have a `taskType`" requirement isn't unique to `bpmn:ServiceTask` — Camunda validation
requires it for **ServiceTask, SendTask, BusinessRuleTask, and ScriptTask** alike (all four are
job-worker-backed under the hood). This plugin's `taskType`/`taskRetries` parameters apply to all
four when set via `add_element {operation: "task", type: "bpmn:..."}`.

## Passing data in and out

Two separate mechanisms, easy to conflate:

- **Task headers** (`update_element {operation: "headers"}`) — static, deploy-time key/value
  config passed to the worker alongside every job (e.g. a template ID, an API endpoint). Fixed at
  modeling time, not computed per instance.
- **I/O variable mappings** (`update_element {operation: "io_mapping"}`) — FEEL expressions that
  map process variables in and out of the task at runtime (e.g. mapping `orderId` in, mapping the
  worker's `trackingNumber` result back out). This is the actual runtime data flow.

## When it's a person, not code: use User Task instead

If the work needs a human, don't force it into a service task with a manual-completion worker —
use `add_element {operation: "task", type: "bpmn:UserTask"}` instead (see the separate User Tasks
guide in this knowledge base). Camunda 8's own docs are explicit that the old pattern of
implementing user tasks via a generic job worker is deprecated in favor of native Camunda user
tasks.

## Sources

- https://docs.camunda.io/docs/components/modeler/bpmn/service-tasks/
