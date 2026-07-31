# Camunda Forms: Field Reference

> Original notes written 2026-07-31, based on this plugin's own `manage_form` tool schema and
> general Camunda Forms component knowledge. Complements the User Tasks & Forms guide's coverage
> of linking a form to a task — this one is about the fields themselves.

A Camunda Form is a `.form` JSON file describing input fields for a user task's UI (Tasklist or a
custom frontend). This plugin's `manage_form {operation: "create"/"add_field"}` supports eight
field types:

| Type | Use for |
|---|---|
| `textfield` | Short free text — a name, an ID, a short note. |
| `textarea` | Longer free text — comments, descriptions. |
| `number` | Numeric input, validated as a number client-side. |
| `checkbox` | A single boolean toggle. |
| `select` | Choosing exactly one option from a dropdown list. |
| `radio` | Choosing exactly one option, all choices visible at once (better than `select` when there are only a handful of options and seeing them all matters). |
| `taglist` | Choosing **multiple** options from a list — the multi-select counterpart to `select`/`radio`. |
| `datetime` | Date and/or time input. |

## Field structure

Every field (via `manage_form {operation: "create", fields: [...]}` or `add_field`) takes:

- **`key`** — the variable name the field's value is written to on submission. This becomes a real
  process variable (see the Process Variables & Scope guide) once the task completes.
- **`label`** — the human-readable text shown above the field.
- **`required`** (default `false`) — blocks submission until filled.
- **`description`** — help text shown below the field.
- **`options`** (for `select`/`radio`/`taglist` only) — an array of `{label, value}` pairs. `label`
  is what the user sees; `value` is what actually gets written to the process variable.

## Choosing `select` vs `radio` vs `taglist`

- Few options (2-5), single choice, worth seeing all at once → `radio`.
- Many options, single choice, or screen space is tight → `select`.
- Multiple simultaneous choices from a list → `taglist` — the only one of the three that produces
  an array-valued variable rather than a single value.

## Linking to a task

A form only takes effect once linked to a `UserTask` — see the User Tasks & Forms guide for
`manage_form {operation: "link_to_task"}` and the Camunda 7 vs. Camunda 8 dialect differences that
affect how the link itself is represented in the diagram's XML.
