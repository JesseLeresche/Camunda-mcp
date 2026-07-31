# Knowledge base source content

Drop a file here (in this folder or any subfolder) to add it to the searchable knowledge base
(`kb_search` tool) — that's the entire contribution workflow. No command to run, no manual reindex
step. Supported formats:

- `.md` — used as-is
- `.pdf` — text-layer extraction
- `.bpmn` / `.xml` — element names, labels, and `<documentation>` text
- `.png` / `.jpg` — OCR'd text labels from a diagram photo or screenshot

See [`docs/kb-architecture/architecture.md`](../kb-architecture/architecture.md) for the full
design (why FTS5, the per-format extractors, the database schema).

Reindexing is automatic and immediate: a live file watcher picks up any add, edit, or removal
while the plugin is already running, on top of a check at plugin load for changes made while it
wasn't. Either way, no restart and no manual step is needed beyond dropping the file.

## Subfolders

- **`camunda-docs/`** — original reference notes on Camunda 8 / BPMN modeling concepts (gateways,
  task types, message correlation, error handling), written from scratch and citing sources rather
  than copied from any single page (see #28) — Camunda's and bpmn.io's documentation isn't
  openly licensed for reproduction. A hand-picked subset of these is also registered as a Tier A
  guide in `src/resources/registry.ts` (see [`Adding a knowledge base
  guide`](../../README.md#adding-a-knowledge-base-guide) in the main README) — most stay Tier B1
  (searchable) only.
