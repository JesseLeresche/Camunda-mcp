# Ad-Hoc Subprocesses

> Original notes written 2026-07-31, informed by docs.camunda.io's ad-hoc-subprocesses page (see
> Sources below). A less common subprocess type than the Subprocesses & Call Activities guide's
> two main patterns — covered separately since its execution model is genuinely different.

Every other subprocess type in this knowledge base runs its contents in a fixed, modeled order.
An ad-hoc subprocess is the exception: it holds a set of activities that can run **in any order,
any number of times**, decided at runtime rather than fixed at modeling time.

## Two ways to decide what runs

- **Job worker implementation** — the ad-hoc subprocess itself is job-worker-backed (`taskType`,
  same as a service task). On activation, Zeebe creates a job; the worker inspects the
  `adHocSubProcessElements` variable (the set of available inner elements) and decides which
  ones to activate. Each time an activated inner flow completes, Zeebe creates a new job so the
  worker can decide the next step — activate more elements, or signal completion.
- **Completion condition** — a FEEL expression (see the FEEL Expressions guide) evaluated after
  each inner element completes; once it's true, the subprocess wraps up even if other elements
  are still eligible to run, similar in spirit to a multi-instance activity's completion condition
  (see the Multi-Instance guide).

## Why this exists: dynamic, not fixed, orchestration

The clear use case is when the *set and order* of steps genuinely can't be predicted at modeling
time — e.g. an AI agent (or a human) deciding at runtime which of several available actions to take
next, in what order, based on context that only exists during execution. This is meaningfully
different from a parallel gateway (which runs a fixed, modeled set of branches every time) or a
multi-instance activity (which repeats one fixed activity over a known collection) — an ad-hoc
subprocess's actual execution path isn't determined by the diagram at all, only the *pool of
possible* activities is.

## Collecting output

Like multi-instance activities, an ad-hoc subprocess can gather variables from each activated
inner element back into the parent scope — the same variable-scoping caution from the Process
Variables & Scope guide applies if elements can run concurrently.

## Sources

- https://docs.camunda.io/docs/components/modeler/bpmn/ad-hoc-subprocesses/
