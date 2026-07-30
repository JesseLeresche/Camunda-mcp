# Knowledge base source content

Drop a file here to add it to the searchable knowledge base (`kb_search` tool) — that's the
entire contribution workflow. No command to run, no manual reindex step. Supported today:

- `.md` — used as-is

More formats (`.pdf`, `.bpmn`/`.xml`, `.png`/`.jpg`) land in a later phase — see
[#24](https://github.com/JesseLeresche/Camunda-mcp/issues/24) and
[`docs/kb-architecture/architecture.md`](../kb-architecture/architecture.md) for the full design.

Reindexing happens automatically the next time the plugin loads (a live file watcher that
reindexes while the plugin is already running is also planned, not yet built).
