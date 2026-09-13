# Inspecting relationship proposals

With the optional rationale configuration enabled, `inspect_rationale` accepts:

```json
{"memoryId":"memory-id","revision":1,"view":"incident-proposals"}
```

The core equivalent is `getRationale({ namespace, memoryId, revision,
view: 'incident-proposals' })`. Inspection requires no provider call or key.

The default `decision-context` view follows incoming decision supports and
challenges to those premises. It is not an inventory of every stored proposal.
The explicit incident view instead returns all directly incoming and outgoing
proposals for the root, including orphan challenges and self-links exactly once.
It does not follow other relationships of neighboring memories.

Incident results always have `status: 'unassessed'`,
`coverage: 'root-incident-only'` and `view: 'incident-proposals'`. A stored link
does not prove truth, decision adoption, cancellation or a need to reconfirm.
This view does not enter automatic fetch/recall context. Omitted or explicit
`decision-context` retains the previous payload and behavior.

Both views enforce the existing current-revision, source-digest and namespace
checks and complete-result limits: six memories, ten edges and 24000 UTF-16
units. Overflow fails instead of returning a silently truncated graph. Changing
source evidence invalidates its proposals. Forgetting removes their logical
records; it is not a promise of secure physical erasure or backup deletion.
