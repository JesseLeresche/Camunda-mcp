# BPMN Gateways: Which One to Use

> Original notes written 2026-07-31, informed by camunda.com/bpmn/reference and
> docs.camunda.io's gateway pages (see Sources below). Not a copy of either — written to be
> directly useful when calling this plugin's `add_element {operation: "gateway"}` /
> `connect {operation: "sequence_flow"}` tools.

Gateways route the flow through a diagram. Camunda 8 currently supports four of BPMN's gateway
types (`add_element {operation: "gateway", type: "bpmn:..."}`):

## Exclusive gateway (`bpmn:ExclusiveGateway`) — pick exactly one path

The default choice. Evaluates each outgoing sequence flow's condition in order and takes the
*first* one that's true — exactly one token continues. Use it for "if/else" branching driven by
process data (e.g. "is the order over $100?").

- Every outgoing flow except one needs a `conditionExpression` (FEEL, e.g. `=amount > 100`) via
  `connect {operation: "sequence_flow", conditionExpression: "..."}` or
  `update_element {operation: "properties", conditionExpression: "..."}`.
- The remaining flow should be marked the default via `isDefault: true` — this satisfies Camunda's
  "every non-default flow needs a condition" validation rule without needing a catch-all
  condition, and guarantees the process doesn't get stuck if none of the real conditions match.

## Parallel gateway (`bpmn:ParallelGateway`) — do everything at once

Activates *every* outgoing flow simultaneously — no conditions, no choice. Used in pairs: one to
fork (start N branches), one to join (wait for all N to complete before continuing). Use it when
steps are genuinely independent and can happen concurrently (e.g. "check inventory" and "verify
payment" at the same time).

- A parallel join doesn't continue until *every* incoming branch has arrived — if a branch was
  never actually reached (e.g. it lived behind an exclusive gateway that chose a different path),
  the join deadlocks. Don't feed a parallel join from a branch that might not run.

## Inclusive gateway (`bpmn:InclusiveGateway`) — pick one or more paths

A hybrid: like the exclusive gateway, each outgoing flow has a condition — but *every* flow whose
condition evaluates true is taken (one, several, or all of them), not just the first match. Rarer
in practice than exclusive/parallel; reach for it specifically when "one or more of these apply"
is a real business rule (e.g. a discount that can stack: loyalty *and* seasonal *and* referral, in
any combination), not just as a fallback when you're unsure which of the other two you need.

## Event-based gateway (`bpmn:EventBasedGateway`) — race a set of events

Routes based on *which event happens first*, not on data. Every outgoing path must lead to a
receive task or an intermediate catch event (message, timer, signal); whichever one fires first
"wins" and the others are cancelled. The classic example: wait for either a message to arrive or a
timeout — "wait for the pizza to be delivered, but call the shop if it hasn't shown up in 60
minutes." Model this as an event-based gateway with one branch to a message catch event and one to
a timer catch event.

## Quick decision guide

| Question | Gateway |
|---|---|
| "Which single path, based on data?" | Exclusive |
| "All of these, at the same time?" | Parallel |
| "Any combination of these, based on data?" | Inclusive |
| "Whichever event happens first?" | Event-based |

## Sources

- https://camunda.com/bpmn/reference/ (Gateways section)
- https://docs.camunda.io/docs/components/modeler/bpmn/gateways/
