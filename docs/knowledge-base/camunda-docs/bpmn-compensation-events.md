# Compensation Events

> Original notes written 2026-07-31, informed by docs.camunda.io's compensation-events page (see
> Sources below). Written to be directly useful when using
> `eventDefinitionType: "bpmn:CompensateEventDefinition"` in this plugin's `add_element` tool.

Compensation is BPMN's answer to "undo something that already finished successfully, because a
later step made its result unwanted." Think of a booking flow: a flight was already reserved, but
the hotel booking downstream failed — compensation is how the model expresses "release that
flight reservation" as an explicit, visible step, rather than silently leaving inconsistent state
behind.

## Three pieces, three roles

- **Compensation boundary event** — attached to the activity whose effects might need undoing (the
  "compensation activity"). It doesn't fire on its own; it's a *listener* waiting to be invoked.
- **Compensation handler** — a separate activity, carrying a compensation marker, associated with
  that boundary event. This is the actual "undo" logic — e.g. a task named "Cancel Flight
  Reservation" attached as the handler for a "Reserve Flight" task.
- **Compensation throw event** (intermediate or end) — the trigger. When execution reaches it, it
  invokes the compensation handler(s) for whatever compensation activities already completed in
  scope, waits for them to finish, then continues.

## Scoping: compensation doesn't reach everywhere automatically

- A throw event inside an embedded subprocess only invokes handlers *within* that subprocess — not
  anything outside it.
- A throw event at the outer process level reaches into completed embedded subprocesses (and
  nested ones inside those), invoking their handlers too — but only for subprocesses that actually
  completed, not ones still active or already terminated.
- Compensation does **not** automatically cross into a call activity's child process instance —
  triggering stops at the call activity boundary. To make a call activity's own effects
  compensatable, attach a compensation boundary event directly to the call activity itself.

## When to actually reach for this

Compensation is specifically for **undoing already-completed, real-world-visible work** (a
reservation, a charge, a shipment) — not a general error-handling mechanism. For "stop this branch
and route elsewhere," an error event (see this KB's Error & Escalation Events guide) is almost
always the right tool; compensation is narrower and only worth modeling when there's a genuine
completed side effect that needs an explicit, visible reversal step.

## Sources

- https://docs.camunda.io/docs/components/modeler/bpmn/compensation-events/
