# Message Events & Correlation Keys

> Original notes written 2026-07-31, informed by docs.camunda.io's message-events page (see
> Sources below). Written to be directly useful when calling this plugin's `add_element`
> (`eventDefinitionType: "bpmn:MessageEventDefinition"`) tools.

A message event pauses (or starts) a process until a matching message arrives from outside — the
mechanism for "wait for something external to happen." Used on start events, intermediate catch
events, boundary events, and receive tasks; this plugin's `messageRef`/`correlationKey` parameters
apply consistently across all of them.

## The two parts of a message

Every message reference has two independent pieces, both set via this plugin's `messageRef`
parameter (which find-or-creates the underlying `bpmn:Message` root element) plus
`correlationKey`:

- **Name** (`messageRef`) — a string identifying *what kind* of message this is (e.g.
  `"payment received"`). Not unique per instance — many process instances can all be waiting on
  messages named `"payment received"` simultaneously.
- **Correlation key** (`correlationKey`, a FEEL expression like `=orderId`) — identifies *which*
  process instance a specific published message belongs to. When a message named `"payment
  received"` arrives with correlation key `"order-123"`, only the instance whose own `orderId`
  variable equals `"order-123"` wakes up.

Without a correlation key, there's no way to route an incoming message to the right one of
potentially thousands of in-flight instances waiting on messages of the same name.

## Where correlationKey is required vs. not

This plugin's schema comments reflect Camunda's real validation rules here:

- **Required**, alongside `messageRef`: a `ReceiveTask`, or a `BoundaryEvent`/
  `IntermediateCatchEvent` with `eventDefinitionType: "bpmn:MessageEventDefinition"`.
- **Not applicable**: a plain `start` event, a `SendTask`, or an `IntermediateThrowEvent` — these
  either create the correlation (start events don't need one specified in the model itself; see
  below) or are the *sending* side, not the receiving side.

## Message start events are special

A message start event doesn't declare its own `correlationKey` in the model. Instead, whoever
*publishes* the message supplies a correlation key at publish time, and Zeebe uses it to decide:
if a process instance with that same correlation key is already active, the message is buffered
(if it has a time-to-live) rather than starting a duplicate instance — the new instance only starts
once the prior one completes, or immediately if none was active and the key was non-empty.

## Practical pattern: request/response over messages

A very common shape: a service task calls an external system, then an intermediate message catch
event (or a receive task) waits for that system's async callback, correlated by whatever ID the
service task's call returned (e.g. `orderId`, `paymentId`). Model the wait as its own explicit
step — don't try to bake "wait for a webhook" into the service task itself.

## Sources

- https://docs.camunda.io/docs/components/modeler/bpmn/message-events/
