# Inspecting relationship proposals

With the optional rationale configuration enabled, `inspect_rationale` accepts:

```json
{"memoryId":"memory-id","revision":1,"view":"incident-proposals"}
```

The core equivalent is `getRationale({ namespace, memoryId, revision,
view: 'incident-proposals' })`. Inspection requires no provider call or key.

The default `decision-context` view includes direct incoming challenges to the
root, incoming decision supports, and challenges to those support sources.
It can surface a challenge without a separate support edge, but is not an
inventory of every stored proposal. The explicit incident view instead returns
all directly incoming and outgoing proposals for the root, including self-links
exactly once.
It does not follow other relationships of neighboring memories.

Incident results always have `status: 'unassessed'`,
`coverage: 'root-incident-only'` and `view: 'incident-proposals'`. A stored link
does not prove truth, decision adoption, cancellation or a need to reconfirm.
This incident view does not enter automatic fetch/recall context. Omitted or
explicit `decision-context` now includes direct incoming challenges and labels
their presence `reconfirmation-suggested`, not verified premise failure or a
change of choice. This exposes incorrect model-proposed challenges too; it does
not filter them for semantic validity.

Embedded `fetch` and `recall`, and local MCP `recall_memory`, can explicitly
request `contextMode: 'rationale-neighborhood-evidence'`. This read-only mode
unions the ordinary decision context with the selected root's directly incoming
and outgoing proposals. It therefore retains challenges to separate supporting
memories while also showing a root proposal pointing to a later decision. It
deduplicates exact source/receipt/relation tuples and labels its result
`coverage: 'bounded-root-neighborhood'`, `status: 'unassessed'` and each edge
`interpretationStatus: 'model-proposed'`. This is neither a public inspect view
nor a complete graph walk. It does not establish that a later decision was
adopted or a challenged premise is false. The ranker sees the same bounded
sources and edges returned by the final source reread, but selecting the right
root and interpreting those excerpts remain separate tasks.
The status stays unassessed even with challenge links: an outgoing challenge
may concern a different decision, so a root-level reconfirmation label would
attribute it to the wrong choice.

The new mode is current-only and conflicts with `includeQualification: true`.
Like existing source modes it binds fetch cursors to the exact mode, preserves
complete receipts and source revisions, and rejects overflow or stale evidence
instead of returning partial trusted context. Defaults and existing modes do
not change; explicit selection can expose additional personal source excerpts.

Both views enforce the existing current-revision, source-digest and namespace
checks and complete-result limits: six memories, ten edges and 24000 UTF-16
units. Overflow fails instead of returning a silently truncated graph. Changing
source evidence invalidates its proposals. Forgetting removes their logical
records; it is not a promise of secure physical erasure or backup deletion.
