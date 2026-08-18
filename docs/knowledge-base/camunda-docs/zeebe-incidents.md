# Zeebe Incidents

> Original notes written 2026-07-31, informed by docs.camunda.io's incidents concept page (see
> Sources below). Complements the Service Tasks guide's coverage of retries.

An incident is Zeebe's way of surfacing "this process instance is stuck and needs a human to look
at it" — it represents an error condition that prevents the engine from advancing the instance any
further on its own.

## What creates one

The most common trigger is a service task whose job worker keeps signaling failure until the
configured `taskRetries` (see the Service Tasks guide — default 3) are exhausted. Once retries run
out, Zeebe stops trying automatically and raises an incident instead of retrying forever. Incidents
can also arise from a FEEL expression that fails to evaluate (wrong result type, referencing a
variable that doesn't exist) — a modeling-level problem, not a runtime worker failure.

## Incidents vs. error events — different tools for different problems

This is the distinction the Error & Escalation Events guide's "business error vs. technical error"
framing is really pointing at:

- **Error events** are for reactions worth modeling *visibly in the diagram* — a business decision
  about what happens next, deliberately drawn as its own path.
  - **Incidents** are for problems the process model itself doesn't (and shouldn't) know how to
  handle — they pause that one instance for operational attention, without every diagram needing an
  explicit branch for "what if the infrastructure is broken."

Modeling every conceivable technical failure as an explicit error-event branch bloats a diagram
with paths that exist purely to handle infrastructure flakiness. Let genuinely unexpected technical
failures become incidents; reserve error events for failures the business genuinely wants to see
and react to in the model.

## Resolution

An incident doesn't resolve itself — an operator (or automation watching for incidents) fixes the
underlying cause and then explicitly resolves it, at which point Zeebe resumes the instance from
where it stopped. This plugin doesn't currently expose incident inspection/resolution as a tool;
that's an operational-tooling concern (Operate) rather than a modeling-time one.

## Sources

- https://docs.camunda.io/docs/components/concepts/incidents/
