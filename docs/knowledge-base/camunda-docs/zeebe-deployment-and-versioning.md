# Zeebe Deployment & Process Versioning

> Original notes written 2026-07-31, based on general Zeebe/Camunda 8 deployment behavior plus
> this plugin's own `deploy_process` tool. Written to be directly useful before/after calling it.

Deploying a process to a Zeebe cluster is how a `.bpmn` file modeled locally actually becomes
runnable — separate from modeling, and this plugin's only tool that talks to a live cluster rather
than a local diagram.

## Deploying with this plugin

`deploy_process {filePath, clusterUrl, clientId, clientSecret}` deploys a saved `.bpmn` file
directly. `clusterUrl`/`clientId`/`clientSecret` are optional — if omitted, they default to the
`ZEEBE_ADDRESS`, `ZEEBE_CLIENT_ID`, and `ZEEBE_CLIENT_SECRET` environment variables, so a team can
configure cluster credentials once in the environment rather than passing them on every call.

## Every deploy is a new version — nothing is overwritten

Deploying a process with the same process ID as an already-deployed one doesn't replace it — it
creates a new, independently-versioned definition alongside every prior version. This has real
consequences worth knowing before deploying:

- **Already-running process instances keep running on the version they started on.** Deploying a
  new version never migrates an in-flight instance to the new definition.
- **New process instances use the latest deployed version**, unless something explicitly starts a
  specific older version by version number.
- This is also why the Message Events guide's note about message start events matters: "messages
  are not correlated if published before the process was deployed, or if a new version is deployed
  without a proper start event" — a message published for process ID `X` only starts instances of
  whichever version of `X` actually has a matching message start event modeled.

## Practical implication for iterating on a diagram

Because nothing is overwritten, redeploying the same process ID repeatedly while iterating (e.g.
during development) is always safe — it never disturbs instances already running against an
earlier version. The tradeoff is versions accumulate; that's expected and by design, not a cleanup
task this plugin needs to manage.

## Before deploying, validate

`deploy_process` doesn't re-run this plugin's own validation first — call
`query_diagram {operation: "validate"}` (see the Common Camunda Validation Errors guide) before
deploying, so a deploy failure (or a deployed-but-broken process) doesn't come as a surprise.
