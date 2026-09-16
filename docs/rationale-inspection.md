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

Both views enforce the existing current-revision, source-digest and namespace
checks and complete-result limits: six memories, ten edges and 24000 UTF-16
units. Overflow fails instead of returning a silently truncated graph. Changing
source evidence invalidates its proposals. Forgetting removes their logical
records; it is not a promise of secure physical erasure or backup deletion.
