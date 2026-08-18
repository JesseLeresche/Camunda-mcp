# DMN Decision Tables

> Original notes written 2026-07-31, informed by docs.camunda.io's DMN Modeler page (see Sources
> below). Written to be directly useful when calling this plugin's `create_dmn` tool and wiring a
> `BusinessRuleTask` up to the result.

DMN (Decision Model and Notation) is a separate OMG standard, sibling to BPMN, for modeling
business rules as data rather than as flow — a decision table instead of a diagram. Camunda 8 lets
a `BusinessRuleTask` in a BPMN process call out to a DMN decision to get a rule-driven answer,
instead of hand-encoding that logic as gateway conditions in the process itself.

## Creating one with this plugin

`create_dmn {name, tableName, hitPolicy, inputs, outputs}` creates a decision table `.dmn` file
directly (no separate Modeler UI step needed):

- **`inputs`** — each with a `label`, an `expression` (typically a variable name from the calling
  process), and a `type` (`string`, `integer`, `boolean`, `double`, `date`).
- **`outputs`** — each with a `label`, a `name` (the variable name the result is written back as),
  and a `type`.
- **`hitPolicy`** — governs what happens when *multiple* rule rows match the same input:
  - `UNIQUE` — exactly one row is expected to match; ambiguous if more than one does.
  - `FIRST` — takes the first matching row, in table order, when several match.
  - `PRIORITY` — takes the matching row with the highest-priority output value.
  - `ANY` — any matching rows must agree on the output; used when overlap is expected but
    harmless.
  - `COLLECT` — returns *all* matching rows' outputs as a list, not just one.
  - `RULE ORDER` — like `COLLECT`, but preserves the table's row order in the result list.

## Wiring it into a BPMN process

A `BusinessRuleTask` is still job-worker-backed like any other Camunda 8 automated task — it needs
a `taskType` (see the Service Tasks guide) just like a `ServiceTask` does. The task type's worker
implementation is what actually evaluates the DMN table (directly via Camunda's DMN engine
integration, or via a custom worker that calls out to it) — creating the `.dmn` file with
`create_dmn` doesn't automatically wire a `BusinessRuleTask` to it; that association still needs
to be set on the task itself.

## When to reach for DMN instead of a gateway

If a decision genuinely has many input combinations and is best reviewed/edited as a table by a
business analyst (not a developer reading gateway conditions in a BPMN diagram), model it as DMN.
For a simple two- or three-way branch, an exclusive gateway with `conditionExpression`s (see the
Gateways guide) is usually simpler and keeps the logic visible directly in the process diagram.

## Sources

- https://docs.camunda.io/docs/components/modeler/dmn/
