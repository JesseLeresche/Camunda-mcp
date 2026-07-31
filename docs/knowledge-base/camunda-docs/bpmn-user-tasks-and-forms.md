# User Tasks & Forms

> Original notes written 2026-07-31, informed by docs.camunda.io's user-tasks page (see Sources
> below). Written to be directly useful when calling this plugin's `add_element`/`manage_form`
> tools.

A user task (`bpmn:UserTask`) represents work a human does, surfaced through Camunda's Tasklist
(or a custom UI). It differs from a manual task (which Camunda doesn't track as a discrete
work-item at all — think "sign a physical document," not tracked in software).

## Assignment

A user task can be assigned via three attributes, usable individually or together:

- **`assignee`** — a single specific user; Tasklist claims the task for them directly.
- **`candidateUsers`** — a set of users any of whom can claim the task.
- **`candidateGroups`** — a set of groups; any member of any listed group can claim it.

This plugin doesn't currently expose these three as dedicated tool parameters — set them via
`update_element {operation: "properties", documentation: "..."}` isn't the right mechanism either;
today they'd need a manual XML edit or a follow-up capability. Worth knowing they exist even if
not yet wired into a tool call here.

## Linking a form

Forms are how a user task actually presents its input fields. This plugin handles this end to end:

1. `manage_form {operation: "create", name: "...", fields: [...]}` — creates the `.form` JSON file.
2. `manage_form {operation: "link_to_task", diagramId, taskId, formPath}` — links it to the
   user task, auto-detecting whether the diagram is Camunda 7 or Camunda 8 style and wiring the
   correct extension (`zeebe:formDefinition` for Camunda 8, a `camunda:formKey`-style reference for
   Camunda 7).

Field types supported by `manage_form {operation: "create"}` / `add_field`: `textfield`,
`textarea`, `number`, `checkbox`, `select`, `radio`, `taglist`, `datetime`.

## Task priority and scheduling

Camunda 8 user tasks support a numeric priority (`update_element {operation: "properties",
taskPriority: "..."}`) that Tasklist can sort/filter on, and (per Camunda's own docs) a scheduled
due date. Priority is purely advisory metadata for the humans working the task list — it doesn't
change engine routing behavior.

## Deprecated pattern: job-worker-backed user tasks

Older diagrams (or ones migrated from very early Camunda 8 versions) may implement a "user task"
as a generic service-task-style job worker instead of a native `zeebe:userTask`. Camunda's own docs
call this out as deprecated — a real, human-facing user task should use the native Camunda user
task implementation (the default this plugin produces), not a job-worker workaround.

## Sources

- https://docs.camunda.io/docs/components/modeler/bpmn/user-tasks/
