# Pools, Lanes & Collaboration Diagrams

> Original notes written 2026-07-31, informed by camunda.com/bpmn/reference's Pool section (see
> Sources below). Written to be directly useful when calling this plugin's
> `add_element {operation: "pool"/"lane"}` and `connect {operation: "message_flow"}` tools.

A pool represents one independent participant in a process — an organization, a system, a role.
Everything inside one pool is that participant's own process; participants only ever communicate
with each other across pool boundaries via **message flows**, never a plain sequence flow.

## Lanes: dividing responsibility within one participant

A lane subdivides a single pool to show *who* (or *what*) within that one participant is
responsible for each activity — e.g. splitting an "Order Processing" pool into "Sales" and
"Warehouse" lanes. Lanes don't represent separate participants; they're an internal breakdown of
one. Add via `add_element {operation: "lane", participantId: "..."}` — a lane always belongs to a
specific pool.

## Single process vs. collaboration diagram

- **One pool, no lanes (or lanes but no second pool)** — a single process, optionally showing who
  does what internally. This is the default shape for most diagrams built with this plugin.
- **Two or more pools** — a **collaboration diagram**: multiple independent processes, each with
  their own start/end events and internal flow, connected only by message flows crossing pool
  boundaries. Use `add_element {operation: "pool"}` for each participant and
  `connect {operation: "message_flow", sourceId, targetId, name}` for the cross-pool
  communication.

## The rule that trips people up: sequence flow never crosses a pool

Every sequence flow (`connect {operation: "sequence_flow"}`) must stay entirely within one pool
(or one lane's parent pool) — it represents control flow within a single participant's own
process. The *only* way one pool's activity affects another pool's is by sending/receiving a
message (`bpmn:MessageEventDefinition`) over a message flow. If a diagram needs "pool A does X,
then pool B does Y in response," that's not a direct connection between A's task and B's task —
it's A sending a message (via a message end event or a send task), and B catching it (via a
message start/intermediate event or a receive task), joined visually by a message flow.

## "Black box" pools

A pool can also represent a participant whose *internal* process isn't modeled at all — just a
plain box with no internal elements, existing purely as a message-flow endpoint. Useful for showing
an external system or third party the diagram's own process talks to, without pretending to know
(or needing to model) how that other side actually works internally.

## Sources

- https://camunda.com/bpmn/reference/ (Pool section)
