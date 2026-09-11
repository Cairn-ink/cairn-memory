# Explicit supersession and historical evidence

`core.supersede` is a trusted local caller's explicit assertion that one memory
replaces another. It is not automatic semantic contradiction detection, a new
MCP tool, or evidence that capture now understands changing decisions.

```js
const changed = core.supersede({
  namespace,
  memoryId: previous.id,
  expectedRevision: previous.revision,
  replacement: { content: 'The Harbor review is Monday.', kind: 'fact' },
  receipts: [{ client: 'example', sessionId: 'review', eventId: 'decision-2',
    role: 'user', excerpt: 'Move the Harbor review from Friday to Monday.' }],
});
```

Use only synthetic temporary stores to try the API. The exact namespace is
selected by the trusted host, not authenticated by this library. Inputs use the
same content, receipt, redaction and identifier rules as explicit `admit`.
One to four receipts are required. Source text remains untrusted data.

Success returns the ordinary `{ok:true,value}` envelope. `value` contains
`previous: {id,revision}` (the resulting historical revision),
`memory: {id,revision}` (the admitted replacement), `deduplicated` and
`indexRevision`. The whole replacement admission and history transition is one
transaction; errors leave no partially admitted replacement or retired old fact.

## Current and historical are different from forgotten

The predecessor keeps its text and original receipts. Its `state` is
`historical` when inspected through core `get/list`; ordinary current records
keep `active`. Current map/fetch/recall, classification and legacy store reads
exclude history, including after rebuilding indexes or reopening the database.
Inspection is deliberately broader than current recall: do not treat everything
returned by `list` as a currently applicable fact.

Historical `get` additionally returns a bounded, one-hop `supersession` object:

- `previousRevision`: the predecessor revision on which the decision was based.
- `replacement`: its `memoryId`, original committed `revision`, and presently
  inspectable `currentRevision` and `state` (active or historical), or null if
  the endpoint is unavailable. Current revision does not mean current fact.
- `receiptIds`: originally bound replacement receipts that are still available.
- `evidenceAvailable`: whether the complete original replacement evidence remains.

These are references, not copied bodies or receipts. Correcting the successor
can make the original evidence unavailable. Filing or later supersession can
advance its current revision without rewriting the transition's original
revision. No recursive chain expansion or incoming history list is exposed.
Each predecessor has one replacement; each successor accepts at most five
incoming transitions. Overflow fails the entire operation with
`supersession_limit`.

In a chain A → B → C, inspecting A points to B labeled historical; it does not
recursively return C or present B as a currently applicable assertion.

## Explicit control wins

A stale request returns `revision_conflict`; reread before deciding what to do.
An already historical predecessor returns `memory_historical`. A same-content
self replacement returns `invalid_ref`; missing/foreign IDs are not found.
Normal input validation and suppression errors retain their existing envelopes.

Historical correction is rejected to keep prior evidence intact. Historical
forgetting is allowed with its inspected revision and clears its text/receipts.
Forgetting or correcting a replacement never makes its predecessor current
again. History inspection cannot recover forgotten replacement evidence.
Retirement suppresses the old fingerprint, so exact re-admission is rejected
and inferred re-extraction contributes to `suppressedCount`. This is conservative
exact-match replay protection, not a semantic paraphrase detector or restore API.

Supersession deliberately retains the old body and receipts until that historical
record is separately forgotten. It is not deletion, encryption or secure erasure.
The local database/file access and SQLite journal/backup retention limits in
[Local store](local-store.md) continue to apply. No new transcript fields, model
traffic or remote telemetry are introduced by this explicit local operation.

## Upgrade and verification boundary

Schema v8 adds durable currentness and directional transition references. Existing
supported stores upgrade atomically with their existing rows current; the
upgrade does not infer past changes. Stop ALL older-runtime processes and close
their database connections, including idle readers, before backing up meaningful
data and opening with v8. Mixed-version coexistence is unsupported: a connection
already opened by v7 does not gain v8's currentness guards. Older binaries cannot
newly open v8 and there is no downgrade tool or zero-downtime upgrade claim.
The [implementation acceptance](plans/supersession-engine.md) covers rollback,
isolation, mutation races, source preservation and migration on synthetic data.

Schema v9 additionally supports opt-in [ordered capture](capture.md#opt-in-source-ordered-reconciliation),
which can use this history mechanism automatically with source-bound model
judgment. The same stop-all-old-connections requirement applies to that upgrade;
existing unordered receipts are not assigned invented chronology.

Fresh real-provider cross-window and installed MCP acceptance remain separate
gates. The original Friday/Monday capture audit remains failed; neither explicit
supersession nor scripted ordered-capture tests establish real-model quality.
