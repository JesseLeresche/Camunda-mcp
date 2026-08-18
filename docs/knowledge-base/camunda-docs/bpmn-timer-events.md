# Timer Events

> Original notes written 2026-07-31, informed by docs.camunda.io's timer-events page (see
> Sources below). Written to be directly useful when calling this plugin's `add_element`
> (`eventDefinitionType: "bpmn:TimerEventDefinition"`, `timerValue`, `timerType`) tools.

Timer events trigger based on a clock rather than an external signal — usable on start events,
intermediate catch events, and boundary events, all via this plugin's `timerValue`/`timerType`
parameters.

## Three timer shapes, one value format

Set `timerType` to pick which of the three ISO 8601 shapes `timerValue` should be:

- **`timeDate`** — an absolute point in time (e.g. `2026-12-31T23:59:00Z`). Fires once, at that
  instant.
- **`timeDuration`** (the common case, and this plugin's default) — a relative offset from when the
  timer starts counting (e.g. `PT1H` = 1 hour, `P3D` = 3 days). Fires once, after that much time
  has elapsed.
- **`timeCycle`** — a repeating interval (e.g. `R/PT5M` = repeat every 5 minutes, `R3/PT10M` =
  repeat exactly 3 times every 10 minutes). Only meaningful on start events and boundary events —
  an intermediate catch event fires once and moves on, so a repeat count doesn't apply to it the
  same way.

`timerValue` doesn't have to be a static literal — it can be a FEEL expression (prefixed `=`)
referencing a process variable, e.g. `= remainingTime`, evaluated when the timer actually starts
counting (at process deployment for a timer *start* event, at activation time for everything else).

## Timers are approximate, not exact

Zeebe is an asynchronous engine — a timer is guaranteed not to fire *before* its due time, but
under load it can fire meaningfully *after*. Don't model a timer as if it were a precise clock
tick; if a business process genuinely needs sub-second precision, a timer event isn't the right
tool.

## Common pattern: timeout via boundary event

The most frequent real use isn't a standalone wait — it's a **non-interrupting or interrupting
timer boundary event** attached to a task or subprocess, modeling "give up (or escalate) if this
takes too long." Pair it with an event-based gateway (see the Gateways guide) when the timeout is
racing against a specific expected event rather than just bounding a task's own duration.

## Sources

- https://docs.camunda.io/docs/components/modeler/bpmn/timer-events/
