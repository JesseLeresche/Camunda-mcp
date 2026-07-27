# Layout migration fixtures

BPMN XML fixtures used by `client/__tests__/` to regression-test the
`bpmn-auto-layout` migration (see the migration plan referenced from the
tracking issue). Each fixture is semantic-only input (no `<bpmndi:...>` DI,
or only the minimal `isExpanded` stubs a test needs) — expected output is
asserted structurally (no overlapping bounds, no duplicate waypoints, no
crossing edges beyond the router's documented residual, etc.), not pinned to
exact pixel positions, since exact output is expected to shift as the
post-processing pass (dedup / crossing router / label placement) is tuned.

Populated across the migration's phases:

- `boundary-events-subprocess.bpmn` — service task + boundary timer, call
  activity + boundary error, expanded subprocess (Phase 1, done — generated
  via `bpmn-moddle`, not hand-written, so it's guaranteed well-formed).
- `gateways.bpmn` — parallel split/join + exclusive decision (Phase 1, done).
- `complex-loan-underwriting.bpmn` — 29 elements, every task/gateway/event
  type the schema supports (Phase 1, done).
- `pools-lanes-annotations-group.bpmn` — collaboration with 2 participants
  (Customer: no lanes; Bank: 2 lanes), a message flow, a text annotation
  with an association, and a group (Phase 3, done).

Regression assertions for `boundary-events-subprocess.bpmn`,
`gateways.bpmn`, and `complex-loan-underwriting.bpmn` live in
`client/__tests__/layout-fixtures.test.ts` (structural: every element
positioned, expanded subprocesses actually contain their children, no two
unrelated shapes overlap). Assertions for `pools-lanes-annotations-group.bpmn`
live in `client/__tests__/composition.test.ts` (extraction correctness, pools
stacked without overlap, lane bounds/membership reconstructed). None are
pinned to exact pixel positions, since output is expected to shift as
`bpmn-auto-layout` or the post-processing pass changes.
