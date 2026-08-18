# FEEL Expressions Basics

> Original notes written 2026-07-31, informed by docs.camunda.io's expressions page (see Sources
> below). Nearly every dynamic-behavior guide in this knowledge base references "a FEEL
> expression" — this one explains what that actually means.

FEEL (Friendly Enough Expression Language) is the expression language Camunda 8 evaluates
dynamically at runtime — wherever this plugin's tools accept a `conditionExpression`,
`correlationKey`, or `timerValue` that starts with `=`, that's FEEL.

## Static value vs. expression

Most of this plugin's string-typed parameters accept either a plain static value or a FEEL
expression, and the difference matters:

- **Static value** — used as-is, no evaluation. `taskType: "send-email"`.
- **Expression** — prefixed with `=`, evaluated against the process instance's variables at
  runtime. `= "notify-" + region` (string concatenation) or `= amount > 100` (a boolean condition).

If you forget the `=` prefix on something meant to be dynamic, it's silently treated as a literal
string instead of being evaluated — a common source of "why isn't this condition working" bugs.

## Syntax essentials

- **Variable access**: just the variable's name, e.g. `orderId`, `amount`.
- **Comparisons**: `=`, `!=`, `<`, `<=`, `>`, `>=` — e.g. `amount > 100`.
- **Boolean logic**: `and`, `or`, `not(...)`.
- **String concatenation**: `+` — e.g. `"order-" + orderId`.
- **Property access on structured data**: dot notation, e.g. `customer.email`.
- **Built-in functions**: FEEL ships a standard library (string functions, list functions, date/
  time arithmetic) — e.g. subtracting two date-time values to compute a duration for a timer
  expression.

## Where the evaluation result type matters

Different parameters require different result types, and Camunda validates this:

- `conditionExpression` must evaluate to a `boolean`.
- `taskType` must evaluate to a `string`.
- `correlationKey` must evaluate to a `string` or a `number`.
- `timerValue` must evaluate to a `string` in the same ISO 8601 format as a static timer value, or
  an equivalent date/duration/cycle value.

A FEEL expression that's syntactically valid but returns the wrong type for its context fails at
evaluation time, not at deploy time — worth checking with `query_diagram {operation: "validate"}`
and, ultimately, a real deployment/test run, not just visual inspection of the diagram.

## Sources

- https://docs.camunda.io/docs/components/concepts/expressions/
